import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';
import { logLeadEvent } from '@/lib/eventLogger';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

/** Esito del tentativo di push, persistito su leadEvents.metadata per audit dal DB. */
type PushResult =
    | { result: 'skipped_disabled' }
    | { result: 'missing_env' }
    | { result: 'sent'; status: number; urlHost?: string }
    | { result: 'http_error'; status: number; urlHost?: string }
    | { result: 'network_error'; error: string; urlHost?: string };

/**
 * Scrive un evento BOT_PUSHED con l'esito del push. Best-effort: un fallimento
 * dell'audit non deve mai propagarsi nel chiamante (gira dentro after()).
 * Permette di verificare i push dal DB senza dipendere dai runtime log Vercel.
 */
async function auditPush(payload: BotIntakePayload, meta: PushResult): Promise<void> {
    try {
        await logLeadEvent({
            leadId: payload.leadId,
            eventType: 'BOT_PUSHED',
            companyId: payload.companyId,
            metadata: { ...meta, at: new Date().toISOString() },
        });
    } catch (e) {
        console.error('[bot-fissatore] audit log failed', e);
    }
}

/** Ultime 10 cifre: la chiave persona che il bot usa per riconoscere la chat. */
export function personKeyOf(phone: string | null): string | null {
    const digits = (phone || '').replace(/\D/g, '').slice(-10);
    return digits.length >= 9 ? digits : null;
}

/**
 * I lead precedenti della stessa persona. Non li fondiamo — un merge
 * retroattivo toccherebbe 1.708 gruppi con presenze e fatturato e 5.251 con
 * attribuzioni GDO diverse — ma il bot ha il diritto di sapere che quella chat
 * l'ha già avuta, e con che esito. È l'unica cosa che sblocca i ~60 lead che
 * gli risultano fermi in NEW mentre lui li aveva già lavorati.
 *
 * Best-effort: se la query fallisce il push parte comunque senza storico.
 */
export async function previousLeadsFor(leadId: string, phone: string | null, companyId: string) {
    const key = personKeyOf(phone);
    if (!key) return { personKey: undefined, previousLeadIds: undefined };
    try {
        const rows = await db.select({
            leadId: leads.id,
            status: leads.status,
            outcome: leads.discardReason,
            createdAt: leads.createdAt,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                ne(leads.id, leadId),
                sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${key}`,
            ))
            .orderBy(desc(leads.createdAt))
            .limit(10);
        return {
            personKey: key,
            previousLeadIds: rows.map(r => ({
                leadId: r.leadId,
                status: r.status,
                outcome: r.outcome,
                createdAt: r.createdAt.toISOString(),
            })),
        };
    } catch (e) {
        console.error('[bot-fissatore] previousLeadsFor failed', e);
        return { personKey: key, previousLeadIds: undefined };
    }
}

/**
 * Notifica il bot esterno che un lead gli è stato assegnato. Best-effort,
 * no-retry (per il test): un fallimento NON deve impattare l'intake del lead.
 * Kill-switch: BOT_INTAKE_ENABLED !== 'true' → no-op (ma tracciato come skipped).
 * Ritorna l'esito (oltre a persistirlo): usato dal backfill per il report sincrono.
 */
export async function pushLeadToBot(payload: BotIntakePayload): Promise<PushResult> {
    if (process.env.BOT_INTAKE_ENABLED !== 'true') {
        const meta: PushResult = { result: 'skipped_disabled' };
        await auditPush(payload, meta);
        return meta;
    }

    const url = process.env.BOT_INTAKE_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!url || !secret) {
        console.error('[bot-fissatore] missing env: BOT_INTAKE_URL or BOT_WEBHOOK_SECRET');
        const meta: PushResult = { result: 'missing_env' };
        await auditPush(payload, meta);
        return meta;
    }

    // Solo l'host nell'audit: utile per diagnosi (URL giusto vs stale) senza loggare path/secret.
    let urlHost: string | undefined;
    try { urlHost = new URL(url).host; } catch { /* url malformato: lasciamo undefined */ }

    // Lo storico si calcola qui e non nel chiamante: così ogni percorso di push
    // (webhook AC, backfill, riassegnazione) lo porta senza doverselo ricordare.
    const enriched: BotIntakePayload = payload.personKey
        ? payload
        : { ...payload, ...(await previousLeadsFor(payload.leadId, payload.phone, payload.companyId)) };

    const rawBody = JSON.stringify(enriched);
    const signature = signPayload(rawBody, secret);

    let meta: PushResult;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signature,
            },
            body: rawBody,
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            console.error(`[bot-fissatore] push non-2xx: ${res.status} for lead ${payload.leadId}`);
        }
        meta = { result: res.ok ? 'sent' : 'http_error', status: res.status, urlHost };
    } catch (e) {
        console.error(`[bot-fissatore] push failed for lead ${payload.leadId}`, e);
        meta = { result: 'network_error', error: String(e), urlHost };
    }
    await auditPush(enriched, meta);
    return meta;
}
