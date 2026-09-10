/**
 * Quanto aspettare prima di ritentare un push rifiutato dal bot.
 *
 * Il rifiuto per rate limit (429) è l'UNICO caso in cui ritentare è sicuro: il
 * fornitore dichiara esplicitamente `accettato:false` (contratto 2026-09-09),
 * quindi il lead non è entrato da loro e un secondo invio non può duplicarlo.
 * Un timeout di rete, al contrario, non dice se la richiesta sia arrivata o no:
 * lì ritentare rischia un doppio intake, e restiamo sul no-retry.
 *
 * L'attesa si legge, in ordine: `dopoSecondi` nel corpo JSON, poi l'header
 * `retry-after` (secondi o data HTTP). Con un tetto, perché il push del webhook
 * gira dentro after() e non può restare appeso quanto vuole il server.
 */

/** Attesa massima accettata da un 429, oltre la quale si rinuncia al retry inline. */
export const MAX_RETRY_WAIT_MS = 30_000;

/** Fallback quando il server non dice quanto aspettare. */
export const DEFAULT_RETRY_WAIT_MS = 5_000;

/** Tentativi aggiuntivi dopo il primo rifiuto. */
export const MAX_RETRY_ATTEMPTS = 2;

/**
 * Attesa prima di ritentare un timeout. Breve: non stiamo rispettando un tetto,
 * stiamo solo ridando una possibilita' a una richiesta che non ha mai risposto.
 */
export const TIMEOUT_RETRY_WAIT_MS = 2_000;

/**
 * Il retry sui timeout e' sicuro SOLO con la guardia di idempotenza del
 * fornitore attiva in produzione (stesso `crm_lead_id` + outbound nelle ultime
 * 12h -> nessuna seconda apertura). Senza, un timeout ritentato manda un secondo
 * "ciao" alla stessa persona. Interruttore spento di default proprio per questo:
 * l'ordine dei due deploy non deve poter fare danni.
 */
export function timeoutRetryEnabled(): boolean {
    return process.env.BOT_INTAKE_RETRY_TIMEOUT === 'true';
}

/**
 * Quanto aspettiamo la risposta dell'intake del bot.
 *
 * NON e' un margine di rete: l'intake fa il round trip a Twilio per il template
 * di apertura DENTRO la richiesta, quindi allo scadere del nostro AbortSignal il
 * lead da loro e' gia' arruolato e il "ciao" e' gia' partito. Un timeout nostro
 * non e' un mancato arrivo, e' un esito ignoto — e ripescarlo manda una seconda
 * apertura alla stessa persona (successo il 2026-09-09, 46 conversazioni).
 *
 * A 5 secondi la quota di falsi timeout e' passata dallo 0% di fine agosto al
 * 22,5% del 10/09, con p99 di intake misurato dal fornitore a 1,7s: i timeout
 * erano coda e cold start nostri, non lentezza loro. 15 secondi danno ~9x di
 * margine sul p99 restando dentro il budget del push scaglionato (un push
 * appeso a 30s si mangerebbe 15 slot da 2s).
 */
export const DEFAULT_INTAKE_TIMEOUT_MS = 15_000;

/** Tetto di sicurezza: oltre, un push appeso affamerebbe la coda dello scaglionamento. */
export const MAX_INTAKE_TIMEOUT_MS = 30_000;

/**
 * `BOT_INTAKE_TIMEOUT_MS` per poter stringere o allargare senza deploy. Un
 * valore assente, non numerico o fuori scala ricade sul default ALTO: il valore
 * pericoloso e' quello basso, e non deve poter rientrare da una env sbagliata.
 */
export function intakeTimeoutMs(env: Record<string, string | undefined> = process.env): number {
    const raw = env.BOT_INTAKE_TIMEOUT_MS;
    if (raw === undefined) return DEFAULT_INTAKE_TIMEOUT_MS;
    const n = Number(raw);
    if (!isFinite(n) || n <= 0) return DEFAULT_INTAKE_TIMEOUT_MS;
    return Math.min(Math.round(n), MAX_INTAKE_TIMEOUT_MS);
}

export interface RetryHint {
    /** Millisecondi da attendere prima del prossimo tentativo. */
    waitMs: number;
    /** Il server ha chiesto un'attesa più lunga del nostro tetto: niente retry inline. */
    tooLong: boolean;
}

/**
 * `retryAfterMs(bodyText, headerValue, now)`.
 * `now` serve solo a interpretare un `retry-after` in forma di data HTTP.
 */
export function retryAfterMs(
    bodyText: string | null,
    headerValue: string | null,
    now: Date = new Date(),
): RetryHint {
    const fromBody = parseBodySeconds(bodyText);
    const fromHeader = parseHeader(headerValue, now);
    const seconds = fromBody ?? fromHeader;

    if (seconds === null) {
        return { waitMs: DEFAULT_RETRY_WAIT_MS, tooLong: false };
    }
    const waitMs = Math.max(0, Math.round(seconds * 1000));
    return { waitMs, tooLong: waitMs > MAX_RETRY_WAIT_MS };
}

/** `dopoSecondi` dal corpo JSON del 429 (contratto fornitore). */
function parseBodySeconds(bodyText: string | null): number | null {
    if (!bodyText) return null;
    try {
        const parsed = JSON.parse(bodyText) as { dopoSecondi?: unknown };
        const v = parsed?.dopoSecondi;
        if (typeof v === 'number' && isFinite(v) && v >= 0) return v;
        if (typeof v === 'string') {
            const n = Number(v);
            if (isFinite(n) && n >= 0) return n;
        }
        return null;
    } catch {
        // Corpo non JSON (il vecchio 429 rispondeva testo): nessun suggerimento.
        return null;
    }
}

/** Header `retry-after`: secondi, oppure data HTTP. */
function parseHeader(headerValue: string | null, now: Date): number | null {
    if (!headerValue) return null;
    const trimmed = headerValue.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const asDate = Date.parse(trimmed);
    if (!isNaN(asDate)) return Math.max(0, (asDate - now.getTime()) / 1000);
    return null;
}

/**
 * Il fornitore ha riconosciuto il lead come gia' entrato (`duplicato:true`,
 * contratto 2026-09-09): risposta a un nostro ritento, quindi il lead e' a posto.
 * Non e' un lead nuovo e non e' uno scarto — non va contato in nessuna delle due.
 */
export function isDuplicate(bodyText: string | null): boolean {
    if (!bodyText) return false;
    try {
        const parsed = JSON.parse(bodyText) as { duplicato?: unknown };
        return parsed?.duplicato === true;
    } catch {
        return false;
    }
}

/** Il corpo del 429 dichiara che il lead NON è stato accettato? */
export function declaredNotAccepted(bodyText: string | null): boolean {
    if (!bodyText) return false;
    try {
        const parsed = JSON.parse(bodyText) as { accettato?: unknown };
        return parsed?.accettato === false;
    } catch {
        return false;
    }
}
