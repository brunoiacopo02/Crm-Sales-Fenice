import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * HMAC-SHA256 signing scheme concordato col CRM marketing:
 *   signature = sha256=hex(hmac(secret, rawBody))
 *
 * NB: Niente prefix timestamp — il marketing fa dedup via header
 * X-CRM-Event-Id, che è il nostro eventId deterministico.
 */
export function signPayload(rawBody: string, secret: string): string {
    const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return `${SIGNATURE_PREFIX}${hex}`;
}

/**
 * Verifica firma con timing-safe compare. Esposto per simmetria nel caso
 * volessimo accettare callback inbound dal marketing in futuro.
 */
export function verifySignature(
    rawBody: string,
    signatureHeader: string,
    secret: string,
): { valid: boolean; reason?: string } {
    if (!signatureHeader) return { valid: false, reason: 'missing_signature' };
    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return { valid: false, reason: 'bad_prefix' };

    const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
    const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length !== b.length) return { valid: false, reason: 'length_mismatch' };

    return crypto.timingSafeEqual(a, b)
        ? { valid: true }
        : { valid: false, reason: 'signature_mismatch' };
}
