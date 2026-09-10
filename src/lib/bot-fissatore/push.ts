import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';
import { logLeadEvent } from '@/lib/eventLogger';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { personKeyOf } from './personKey';

/** Esito del tentativo di push, persistito su leadEvents.metadata per audit dal DB. */
type PushResult =
    | { result: 'skipped_disabled' }
    | { result: 'missing_env' }
    | { result: 'sent'; status: number; urlHost?: string }
    | { result: 'http_error'; status: number; urlHost?: string }
    | { result: 'network_error'; error: string; urlHost?: string };

/**
 * Quanto aspettiamo la risposta dell'intake del bot.
 *
 * NON e' un margine di rete: l'intake manda il template WhatsApp di apertura via
 * Twilio DENTRO la richiesta, quindi allo scadere del nostro AbortSignal il lead
 * da loro e' gia' arruolato e il "ciao" e' gia' partito. Un nostro timeout non e'
 * un mancato arrivo, e' un esito ignoto — e ripescare quei lead manda una seconda
 * apertura alla stessa persona (successo il 2026-09-09: 46 conversazioni).
 *
 * A 5 secondi la quota di falsi timeout e' passata dallo 0% di fine agosto al
 * 22,5% del 10/09, mentre il p99 di intake misurato dal fornitore e' 1,7s: quei
 * timeout erano coda e cold start nostri, non lentezza loro. 15 secondi danno
 * ~9x di margine sul p99 e restano dentro il budget di un push a lotti.
 *
 * `BOT_INTAKE_TIMEOUT_MS` permette di correggere senza deploy. Una env assente,
 * non numerica o fuori scala ricade sul default ALTO: il valore pericoloso e'
 * quello basso, e non deve poter rientrare da una env scritta male.
 */
const DEFAULT_INTAKE_TIMEOUT_MS = 15_000;
const MAX_INTAKE_TIMEOUT_MS = 30_000;

function intakeTimeoutMs(): number {
    const raw = process.env.BOT_INTAKE_TIMEOUT_MS;
    if (raw === undefined) return DEFAULT_INTAKE_TIMEOUT_MS;
    const n = Number(raw);
    if (!isFinite(n) || n <= 0) return DEFAULT_INTAKE_TIMEOUT_MS;
    return Math.min(Math.round(n), MAX_INTAKE_TIMEOUT_MS);
}

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

/**
 * Ultime 10 cifre: la chiave persona che il bot usa per riconoscere la chat.
 * Definita in ./personKey (modulo puro) e ri-esportata qui per non rompere i
 * chiamanti storici che la importano da push.
 */
export { personKeyOf } from './personKey';

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
            signal: AbortSignal.timeout(intakeTimeoutMs()),
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
