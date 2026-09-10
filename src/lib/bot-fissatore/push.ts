import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';
import { logLeadEvent } from '@/lib/eventLogger';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { personKeyOf } from './personKey';
import {
    retryAfterMs,
    declaredNotAccepted,
    isDuplicate,
    timeoutRetryEnabled,
    intakeTimeoutMs,
    MAX_RETRY_ATTEMPTS,
    MAX_RETRY_WAIT_MS,
    TIMEOUT_RETRY_WAIT_MS,
} from './retryAfter';
import { prossimoInvio } from './pacing';

/** Esito del tentativo di push, persistito su leadEvents.metadata per audit dal DB. */
type PushResult =
    | { result: 'skipped_disabled' }
    | { result: 'missing_env' }
    | { result: 'sent'; status: number; urlHost?: string; tentativi?: number }
    /** Il fornitore lo aveva gia': risposta a un nostro ritento. Ne' nuovo ne' scarto. */
    | { result: 'duplicate'; status: number; urlHost?: string; tentativi: number }
    | { result: 'http_error'; status: number; urlHost?: string; tentativi?: number }
    /** 429 esaurito il retry: il fornitore ha dichiarato di NON aver preso il lead. */
    | { result: 'rate_limited'; status: number; urlHost?: string; tentativi: number; attesaRichiestaMs?: number }
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
 * Tetto di invio verso `/api/bot/intake`, concordato col fornitore il 2026-09-09.
 *
 * Il loro endpoint ha un rate limit a 60/minuto che scatta PRIMA della verifica
 * HMAC e di qualunque I/O: se scatta, dal loro lato non resta traccia. Non è
 * nemmeno un tetto affidabile (il contatore è una Map in memoria di processo,
 * quindi per istanza serverless e azzerata a ogni deploy), quindi la difesa sta
 * qui in invio, con margine: 30/min.
 *
 * Il ritento sul 429 qui sotto si accende solo se il corpo dichiara
 * `accettato:false` (contratto 2026-09-09). Finché il fornitore risponde con un
 * corpo vuoto, quel ramo non si attiva mai e ogni 429 diventa `rate_limited`
 * senza ritentare: è voluto, un doppio intake costa più di un lead da ripassare.
 *
 * Verificato sui nostri audit BOT_PUSHED dal 1 agosto: picco reale 31 invii in un
 * minuto, un solo minuto sopra i 30, nessuno sopra i 60. Il tetto tocca quindi solo
 * i due percorsi a lotti (backfill e push admin), non il push singolo del webhook.
 */
export const BOT_INTAKE_MAX_PER_MINUTE = 30;
export const BOT_INTAKE_MIN_INTERVAL_MS = Math.ceil(60_000 / BOT_INTAKE_MAX_PER_MINUTE);

/** Quanto può durare un lotto prima di restituire il resto al chiamante. */
const BOT_INTAKE_BUDGET_MS = 240_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type PacedPushOutcome = {
    leadId: string;
    name: string | null;
    result: PushResult['result'];
    status?: number;
};

/**
 * Invia un lotto di lead al bot scaglionandoli a `BOT_INTAKE_MAX_PER_MINUTE`.
 *
 * La decisione "aspetto quanto, e mi fermo?" vive in `pacing.ts`, dove è testata:
 * la cadenza è ancorata all'istante di partenza, non all'ultima richiesta, così un
 * push lento (un timeout dell'intake costa fino a 15s) non somma la propria attesa
 * al ritardo già accumulato.
 *
 * A 30/min un lotto da 500 supererebbe qualunque durata massima di funzione, quindi
 * il lotto si ferma a `budgetMs` e restituisce in `remaining` i leadId non ancora
 * inviati: sta al chiamante ripassarli in una chiamata successiva. Meglio un resto
 * dichiarato che un troncamento silenzioso.
 */
export async function pushLeadsToBotPaced(
    payloads: BotIntakePayload[],
    opts: { budgetMs?: number } = {},
): Promise<{ results: PacedPushOutcome[]; remaining: string[] }> {
    const budgetMs = opts.budgetMs ?? BOT_INTAKE_BUDGET_MS;
    const startedAt = Date.now();
    const results: PacedPushOutcome[] = [];

    for (let i = 0; i < payloads.length; i++) {
        const { attesaMs, fuoriBudget } = prossimoInvio({
            indice: i,
            elapsedMs: Date.now() - startedAt,
            intervalloMs: BOT_INTAKE_MIN_INTERVAL_MS,
            budgetMs,
        });
        if (fuoriBudget) {
            return { results, remaining: payloads.slice(i).map(p => p.leadId) };
        }
        if (attesaMs > 0) await sleep(attesaMs);

        const r = await pushLeadToBot(payloads[i]);
        results.push({
            leadId: payloads[i].leadId,
            name: payloads[i].name,
            result: r.result,
            status: 'status' in r ? r.status : undefined,
        });

        // Rifiutato per rate limit anche dopo i retry: il fornitore ha dichiarato
        // di non averlo preso, quindi il lead torna fra quelli da ripassare invece
        // di restare un fallimento silenzioso. Il resto del lotto si ferma qui: se
        // il loro tetto e' pieno, insistere lo tiene pieno.
        if (r.result === 'rate_limited') {
            return { results, remaining: payloads.slice(i).map(p => p.leadId) };
        }
    }

    return { results, remaining: [] };
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

    // Un 429 è l'unico esito che si può ritentare senza rischio di duplicare il
    // lead: il fornitore risponde `accettato:false` (contratto 2026-09-09), quindi
    // da loro non è entrato niente. Un timeout invece non dice se la richiesta sia
    // arrivata, e resta no-retry: meglio un lead da ripassare che un doppio intake.
    // Il timeout della fetch vive in intakeTimeoutMs(): l'intake manda il template
    // di apertura dentro la richiesta, quindi un timeout stretto marca come falliti
    // dei push riusciti (dal 5s: 0% a fine agosto -> 22,5% il 10/09).
    let meta: PushResult;
    let tentativi = 0;

    while (true) {
        tentativi++;
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

            if (res.ok) {
                // `duplicato:true` = il lead era gia' entrato da loro (guardia di
                // idempotenza): e' la risposta a un nostro ritento andato a segno.
                const okBody = await res.text().catch(() => null);
                meta = isDuplicate(okBody)
                    ? { result: 'duplicate', status: res.status, urlHost, tentativi }
                    : { result: 'sent', status: res.status, urlHost, tentativi };
                break;
            }

            if (res.status !== 429) {
                console.error(`[bot-fissatore] push non-2xx: ${res.status} for lead ${payload.leadId}`);
                meta = { result: 'http_error', status: res.status, urlHost, tentativi };
                break;
            }

            // 429: leggo quanto vuole che aspetti, poi decido se ritentare qui.
            const bodyText = await res.text().catch(() => null);
            const hint = retryAfterMs(bodyText, res.headers.get('retry-after'));
            const accettato = !declaredNotAccepted(bodyText);
            const puoRitentare = tentativi <= MAX_RETRY_ATTEMPTS && !hint.tooLong;

            if (!puoRitentare) {
                console.error(
                    `[bot-fissatore] rate limited, retry esaurito (${tentativi} tentativi, `
                    + `attesa richiesta ${hint.waitMs}ms) for lead ${payload.leadId}`,
                );
                meta = {
                    result: 'rate_limited',
                    status: res.status,
                    urlHost,
                    tentativi,
                    attesaRichiestaMs: hint.waitMs,
                };
                break;
            }

            if (accettato) {
                // 429 senza `accettato:false`: non sappiamo se l'abbiano preso.
                // Non ritentiamo — un duplicato costa piu' di un lead da ripassare.
                console.error(`[bot-fissatore] 429 senza accettato:false, nessun retry for lead ${payload.leadId}`);
                meta = { result: 'rate_limited', status: res.status, urlHost, tentativi, attesaRichiestaMs: hint.waitMs };
                break;
            }

            await sleep(Math.min(hint.waitMs, MAX_RETRY_WAIT_MS));
            continue;
        } catch (e) {
            // Un timeout non dice se la richiesta sia arrivata: ritentare e' sicuro
            // solo con la guardia di idempotenza del fornitore attiva, altrimenti
            // la stessa persona riceve due aperture. Da qui l'interruttore.
            if (timeoutRetryEnabled() && tentativi <= MAX_RETRY_ATTEMPTS) {
                console.warn(`[bot-fissatore] timeout, ritento (${tentativi}) for lead ${payload.leadId}`);
                await sleep(TIMEOUT_RETRY_WAIT_MS);
                continue;
            }
            console.error(`[bot-fissatore] push failed for lead ${payload.leadId}`, e);
            meta = { result: 'network_error', error: String(e), urlHost };
            break;
        }
    }

    await auditPush(enriched, meta);
    return meta;
}
