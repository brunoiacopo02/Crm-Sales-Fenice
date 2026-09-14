import type { LancioPayloadField } from '@/lib/lancio/intake';

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

/**
 * Esiti di push dopo i quali un lead NON va rispinto dai percorsi a lotti
 * (sync di recupero del lancio, push admin). I consegnati ovviamente; e in piu'
 * `network_error`, perche' un timeout nostro non dice che la richiesta non sia
 * arrivata: il 09/09 42 persone hanno ricevuto due aperture WhatsApp proprio
 * cosi'. Un lead in network_error si ripassa a mano, guardando la chat.
 */
export const NO_REPUSH_RESULTS = ['sent', 'duplicate', 'network_error'] as const;

export const NO_REPUSH_RESULTS_SQL = NO_REPUSH_RESULTS
    .map(r => `'${r}'`)
    .join(', ');

/**
 * Metadata dell'evento BOT_PUSHED: l'esito, l'istante e — sui lead del lancio —
 * lo slug, cosi' il monitor del lancio conta i push suoi con una sola query
 * (`metadata->>'lancio' = 'webdev-2026-10'`) senza join sui lead.
 */
export function withLancioAudit<T extends object>(
    meta: T,
    payload: { lancio?: LancioPayloadField },
    at: Date,
): T & { at: string; lancio?: string } {
    return {
        ...meta,
        at: at.toISOString(),
        ...(payload.lancio ? { lancio: payload.lancio.slug } : {}),
    };
}
