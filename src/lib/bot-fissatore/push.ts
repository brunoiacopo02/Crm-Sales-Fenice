import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';

/**
 * Notifica il bot esterno che un lead gli è stato assegnato. Best-effort,
 * no-retry (per il test): un fallimento NON deve impattare l'intake del lead.
 * Kill-switch: BOT_INTAKE_ENABLED !== 'true' → no-op.
 */
export async function pushLeadToBot(payload: BotIntakePayload): Promise<void> {
    if (process.env.BOT_INTAKE_ENABLED !== 'true') return;

    const url = process.env.BOT_INTAKE_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!url || !secret) {
        console.error('[bot-fissatore] missing env: BOT_INTAKE_URL or BOT_WEBHOOK_SECRET');
        return;
    }

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
    } catch (e) {
        console.error(`[bot-fissatore] push failed for lead ${payload.leadId}`, e);
    }
}
