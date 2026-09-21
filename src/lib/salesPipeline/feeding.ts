/**
 * Da dove arrivano i lead della pipeline del venditore.
 *
 * Puro: decide, non scrive. Il DB lo tocca chi chiama.
 */

import { canDivertFresh, type SalesPipelineConfig } from './config'
// Il nome del funnel del lancio si IMPORTA, non si ricopia: una seconda copia
// prima o poi diverge da quella vera (stessa regola del bucket, sotto).
import { LANCIO_FUNNEL } from '../lancio/intake'

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
 *
 * `diverted` e' "quanti gia' dirottati OGGI" (giorno Europe/Rome), non da
 * sempre: il tetto e' giornaliero. Questa funzione e' pura e non conosce le
 * date — riceve gia' il numero, scoped al giorno da chi la chiama.
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

/**
 * La decisione completa, in una funzione sola: a chi va questo lead fresco, o
 * `null` per "segui il routing di sempre".
 *
 * Esiste perche' la proprieta' che protegge la produzione — *a pipeline spenta
 * il GDO scelto e' esattamente lo stesso di prima* — era difesa solo dalla
 * prosa di un commento. Qui e' una funzione pura con un test sopra.
 *
 * Il confronto sul funnel e' insensibile a maiuscole e spazi: e' un testo che
 * arriva da ActiveCampaign, e un'iscritta al webinar del 5/10 non deve poter
 * finire nella pipeline del venditore per una lettera maiuscola.
 */
export function decideDiversion(input: {
    cfg: SalesPipelineConfig
    diverted: number
    funnel: string | null
    launchBucket: string | null
    phoneSuspicious: boolean
}): string | null {
    const funnel = (input.funnel ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (funnel === LANCIO_FUNNEL.trim().replace(/\s+/g, ' ').toLowerCase()) return null
    if (!shouldDivertFreshLead({
        cfg: input.cfg,
        diverted: input.diverted,
        launchBucket: input.launchBucket,
        phoneSuspicious: input.phoneSuspicious,
    })) return null
    return input.cfg.salesUserId
}
