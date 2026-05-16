import { NextResponse } from 'next/server';
import { and, gte, lt, isNotNull, or } from 'drizzle-orm';
import { createClient } from '@/utils/supabase/server';
import { db } from '@/db';
import { leads, marketingWebhookDeliveries } from '@/db/schema';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from '@/lib/marketing-webhooks/payload-builders';
import type { MarketingWebhookEnvelope } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/marketing/backfill-events-window
 * Body: { fromIso: string, toIso: string, dryRun?: boolean }
 *
 * MANAGER/ADMIN only. Genera envelope per tutti e 5 i tipi di evento (appointment.set,
 * appointment.outcome, deal.assigned, deal.closed_won, deal.closed_lost) per lead
 * con timestamp rilevanti nella finestra [from, to). INSERT nell'outbox con
 * status='pending' e targetUrl = MARKETING_WEBHOOK_URL_PROD, lasciando al cron
 * la consegna. Idempotente via eventId deterministico.
 *
 * Use case: ricostruire dati storici nel CRM marketing in seguito a migrazione
 * di dominio (es. cambio receiver senza copia DB).
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const role = user.user_metadata?.role;
    if (role !== 'MANAGER' && role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: { fromIso?: string; toIso?: string; dryRun?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body allowed */ }

    if (!body.fromIso || !body.toIso) {
        return NextResponse.json({ error: 'missing_fromIso_or_toIso' }, { status: 400 });
    }
    const from = new Date(body.fromIso);
    const to = new Date(body.toIso);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
        return NextResponse.json({ error: 'invalid_window' }, { status: 400 });
    }

    const targetUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    if (!targetUrl) {
        return NextResponse.json({ error: 'missing_env_MARKETING_WEBHOOK_URL_PROD' }, { status: 500 });
    }

    const dryRun = body.dryRun === true;

    // Pull tutti i lead che hanno almeno UN timestamp rilevante nella finestra.
    // Un singolo SELECT è più efficiente di 5 separate.
    const rows = await db.select().from(leads).where(or(
        and(isNotNull(leads.appointmentDate), gte(leads.appointmentDate, from), lt(leads.appointmentDate, to)),
        and(isNotNull(leads.confirmationsTimestamp), gte(leads.confirmationsTimestamp, from), lt(leads.confirmationsTimestamp, to)),
        and(isNotNull(leads.salespersonAssignedAt), gte(leads.salespersonAssignedAt, from), lt(leads.salespersonAssignedAt, to)),
        and(isNotNull(leads.salespersonOutcomeAt), gte(leads.salespersonOutcomeAt, from), lt(leads.salespersonOutcomeAt, to)),
    ));

    const envelopes: MarketingWebhookEnvelope[] = [];
    const counts = {
        appointment_set: 0,
        appointment_outcome: 0,
        deal_assigned: 0,
        deal_closed_won: 0,
        deal_closed_lost: 0,
    };

    for (const lead of rows) {
        const inWindow = (d: Date | null | undefined): d is Date =>
            !!d && d >= from && d < to;

        if (inWindow(lead.appointmentDate)) {
            const occurredAt = lead.appointmentCreatedAt ?? lead.appointmentDate;
            envelopes.push(buildAppointmentSet({ lead, actor: null, occurredAt }));
            counts.appointment_set++;
        }
        if (inWindow(lead.confirmationsTimestamp)) {
            envelopes.push(buildAppointmentOutcome({ lead, actor: null, occurredAt: lead.confirmationsTimestamp! }));
            counts.appointment_outcome++;
        }
        if (inWindow(lead.salespersonAssignedAt)) {
            envelopes.push(buildDealAssigned({ lead, actor: null, occurredAt: lead.salespersonAssignedAt! }));
            counts.deal_assigned++;
        }
        if (inWindow(lead.salespersonOutcomeAt) && lead.salespersonOutcome) {
            if (lead.salespersonOutcome === 'Chiuso') {
                envelopes.push(buildDealClosedWon({ lead, actor: null, occurredAt: lead.salespersonOutcomeAt! }));
                counts.deal_closed_won++;
            } else {
                envelopes.push(buildDealClosedLost({ lead, actor: null, occurredAt: lead.salespersonOutcomeAt! }));
                counts.deal_closed_lost++;
            }
        }
    }

    if (dryRun) {
        return NextResponse.json({
            dryRun: true,
            window: { from: from.toISOString(), to: to.toISOString() },
            targetUrl,
            leadsScanned: rows.length,
            envelopes: envelopes.length,
            counts,
            sample: envelopes.slice(0, 3),
        });
    }

    if (envelopes.length === 0) {
        return NextResponse.json({ enqueued: 0, reason: 'no_records' });
    }

    // INSERT in chunk da 200 con ON CONFLICT DO NOTHING (idempotente)
    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < envelopes.length; i += CHUNK) {
        const slice = envelopes.slice(i, i + CHUNK);
        const result = await db.insert(marketingWebhookDeliveries).values(
            slice.map((env) => ({
                id: env.eventId,
                eventType: env.eventType,
                leadId: env.lead.id,
                payload: env,
                targetUrl,
                status: 'pending' as const,
                nextAttemptAt: new Date(),
            }))
        ).onConflictDoNothing({ target: marketingWebhookDeliveries.id }).returning({ id: marketingWebhookDeliveries.id });
        inserted += result.length;
    }

    return NextResponse.json({
        enqueued: envelopes.length,
        inserted_new: inserted,
        skipped_existing: envelopes.length - inserted,
        window: { from: from.toISOString(), to: to.toISOString() },
        targetUrl,
        counts,
    });
}
