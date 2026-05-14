import { NextResponse } from 'next/server';
import { and, inArray, isNotNull, lt, eq } from 'drizzle-orm';
import { createClient } from '@/utils/supabase/server';
import { db } from '@/db';
import { leads, leadEvents, users } from '@/db/schema';
import { buildAppointmentSet } from '@/lib/marketing-webhooks/payload-builders';
import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { MarketingWebhookEnvelope } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_CUTOFF_ISO = '2026-05-07T00:00:00.000Z';
const IMPORT_ENDPOINT = 'https://crm.elixirgroup-europe.com/marketing/api/crm/import-appointments';

/**
 * POST /api/marketing/backfill-historical
 * Body: { dryRun?: boolean, cutoffIso?: string, targetUrl?: string }
 *
 * MANAGER/ADMIN only. Costruisce l'array di tutti gli appointment.set storici
 * (occurredAt < cutoff), unione di leadEvents APPOINTMENT_SET + lead orfani con
 * appointmentDate ma nessun evento, deduplicato per eventId deterministico, lo
 * firma e lo POSTa in singola chiamata al loro endpoint di import bulk.
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const role = user.user_metadata?.role;
    if (role !== 'MANAGER' && role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: { dryRun?: boolean; cutoffIso?: string; targetUrl?: string; chunkSize?: number } = {};
    try {
        body = await req.json();
    } catch {
        // empty body is allowed
    }

    const cutoff = new Date(body.cutoffIso ?? DEFAULT_CUTOFF_ISO);
    if (isNaN(cutoff.getTime())) {
        return NextResponse.json({ error: 'invalid_cutoffIso' }, { status: 400 });
    }
    const targetUrl = body.targetUrl ?? IMPORT_ENDPOINT;
    const dryRun = body.dryRun === true;
    const chunkSize = Math.max(10, Math.min(500, body.chunkSize ?? 100));

    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'missing_env_MARKETING_WEBHOOK_SECRET' }, { status: 500 });
    }

    // 1) Carica tutti gli APPOINTMENT_SET storici prima del cutoff
    const events = await db.select({
        leadId: leadEvents.leadId,
        userId: leadEvents.userId,
        timestamp: leadEvents.timestamp,
    })
        .from(leadEvents)
        .where(and(
            eq(leadEvents.eventType, 'APPOINTMENT_SET'),
            lt(leadEvents.timestamp, cutoff),
        ));

    // 2) Carica tutti i lead con appointmentDate < cutoff (per legacy senza evento)
    const allAppointmentLeads = await db.select()
        .from(leads)
        .where(and(
            isNotNull(leads.appointmentDate),
            lt(leads.appointmentDate, cutoff),
        ));

    const leadById = new Map(allAppointmentLeads.map((l) => [l.id, l]));

    // 3) Carica tutti gli utenti che compaiono come actor
    const actorIds = Array.from(new Set(events.map((e) => e.userId).filter((x): x is string => !!x)));
    const actorRows = actorIds.length > 0
        ? await db.select({
            id: users.id, name: users.name, displayName: users.displayName, role: users.role,
        }).from(users).where(inArray(users.id, actorIds))
        : [];
    const actorById = new Map(actorRows.map((a) => [a.id, a]));

    // 4) Costruisci envelopes da leadEvents (timestamp = occurredAt reale dell'azione)
    const envelopes: MarketingWebhookEnvelope[] = [];
    const seenIds = new Set<string>();
    const leadsWithEvent = new Set<string>();

    for (const ev of events) {
        const lead = leadById.get(ev.leadId);
        if (!lead || !lead.appointmentDate) continue; // se appointmentDate è stato cancellato, skip
        leadsWithEvent.add(lead.id);
        const actor = ev.userId ? actorById.get(ev.userId) ?? null : null;
        const env = buildAppointmentSet({ lead, actor, occurredAt: ev.timestamp });
        if (seenIds.has(env.eventId)) continue;
        seenIds.add(env.eventId);
        envelopes.push(env);
    }

    // 5) Aggiungi lead legacy con appointmentDate ma senza alcun APPOINTMENT_SET
    let legacyAdded = 0;
    for (const lead of allAppointmentLeads) {
        if (leadsWithEvent.has(lead.id)) continue;
        const occurredAt = lead.appointmentCreatedAt ?? lead.createdAt;
        const env = buildAppointmentSet({ lead, actor: null, occurredAt });
        if (seenIds.has(env.eventId)) continue;
        seenIds.add(env.eventId);
        envelopes.push(env);
        legacyAdded++;
    }

    if (dryRun) {
        return NextResponse.json({
            dryRun: true,
            cutoff: cutoff.toISOString(),
            targetUrl,
            counts: {
                fromEvents: events.length,
                legacyOrphans: legacyAdded,
                totalLeads: allAppointmentLeads.length,
                envelopes: envelopes.length,
            },
            sample: envelopes.slice(0, 3),
        });
    }

    if (envelopes.length === 0) {
        return NextResponse.json({ delivered: false, reason: 'no_records' });
    }

    // 6) Firma + POST chunked (loro endpoint va in timeout su payload grandi)
    type ChunkResult = {
        index: number;
        size: number;
        bytes: number;
        httpStatus: number | null;
        ok: boolean;
        response: string | null;
        error: string | null;
    };
    const results: ChunkResult[] = [];
    let totalImported = 0;
    let totalSkipped = 0;
    let totalDelivered = 0;

    for (let i = 0; i < envelopes.length; i += chunkSize) {
        const chunk = envelopes.slice(i, i + chunkSize);
        const rawBody = JSON.stringify(chunk);
        const signature = signPayload(rawBody, secret);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        const chunkRes: ChunkResult = {
            index: Math.floor(i / chunkSize),
            size: chunk.length,
            bytes: rawBody.length,
            httpStatus: null,
            ok: false,
            response: null,
            error: null,
        };
        try {
            const res = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'CrmFenice-Backfill/1.0',
                    'X-CRM-Signature': signature,
                },
                body: rawBody,
                signal: controller.signal,
            });
            chunkRes.httpStatus = res.status;
            const text = (await res.text()).slice(0, 2000);
            chunkRes.response = text;
            chunkRes.ok = res.status >= 200 && res.status < 300;
            if (chunkRes.ok) {
                totalDelivered += chunk.length;
                try {
                    const parsed = JSON.parse(text) as { imported?: number; skipped?: number };
                    if (typeof parsed.imported === 'number') totalImported += parsed.imported;
                    if (typeof parsed.skipped === 'number') totalSkipped += parsed.skipped;
                } catch { /* ignore non-JSON ok response */ }
            } else {
                chunkRes.error = text;
            }
        } catch (e: unknown) {
            const isTimeout = e instanceof Error && e.name === 'AbortError';
            chunkRes.error = isTimeout ? 'timeout_60s' : (e instanceof Error ? e.message : 'unknown_error');
        } finally {
            clearTimeout(timer);
        }
        results.push(chunkRes);
    }

    const allOk = results.every((r) => r.ok);
    return NextResponse.json({
        delivered: allOk,
        chunks: results.length,
        chunkSize,
        sent: envelopes.length,
        deliveredCount: totalDelivered,
        imported: totalImported,
        skipped: totalSkipped,
        cutoff: cutoff.toISOString(),
        results,
    }, { status: allOk ? 200 : 502 });
}
