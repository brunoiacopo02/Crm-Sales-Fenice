/**
 * Il lucchetto del push a lotti del lancio: un push per volta, e basta.
 *
 * La prova "questo lead non e' mai arrivato al bot" e' l'evento BOT_PUSHED,
 * che si scrive lead per lead lungo i 240 s del lotto. Due esecuzioni
 * sovrapposte (doppio click, seconda scheda, secondo admin) leggerebbero la
 * stessa lista di candidati e aprirebbero due volte la stessa chat WhatsApp:
 * e' la forma esatta dell'incidente del 09/09, 42 persone con due aperture.
 *
 * Qui sta solo il pezzo puro — la chiave e la lettura della risposta — perche'
 * e' quello che si puo' sbagliare in silenzio.
 */

/** Chiave dell'advisory lock. Cambiarla = due push che non si vedono. */
export const LANCIO_PUSH_LOCK_KEY = 'lancio_push';

/**
 * Il lock e' stato preso? Legge la risposta di
 * `SELECT pg_try_advisory_xact_lock(...) AS preso` senza fidarsi della forma:
 * drizzle su node-postgres torna `{ rows: [...] }`, altri driver l'array
 * nudo. Qualunque cosa non sia un `true` booleano vale "occupato": sbagliare
 * cosi' ferma il push e lo si riclicca, sbagliare al contrario aprirebbe due
 * volte la stessa chat.
 */
export function lockPreso(res: unknown): boolean {
    const rows = Array.isArray(res)
        ? res
        : (res && typeof res === 'object' && Array.isArray((res as { rows?: unknown }).rows)
            ? (res as { rows: unknown[] }).rows
            : null);
    if (!rows || rows.length === 0) return false;
    const first = rows[0];
    if (!first || typeof first !== 'object') return false;
    return (first as { preso?: unknown }).preso === true;
}
