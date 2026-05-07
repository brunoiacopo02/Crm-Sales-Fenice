import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export interface SignResult {
    signature: string;
    timestamp: string;
}

/**
 * HMAC-SHA256 signing scheme:
 *   stringToSign = `${timestamp}.${rawBody}`
 *   signature    = sha256=hex(hmac(secret, stringToSign))
 */
export function signPayload(rawBody: string, secret: string, now = new Date()): SignResult {
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    const stringToSign = `${timestamp}.${rawBody}`;
    const hex = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
    return { signature: `${SIGNATURE_PREFIX}${hex}`, timestamp };
}

/**
 * Verifica firma con timing-safe compare e anti-replay (default 5 min).
 */
export function verifySignature(
    rawBody: string,
    timestampHeader: string,
    signatureHeader: string,
    secret: string,
    maxAgeSeconds = 300
): { valid: boolean; reason?: string } {
    if (!timestampHeader || !signatureHeader) return { valid: false, reason: 'missing_headers' };
    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return { valid: false, reason: 'bad_prefix' };

    const ts = parseInt(timestampHeader, 10);
    if (Number.isNaN(ts)) return { valid: false, reason: 'bad_timestamp' };

    const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSec > maxAgeSeconds) return { valid: false, reason: 'expired' };

    const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(`${timestampHeader}.${rawBody}`)
        .digest('hex');
    const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length !== b.length) return { valid: false, reason: 'length_mismatch' };

    return crypto.timingSafeEqual(a, b)
        ? { valid: true }
        : { valid: false, reason: 'signature_mismatch' };
}
