/**
 * Regola canonica di attribuzione al mese degli stage del funnel CRM
 * (app → conferme → trattative → chiusure), condivisa da Panoramica Generale
 * e Marketing Analytics.
 *
 * Ogni stage è attribuito al mese in cui è avvenuta l'AZIONE corrispondente,
 * non al mese di creazione del lead:
 *  - app        → `apptSetAt` (quando il GDO l'ha fissato)
 *  - conferme   → `confirmationsTimestamp`
 *  - trattative → latch `presentedAt` (PO 2026-07-17)
 *  - chiusure   → `salespersonOutcomeAt`
 *
 * ⚠️ Le trattative NON si contano su `salespersonOutcome ∈ {Chiuso, Non chiuso}`
 * + `salespersonOutcomeAt`: quel campo si sposta a OGNI follow-up, quindi una
 * presenza di agosto migrava a settembre appena il venditore registrava un
 * "Non chiuso" di follow-up — gonfiando il mese corrente e svuotando quello in
 * cui il cliente si era davvero presentato (settembre 2026: 91 trattative
 * contate contro 70 reali, 20 delle quali erano presenze di mesi precedenti).
 * `presentedAt` è il latch immutabile del giorno dell'appuntamento presenziato.
 */

import { apptSetAt } from './canon'

export interface FunnelStageLead {
    appointmentDate: Date | null
    appointmentCreatedAt: Date | null
    confirmationsOutcome: string | null
    confirmationsTimestamp: Date | null
    salespersonOutcome: string | null
    salespersonOutcomeAt: Date | null
    presentedAt: Date | null
    closeAmountEur: number | null
    /** Upsell (migr. 0064): euro nel fatturato, ma `close` resta false. */
    closeIsUpsell?: boolean | null
}

export interface FunnelStageHits {
    app: boolean
    conferme: boolean
    trattative: boolean
    /** Chiusura da CONTARE (upsell esclusi, titolare 21/11/2026). */
    close: boolean
    /**
     * Fatturato da sommare: valorizzato per ogni 'Chiuso' firmato nel mese,
     * upsell compresi. Sommarlo a prescindere da `close`.
     */
    fatturato: number
}

/** `d` cade in [start, end)? */
function inRange(d: Date | null | undefined, start: Date, end: Date): boolean {
    return !!d && d >= start && d < end
}

/**
 * Stage da incrementare per questo lead nel mese `[monthStart, monthEnd)`.
 * Ogni stage è indipendente: un lead può contare come conferma a luglio e come
 * trattativa ad agosto senza essere contato due volte nello stesso stage.
 */
export function stageHits(
    lead: FunnelStageLead,
    monthStart: Date,
    monthEnd: Date,
): FunnelStageHits {
    const firma = lead.salespersonOutcome === 'Chiuso'
        && inRange(lead.salespersonOutcomeAt, monthStart, monthEnd)

    return {
        app: !!lead.appointmentDate && inRange(apptSetAt(lead), monthStart, monthEnd),
        conferme: lead.confirmationsOutcome === 'confermato'
            && inRange(lead.confirmationsTimestamp, monthStart, monthEnd),
        trattative: lead.closeIsUpsell !== true && inRange(lead.presentedAt, monthStart, monthEnd),
        close: firma && lead.closeIsUpsell !== true,
        fatturato: firma ? (lead.closeAmountEur || 0) : 0,
    }
}
