// src/lib/marketing/crm-ingest.ts
// Persiste un evento CRM webhook nel DB Drizzle:
//   1. INSERT su crmEvents (idempotente via PK = eventId).
//   2. Se inserito (non duplicato): upsert sul read model corrispondente
//      (crmAppointments per appointment.*, crmDeals per deal.*).
//
// Diversamente dal codice legacy supabase-js (che usava upsert con
// onConflict.code === '23505'), qui usiamo db.transaction() per coerenza.

import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '@/db';
import { crmEvents, crmAppointments, crmDeals } from '@/db/schema';
import { normalizeFunnel } from './crm-funnel';
import type { CrmEvent } from './webhook';

export type IngestOutcome =
    | { status: 'inserted'; eventId: string }
    | { status: 'duplicate'; eventId: string }
    | { status: 'error'; eventId: string; message: string };

export async function ingestCrmEvent(
    companyId: string,
    event: CrmEvent,
): Promise<IngestOutcome> {
    const eventId = event.eventId;
    try {
        return await db.transaction(async (tx) => {
            // 1. Insert event (PK = eventId → onConflictDoNothing per idempotenza).
            const inserted = await tx
                .insert(crmEvents)
                .values({
                    eventId,
                    eventType: event.eventType,
                    occurredAt: new Date(event.occurredAt),
                    companyId,
                    leadId: event.lead?.id ?? null,
                    payload: event as unknown as object,
                })
                .onConflictDoNothing({ target: crmEvents.eventId })
                .returning({ eventId: crmEvents.eventId });

            if (inserted.length === 0) {
                return { status: 'duplicate', eventId } as IngestOutcome;
            }

            // 2. Read model update — non-bloccante in caso di errore (logghiamo
            //    e ritorniamo inserted; crmEvents resta fonte di verità).
            try {
                switch (event.eventType) {
                    case 'appointment.set':
                        await upsertAppointmentFromSet(tx, companyId, event);
                        break;
                    case 'appointment.outcome':
                        await upsertAppointmentFromOutcome(tx, companyId, event);
                        break;
                    case 'deal.closed_won':
                    case 'deal.closed_lost':
                        await insertDealFromClosed(tx, companyId, event);
                        break;
                    default:
                        console.log('[crm-ingest] unhandled event type:', (event as { eventType: string }).eventType);
                }
            } catch (e) {
                console.error('[crm-ingest] read model upsert failed:', e, '| event:', eventId);
            }

            return { status: 'inserted', eventId } as IngestOutcome;
        });
    } catch (e) {
        return { status: 'error', eventId, message: e instanceof Error ? e.message : String(e) };
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertAppointmentFromSet(tx: Tx, companyId: string, event: CrmEvent) {
    if (event.eventType !== 'appointment.set') return;
    const lead = event.lead;
    const appointmentDate = event.occurredAt.slice(0, 10);

    await tx
        .insert(crmAppointments)
        .values({
            companyId,
            leadId: lead?.id ?? '',
            appointmentDate,
            funnel: normalizeFunnel(lead?.funnel),
            utmSource: lead?.utm?.source ?? null,
            utmMedium: lead?.utm?.medium ?? null,
            utmCampaign: lead?.utm?.campaign ?? null,
            utmContent: lead?.utm?.content ?? null,
            utmTerm: lead?.utm?.term ?? null,
            leadName: lead?.name ?? null,
            leadEmail: lead?.email ?? null,
            leadPhone: lead?.phone ?? null,
            setEventId: event.eventId,
            setAt: new Date(event.occurredAt),
        })
        .onConflictDoUpdate({
            target: [crmAppointments.companyId, crmAppointments.leadId, crmAppointments.appointmentDate],
            set: {
                funnel: sql`excluded.funnel`,
                utmSource: sql`excluded.utm_source`,
                utmMedium: sql`excluded.utm_medium`,
                utmCampaign: sql`excluded.utm_campaign`,
                utmContent: sql`excluded.utm_content`,
                utmTerm: sql`excluded.utm_term`,
                leadName: sql`excluded.lead_name`,
                leadEmail: sql`excluded.lead_email`,
                leadPhone: sql`excluded.lead_phone`,
                setEventId: sql`excluded.set_event_id`,
                setAt: sql`excluded.set_at`,
            },
        });
}

async function upsertAppointmentFromOutcome(tx: Tx, companyId: string, event: CrmEvent) {
    if (event.eventType !== 'appointment.outcome') return;
    const lead = event.lead;
    const status = event.data?.status ?? 'UNKNOWN';
    const rawOutcome = event.data?.rawOutcome ?? null;

    // Determina appointment_date per matchare il set:
    //   1. data.scheduledAt se presente
    //   2. ultimo appuntamento esistente per (company, lead)
    //   3. fallback: event.occurredAt::date (crea stub)
    let appointmentDate: string;
    const scheduledAt = event.data?.scheduledAt;
    if (typeof scheduledAt === 'string' && scheduledAt.length >= 10) {
        appointmentDate = scheduledAt.slice(0, 10);
    } else {
        const latest = await tx
            .select({ appointmentDate: crmAppointments.appointmentDate })
            .from(crmAppointments)
            .where(and(
                eq(crmAppointments.companyId, companyId),
                eq(crmAppointments.leadId, lead?.id ?? ''),
            ))
            .orderBy(desc(crmAppointments.appointmentDate))
            .limit(1);
        appointmentDate = (latest[0]?.appointmentDate as unknown as string) ?? event.occurredAt.slice(0, 10);
    }

    await tx
        .insert(crmAppointments)
        .values({
            companyId,
            leadId: lead?.id ?? '',
            appointmentDate,
            funnel: normalizeFunnel(lead?.funnel),
            utmSource: lead?.utm?.source ?? null,
            utmMedium: lead?.utm?.medium ?? null,
            utmCampaign: lead?.utm?.campaign ?? null,
            utmContent: lead?.utm?.content ?? null,
            utmTerm: lead?.utm?.term ?? null,
            status,
            leadName: lead?.name ?? null,
            leadEmail: lead?.email ?? null,
            leadPhone: lead?.phone ?? null,
            outcomeEventId: event.eventId,
            outcomeAt: new Date(event.occurredAt),
            rawOutcome,
        })
        .onConflictDoUpdate({
            target: [crmAppointments.companyId, crmAppointments.leadId, crmAppointments.appointmentDate],
            set: {
                funnel: sql`excluded.funnel`,
                utmSource: sql`excluded.utm_source`,
                utmMedium: sql`excluded.utm_medium`,
                utmCampaign: sql`excluded.utm_campaign`,
                utmContent: sql`excluded.utm_content`,
                utmTerm: sql`excluded.utm_term`,
                status: sql`excluded.status`,
                leadName: sql`excluded.lead_name`,
                leadEmail: sql`excluded.lead_email`,
                leadPhone: sql`excluded.lead_phone`,
                outcomeEventId: sql`excluded.outcome_event_id`,
                outcomeAt: sql`excluded.outcome_at`,
                rawOutcome: sql`excluded.raw_outcome`,
            },
        });
}

async function insertDealFromClosed(tx: Tx, companyId: string, event: CrmEvent) {
    if (event.eventType !== 'deal.closed_won' && event.eventType !== 'deal.closed_lost') return;
    const lead = event.lead;
    const dataAny = (event as { data?: Record<string, unknown> }).data ?? {};
    const status = event.eventType === 'deal.closed_won' ? 'WON' : 'LOST';

    const closedAtRaw = typeof dataAny.closedAt === 'string' ? dataAny.closedAt : event.occurredAt;
    const closedDate = closedAtRaw.slice(0, 10);
    const amountEur = typeof dataAny.amountEur === 'number' ? dataAny.amountEur : null;
    const product = typeof dataAny.product === 'string' ? dataAny.product : null;
    const sp = (dataAny.salesperson as { userId?: string; displayName?: string } | undefined) ?? undefined;

    await tx
        .insert(crmDeals)
        .values({
            companyId,
            leadId: lead?.id ?? '',
            eventId: event.eventId,
            status,
            closedAt: new Date(closedAtRaw),
            closedDate,
            funnel: normalizeFunnel(lead?.funnel),
            utmSource: lead?.utm?.source ?? null,
            utmMedium: lead?.utm?.medium ?? null,
            utmCampaign: lead?.utm?.campaign ?? null,
            utmContent: lead?.utm?.content ?? null,
            utmTerm: lead?.utm?.term ?? null,
            product,
            amountEur: amountEur == null ? null : String(amountEur),
            salespersonId: sp?.userId ?? null,
            salespersonName: sp?.displayName ?? null,
        })
        .onConflictDoNothing({
            target: [crmDeals.companyId, crmDeals.eventId],
        });
}
