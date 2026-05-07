import { signPayload } from './signing';
import type { MarketingWebhookEnvelope } from './types';

export interface DeliverResult {
    delivered: boolean;
    permanentFailure: boolean;
    httpStatus: number | null;
    error: string | null;
}

const DELIVERY_TIMEOUT_MS = 10_000;

export async function deliverWebhook(
    targetUrl: string,
    envelope: MarketingWebhookEnvelope,
    secret: string
): Promise<DeliverResult> {
    const body = JSON.stringify(envelope);
    const signature = signPayload(body, secret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'CrmFenice-Webhooks/1.0',
                'X-CRM-Event-Id': envelope.eventId,
                'X-CRM-Event-Type': envelope.eventType,
                'X-CRM-Signature': signature,
            },
            body,
            signal: controller.signal,
        });

        const ok = res.status >= 200 && res.status < 300;
        const permanentFailure = res.status >= 400 && res.status < 500 && res.status !== 429;

        let errSnippet: string | null = null;
        if (!ok) {
            try {
                errSnippet = (await res.text()).slice(0, 1000);
            } catch {
                errSnippet = null;
            }
        }

        return {
            delivered: ok,
            permanentFailure,
            httpStatus: res.status,
            error: ok ? null : errSnippet,
        };
    } catch (e: unknown) {
        const isTimeout = e instanceof Error && e.name === 'AbortError';
        const message = e instanceof Error ? e.message : 'unknown_error';
        return {
            delivered: false,
            permanentFailure: false,
            httpStatus: null,
            error: isTimeout ? 'timeout_10s' : message,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Backoff: 1m → 5m → 30m → 2h → 6h → DLQ (NULL = dead-letter).
 * `attempts` = numero di tentativi GIÀ falliti (1..N).
 */
export function nextAttemptDelay(attempts: number): number | null {
    const ladderSeconds = [
        60,
        5 * 60,
        30 * 60,
        2 * 60 * 60,
        6 * 60 * 60,
    ];
    if (attempts >= ladderSeconds.length + 1) return null;
    return ladderSeconds[attempts - 1] * 1000;
}
