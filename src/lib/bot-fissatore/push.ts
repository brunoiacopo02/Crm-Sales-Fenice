import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';
import { logLeadEvent } from '@/lib/eventLogger';

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

/**
 * Notifica il bot esterno che un lead gli è stato assegnato. Best-effort,
 * no-retry (per il test): un fallimento NON deve impattare l'intake del lead.
 * Kill-switch: BOT_INTAKE_ENABLED !== 'true' → no-op (ma tracciato come skipped).
 */
export async function pushLeadToBot(payload: BotIntakePayload): Promise<void> {
    if (process.env.BOT_INTAKE_ENABLED !== 'true') {
        await auditPush(payload, { result: 'skipped_disabled' });
        return;
    }

    const url = process.env.BOT_INTAKE_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!url || !secret) {
        console.error('[bot-fissatore] missing env: BOT_INTAKE_URL or BOT_WEBHOOK_SECRET');
        await auditPush(payload, { result: 'missing_env' });
        return;
    }

    // Solo l'host nell'audit: utile per diagnosi (URL giusto vs stale) senza loggare path/secret.
    let urlHost: string | undefined;
    try { urlHost = new URL(url).host; } catch { /* url malformato: lasciamo undefined */ }

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, secret);

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
        await auditPush(payload, {
            result: res.ok ? 'sent' : 'http_error',
            status: res.status,
            urlHost,
        });
    } catch (e) {
        console.error(`[bot-fissatore] push failed for lead ${payload.leadId}`, e);
        await auditPush(payload, { result: 'network_error', error: String(e), urlHost });
    }
}
