/**
 * Da dove arrivano i lead della pipeline del venditore.
 *
 * Puro: decide, non scrive. Il DB lo tocca chi chiama.
 */

import { canDivertFresh, type SalesPipelineConfig } from './config'

// Nota: NON ridefinire qui il bucket del lancio. Esiste gia' in
// `src/lib/lancio/intake.ts:17` e una seconda copia prima o poi diverge da
// quella vera. Qui non serve affatto: la guardia sotto rifiuta QUALUNQUE
// launchBucket, e il lancio e' compreso.

/**
 * I GDO dal piu' carico al meno carico, per andare a prendere i ridati da chi
 * e' ingolfato e non da chi sta smaltendo. `gdoId` come tiebreaker: senza, due
 * GDO con lo stesso carico si scambiano di posto a ogni giro e la stessa
 * richiesta pesca lead diversi.
 */
export function pickMostLoadedGdo(rows: { gdoId: string; nuovi: number }[]): string[] {
    return [...rows]
        .sort((a, b) => b.nuovi - a.nuovi || a.gdoId.localeCompare(b.gdoId))
        .map(r => r.gdoId)
}

/**
 * Si dirotta questo lead fresco al venditore?
 *
 * Tutto cio' che non e' un lead fresco e pulito passa oltre e segue il routing
 * di sempre. In particolare qualunque `launchBucket` esclude: i pool (lancio,
 * database mensili, Black Summer) hanno un giro loro, e un lead pescato via da
 * li' sparirebbe da conteggi che qualcun altro sta guardando.
 */
export function shouldDivertFreshLead(input: {
    cfg: SalesPipelineConfig
    diverted: number
    launchBucket: string | null
    phoneSuspicious: boolean
}): boolean {
    if (input.launchBucket) return false
    if (input.phoneSuspicious) return false
    return canDivertFresh(input.cfg, input.diverted)
}
