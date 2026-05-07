import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { leads, users, marketingWebhookDeliveries } from '@/db/schema';
import { deliverWebhook, nextAttemptDelay } from './deliver';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from './payload-builders';
import type { MarketingEventType, MarketingWebhookEnvelope } from './types';

export interface EnqueueInput {
    eventType: MarketingEventType;
    leadId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
}

/**
 * Single entry point dai server action. Carica il lead, costruisce l'envelope,
 * lo inserisce in outbox (idempotent), e fa un tentativo di consegna inline
 * via after() (non blocca la response).
 *
 * Kill-switch: se MARKETING_WEBHOOK_ENABLED !== 'true', no-op.
 */
export async function enqueueMarketingWebhook(input: EnqueueInput): Promise<void> {
    if (process.env.MARKETING_WEBHOOK_ENABLED !== 'true') return;

    const targetUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!targetUrl || !secret) {
        console.error('[marketing-webhooks] missing env: MARKETING_WEBHOOK_URL_PROD or MARKETING_WEBHOOK_SECRET');
        return;
    }

    const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
    if (!lead) {
        console.warn(`[marketing-webhooks] lead ${input.leadId} not found, skipping ${input.eventType}`);
        return;
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
        case 'appointment.outcome':   envelope = buildAppointmentOutcome(ctx); break;
        case 'deal.assigned':         envelope = buildDealAssigned(ctx); break;
        case 'deal.closed_won':       envelope = buildDealClosedWon(ctx); break;
        case 'deal.closed_lost':      envelope = buildDealClosedLost(ctx); break;
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
}
