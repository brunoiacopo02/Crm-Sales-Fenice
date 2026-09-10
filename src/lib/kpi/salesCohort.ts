/**
 * Regola canonica del CLOSING RATE di un venditore (decisione PO 2026-09-10).
 *
 * Il closing rate è un rapporto di COORTE: si misura sulle presenze maturate nel
 * mese, non sugli esiti registrati nel mese.
 *
 *   denominatore = lead con `presentedAt` nel mese (latch presenze, PO 2026-07-17)
 *   numeratore   = quelli fra loro il cui esito corrente è 'Chiuso'
 *
 * ⚠️ NON si conta sul mese di `salespersonOutcomeAt`: quel campo si sposta a OGNI
 * follow-up, quindi la presenza di agosto ricadeva nel denominatore di settembre
 * appena il venditore registrava un "Non chiuso" di richiamo — e le presenze di
 * settembre ancora da esitare non ci entravano affatto. Settembre 2026 contava
 * 111 "esitati" contro 81 presenze reali: Sales 008 risultava al 29% invece che
 * al 47%, Sales 004 al 18% invece che al 26%.
 *
 * Conseguenze accettate dal PO scegliendo la coorte:
 *  - una presenza di fine mese ancora in lavorazione sta al denominatore e
 *    abbassa il rate finché non viene esitata (per questo `inLavorazione` è
 *    esposto: va mostrato accanto al rate, non nascosto);
 *  - una chiusura tardiva alza retroattivamente il mese della presenza.
 *
 * Il fatturato NON segue questa regola: resta attribuito al mese della firma
 * (`salespersonOutcomeAt`), che è il mese in cui i soldi entrano ed è la base su
 * cui girano target, bonus e riconciliazione col foglio.
 *
 * Gemella di `funnelStages.ts`, che tiene la stessa regola per la Panoramica.
 */

export interface CohortLead {
    /** Latch della presenza: giorno dell'appuntamento presenziato. */
    presentedAt: Date | null
    /** Esito corrente del venditore sul lead ('Chiuso' | 'Non chiuso' | 'Sparito' | 'Perso' | null). */
    salespersonOutcome: string | null
}

export interface CohortClosing {
    /** Presenze maturate nel mese: il denominatore. */
    presenze: number
    chiusi: number
    nonChiusi: number
    spariti: number
    persi: number
    /** Presenze del mese ancora senza esito: stanno nel denominatore. */
    inLavorazione: number
    /** `chiusi / presenze` in percentuale intera; 0 se non ci sono presenze. */
    closingPct: number
}

/** `d` cade in [start, end)? */
function inRange(d: Date | null | undefined, start: Date, end: Date): boolean {
    return !!d && d >= start && d < end
}

/** Il lead è una presenza del mese `[monthStart, monthEnd)`? */
export function isCohortPresence(lead: CohortLead, monthStart: Date, monthEnd: Date): boolean {
    return inRange(lead.presentedAt, monthStart, monthEnd)
}

/**
 * Scompone la coorte di presenze del mese per esito corrente.
 * `leads` va passato già filtrato per venditore: questa funzione non attribuisce.
 */
export function cohortClosing(
    leads: CohortLead[],
    monthStart: Date,
    monthEnd: Date,
): CohortClosing {
    const presenze = leads.filter(l => isCohortPresence(l, monthStart, monthEnd))

    const chiusi = presenze.filter(l => l.salespersonOutcome === 'Chiuso').length
    const nonChiusi = presenze.filter(l => l.salespersonOutcome === 'Non chiuso').length
    const spariti = presenze.filter(l => l.salespersonOutcome === 'Sparito').length
    const persi = presenze.filter(l => l.salespersonOutcome === 'Perso').length
    const inLavorazione = presenze.length - chiusi - nonChiusi - spariti - persi

    return {
        presenze: presenze.length,
        chiusi,
        nonChiusi,
        spariti,
        persi,
        inLavorazione,
        closingPct: presenze.length > 0 ? Math.round((chiusi / presenze.length) * 100) : 0,
    }
}
