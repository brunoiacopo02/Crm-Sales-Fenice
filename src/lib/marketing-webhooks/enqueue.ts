import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { leads, users, marketingWebhookDeliveries } from '@/db/schema';
import { deliverWebhook, nextAttemptDelay } from './deliver';
import {
    buildAppointmentSet,
    buildAppointmentRescheduled,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
    buildLeadRejected,
} from './payload-builders';
import type { MarketingEventType, MarketingWebhookEnvelope, RejectionStage } from './types';

export interface EnqueueInput {
    eventType: MarketingEventType;
    leadId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
    // Solo per appointment.rescheduled: dati del vecchio e nuovo appuntamento.
    // Senza questi, lo switch lancia per il tipo rescheduled.
    previousAppointmentDate?: Date;
    newAppointmentDate?: Date;
    // Solo per lead.rejected: contesto che non e' derivabile dalla riga del
    // lead. La causale invece si legge dal lead, non va passata qui.
    rejection?: {
        stage: RejectionStage;
        automatic: boolean;
        byBot?: boolean;
    };
}

/** Esito dell'enqueue: usato dal debug endpoint per non dichiarare "enqueued"
 *  quando in realta' non e' stato scritto nulla in outbox. I chiamanti
 *  fire-and-forget (`.catch(...)`) ignorano il valore risolto, quindi
 *  restituirlo non cambia il loro comportamento. */
export interface EnqueueResult {
    enqueued: boolean;
    reason?: string;
}

/**
 * Single entry point dai server action. Carica il lead, costruisce l'envelope,
 * lo inserisce in outbox (idempotent), e fa un tentativo di consegna inline
 * via after() (non blocca la response).
 *
 * Kill-switch: se MARKETING_WEBHOOK_ENABLED !== 'true', no-op.
 */
export async function enqueueMarketingWebhook(input: EnqueueInput): Promise<EnqueueResult> {
    if (process.env.MARKETING_WEBHOOK_ENABLED !== 'true') return { enqueued: false, reason: 'kill_switch_disabled' };

    const targetUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!targetUrl || !secret) {
        console.error('[marketing-webhooks] missing env: MARKETING_WEBHOOK_URL_PROD or MARKETING_WEBHOOK_SECRET');
        return { enqueued: false, reason: 'missing_env' };
    }

    const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
    if (!lead) {
        console.warn(`[marketing-webhooks] lead ${input.leadId} not found, skipping ${input.eventType}`);
        return { enqueued: false, reason: 'lead_not_found' };
    }

    let actor: { id: string; name: string | null; displayName: string | null; role: string } | null = null;
    if (input.actorUserId) {
        const [u] = await db.select({
            id: users.id, name: users.name, displayName: users.displayName, role: users.role,
        }).from(users).where(eq(users.id, input.actorUserId));
        actor = u ?? null;
    }

    const ctx = { lead, actor, occurredAt: input.occurredAt ?? new Date() };
    let envelope: MarketingWebhookEnvelope;
    switch (input.eventType) {
        case 'appointment.set':       envelope = buildAppointmentSet(ctx); break;
        case 'appointment.rescheduled':
            if (!input.previousAppointmentDate || !input.newAppointmentDate) {
                console.error(`[marketing-webhooks] appointment.rescheduled requires previousAppointmentDate and newAppointmentDate`);
                return { enqueued: false, reason: 'missing_reschedule_dates' };
            }
            envelope = buildAppointmentRescheduled({
                ...ctx,
                previousAppointmentDate: input.previousAppointmentDate,
                newAppointmentDate: input.newAppointmentDate,
            });
            break;
        case 'appointment.outcome':   envelope = buildAppointmentOutcome(ctx); break;
        case 'deal.assigned':         envelope = buildDealAssigned(ctx); break;
        case 'deal.closed_won':       envelope = buildDealClosedWon(ctx); break;
        case 'deal.closed_lost':      envelope = buildDealClosedLost(ctx); break;
        case 'lead.rejected': {
            if (!input.rejection) {
                console.error(`[marketing-webhooks] lead.rejected senza rejection per ${input.leadId}, skip`);
                return { enqueued: false, reason: 'missing_rejection_context' };
            }
            envelope = buildLeadRejected({
                ...ctx,
                stage: input.rejection.stage,
                automatic: input.rejection.automatic,
                byBot: input.rejection.byBot ?? false,
            });
            break;
        }
    }

    await db.insert(marketingWebhookDeliveries).values({
        id: envelope.eventId,
        eventType: envelope.eventType,
        leadId: lead.id,
        payload: envelope,
        targetUrl,
        status: 'pending',
        nextAttemptAt: new Date(),
    }).onConflictDoNothing({ target: marketingWebhookDeliveries.id });

    after(async () => {
        try {
            const result = await deliverWebhook(targetUrl, envelope, secret);
            if (result.delivered) {
                await db.update(marketingWebhookDeliveries).set({
                    status: 'delivered',
                    deliveredAt: new Date(),
                    lastAttemptAt: new Date(),
                    attempts: 1,
                    lastResponseStatus: result.httpStatus,
                }).where(eq(marketingWebhookDeliveries.id, envelope.eventId));
            } else {
                const delay = nextAttemptDelay(1);
                const newStatus = result.permanentFailure
                    ? 'failed_permanent'
                    : (delay === null ? 'dead' : 'pending');
                await db.update(marketingWebhookDeliveries).set({
                    status: newStatus,
                    attempts: 1,
                    lastAttemptAt: new Date(),
                    nextAttemptAt: delay ? new Date(Date.now() + delay) : new Date(),
                    lastResponseStatus: result.httpStatus,
                    lastError: result.error,
                }).where(eq(marketingWebhookDeliveries.id, envelope.eventId));
            }
        } catch (e) {
            console.error('[marketing-webhooks] inline delivery error', e);
        }
    });

    return { enqueued: true };
}
