/**
 * One-shot: replica POST /api/marketing/backfill-events-window bypassando l'auth Supabase.
 *
 * Use case: dopo la migration al nuovo CRM marketing (crm.elixirgroup-europe.com,
 * 2026-05-14), i 1054 appointment.set storici inviati il 2026-05-10 al vecchio
 * dominio non sono stati portati. Marketing vede solo eventi dal go-live (7/5).
 * Questo script reinserisce in outbox tutti gli eventi storici nella finestra
 * [fromIso, toIso) — il cron li consegnerà al nuovo receiver con HMAC + retry.
 *
 * Idempotente: ON CONFLICT DO NOTHING sul PK = eventId deterministico.
 *
 * Usage:
 *   npx tsx scripts/backfillMarketingEventsWindow.ts \
 *     --from 2026-01-01T00:00:00Z --to 2026-05-07T00:00:00Z [--live]
 *
 * Senza --live esegue solo il dry-run (conta envelope, niente INSERT).
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { and, gte, lt, isNotNull, or } from 'drizzle-orm';
import { db } from '../src/db';
import { leads, marketingWebhookDeliveries } from '../src/db/schema';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from '../src/lib/marketing-webhooks/payload-builders';
import type { MarketingWebhookEnvelope } from '../src/lib/marketing-webhooks/types';

loadEnv({ path: path.resolve(process.cwd(), '.env.marketing.tmp'), override: true });

function parseArgs(): { fromIso: string; toIso: string; live: boolean; targetUrl: string | null } {
    const args = process.argv.slice(2);
    let fromIso = '';
    let toIso = '';
    let live = false;
    let targetUrl: string | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--from') fromIso = args[++i];
        else if (args[i] === '--to') toIso = args[++i];
        else if (args[i] === '--live') live = true;
        else if (args[i] === '--target-url') targetUrl = args[++i];
    }
    if (!fromIso || !toIso) {
        console.error('Usage: --from <ISO> --to <ISO> [--live] [--target-url <url>]');
        process.exit(2);
    }
    return { fromIso, toIso, live, targetUrl };
}

async function main() {
    const { fromIso, toIso, live, targetUrl: argTargetUrl } = parseArgs();
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
        console.error('Invalid window');
        process.exit(2);
    }

    const envUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    const targetUrl = argTargetUrl ?? (envUrl && envUrl.length > 0 ? envUrl : null);
    if (!targetUrl) {
        console.error('Missing target URL: passa --target-url <url> oppure popola MARKETING_WEBHOOK_URL_PROD');
        process.exit(2);
    }

    console.log(`Window: ${from.toISOString()} → ${to.toISOString()}`);
    console.log(`Target: ${targetUrl}`);
    console.log(`Mode: ${live ? 'LIVE (INSERT)' : 'DRY-RUN'}`);

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

    console.log('Leads scanned:', rows.length);
    console.log('Envelopes built:', envelopes.length);
    console.log('Per type:', counts);
    if (envelopes[0]) {
        console.log('Sample eventId:', envelopes[0].eventId, '|', envelopes[0].eventType, '|', envelopes[0].occurredAt);
    }

    if (!live) {
        console.log('\nDRY-RUN: nessun INSERT eseguito. Aggiungi --live per scrivere in outbox.');
        process.exit(0);
    }

    if (envelopes.length === 0) {
        console.log('Niente da inserire.');
        process.exit(0);
    }

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
        console.log(`  chunk ${Math.floor(i / CHUNK) + 1}: ${result.length} new (out of ${slice.length})`);
    }

    console.log(`\nDone. inserted_new=${inserted}, skipped_existing=${envelopes.length - inserted}, total=${envelopes.length}`);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
