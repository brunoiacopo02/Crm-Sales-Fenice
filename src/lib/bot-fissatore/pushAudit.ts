/**
 * Quali esiti di `BOT_PUSHED` valgono come "il lead È arrivato al bot".
 *
 * `BOT_PUSHED` viene scritto per OGNI tentativo, anche fallito
 * (skipped_disabled / missing_env / http_error / rate_limited / network_error):
 * quelli sono lead che al bot non sono mai arrivati e non provano nulla.
 *
 * Consegnati sono due:
 *  - `sent`      → il fornitore ha accettato il lead;
 *  - `duplicate` → il fornitore lo aveva già (`duplicato:true`, contratto
 *                  2026-09-09): è la risposta a un nostro ritento andato a segno,
 *                  quindi il lead è da lui esattamente come un `sent`.
 *
 * ⚠️ Questa nozione è usata in tre posti che DEVONO restare allineati: la prova
 * di appartenenza di `/api/bot/outcome` (senza la quale il bot si vede rifiutare
 * l'appuntamento con un 403), la coorte di `/api/bot/lead-status` e i conteggi di
 * `botStatsActions`. Se divergono, le percentuali di /statistiche-fissatore non
 * tornano più con il proprio numeratore. Da qui la costante unica.
 */

/** Esiti di push che provano la consegna al bot. */
export const DELIVERED_PUSH_RESULTS = ['sent', 'duplicate'] as const;

/** Frammento SQL per `metadata->>'result'`, già quotato. */
export const DELIVERED_PUSH_RESULTS_SQL = DELIVERED_PUSH_RESULTS
    .map(r => `'${r}'`)
    .join(', ');

export function isDeliveredPushResult(result: string | null | undefined): boolean {
    return !!result && (DELIVERED_PUSH_RESULTS as readonly string[]).includes(result);
}
