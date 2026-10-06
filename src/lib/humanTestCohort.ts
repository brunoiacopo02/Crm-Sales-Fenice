import { apptSetAt, isAnsweredLog, isFunnelClosure } from "@/lib/kpi/canon"

/**
 * Test "solo umani" del lancio Web Developer AI (PO 06/10/2026, migr. 0040):
 * 400 lead che hanno visto la live, tolti al bot e dati ai GDO 106 e 119.
 * Restano lead normali (tutte le KPI li contano gia'): qui c'e' solo la
 * vista dedicata filtrata su `leads.humanTestCohort`.
 */
export const LANCIO_UMANI_COHORT = 'LANCIO_UMANI_20261007'

/** Motivo scritto nei metadata dell'evento REASSIGNED_ADMIN dallo script di assegnazione. */
export const LANCIO_UMANI_EVENT_REASON = 'lancio_test_umani'

/** Un lead del gruppo, coi soli campi che servono al conteggio. */
export type LeadCohortRow = {
    id: string
    gdoUserId: string | null
    gdoCode: number | null
    gdoNome: string | null
    status: string
    callCount: number
    recallDate: Date | null
    appointmentDate: Date | null
    appointmentCreatedAt: Date | null
    presentedAt: Date | null
    salespersonOutcome: string | null
    closeAmountEur: number | null
    /** Quando il lead e' entrato nel test (timestamp dell'evento REASSIGNED_ADMIN). */
    cohortAt: Date | null
}

/**
 * Una chiamata registrata su un lead del gruppo. Il chiamante deve aver gia'
 * tolto le righe del bot e dei venditori (come /kpi-gdo, kpiAdvancedActions.ts:100-119).
 */
export type ChiamataCohort = {
    leadId: string
    outcome: string | null
    discardReason: string | null
    createdAt: Date
}

export type StatsLancioUmani = {
    leadDati: number
    /** Almeno una chiamata di un GDO dopo l'ingresso nel test. */
    chiamati: number
    /** Almeno una chiamata con risposta (isAnsweredLog, regola canonica). */
    risposto: number
    /** Appuntamento fissato dopo l'ingresso nel test (apptSetAt, regola canonica). */
    appuntamenti: number
    /** Fra i fissati: presenza registrata (latch presentedAt). */
    presentati: number
    /** Fra i fissati: chiusura di funnel (Chiuso + presentedAt, isFunnelClosure). */
    vendite: number
    /** Somma di closeAmountEur delle vendite. */
    venduto: number
    scartati: number
    /** NEW e mai chiamati. */
    daLavorare: number
    /** In lavorazione con un richiamo programmato. */
    daRichiamare: number
}

export type StatsGdoLancioUmani = StatsLancioUmani & {
    gdoUserId: string | null
    gdoCode: number | null
    gdoNome: string | null
}

/** Una riga della lista lead della pagina /lancio-umani. */
export type LeadLancioUmani = {
    id: string
    nome: string
    telefono: string
    gdoUserId: string | null
    gdoCode: number | null
    gdoNome: string | null
    status: string
    callCount: number
    lastCallDate: string | null
    recallDate: string | null
    appointmentDate: string | null
    confirmationsOutcome: string | null
    salespersonOutcome: string | null
    closeAmountEur: number | null
    discardReason: string | null
    zoomMinuti: number | null
}

export type LancioUmaniDati = {
    perGdo: StatsGdoLancioUmani[]
    totale: StatsLancioUmani
    leads: LeadLancioUmani[]
}

const vuote = (): StatsLancioUmani => ({
    leadDati: 0, chiamati: 0, risposto: 0, appuntamenti: 0, presentati: 0,
    vendite: 0, venduto: 0, scartati: 0, daLavorare: 0, daRichiamare: 0,
})

/** Percentuale intera (null se il denominatore e' zero). */
export function percentuale(n: number, d: number): number | null {
    return d > 0 ? Math.round((n / d) * 100) : null
}

/** Appuntamento fissato dentro il test: le date di prima dell'ingresso non contano. */
function fissatoNelTest(l: LeadCohortRow): boolean {
    const at = apptSetAt(l)
    if (!at) return false
    return !l.cohortAt || at.getTime() >= l.cohortAt.getTime()
}

/**
 * Funnel del test per GDO (quello a cui il test ha dato il lead) e totale. Funzione pura:
 * le stesse regole di /kpi-gdo, ristrette ai lead del gruppo e alle sole
 * chiamate fatte dopo l'ingresso nel test (prima li lavorava il bot).
 */
export function calcolaStatsLancioUmani(
    leadRows: LeadCohortRow[],
    chiamate: ChiamataCohort[],
): { perGdo: StatsGdoLancioUmani[]; totale: StatsLancioUmani } {
    const ingresso = new Map(leadRows.map(l => [l.id, l.cohortAt]))
    const chiamati = new Set<string>()
    const risposto = new Set<string>()
    for (const c of chiamate) {
        if (!ingresso.has(c.leadId)) continue
        const da = ingresso.get(c.leadId)
        if (da && c.createdAt.getTime() < da.getTime()) continue
        chiamati.add(c.leadId)
        if (isAnsweredLog(c.outcome, c.discardReason)) risposto.add(c.leadId)
    }

    const totale = vuote()
    const perGdo = new Map<string, StatsGdoLancioUmani>()
    for (const l of leadRows) {
        const chiave = l.gdoUserId ?? '—'
        let g = perGdo.get(chiave)
        if (!g) {
            g = { ...vuote(), gdoUserId: l.gdoUserId, gdoCode: l.gdoCode, gdoNome: l.gdoNome }
            perGdo.set(chiave, g)
        }
        for (const s of [totale, g]) {
            s.leadDati++
            if (chiamati.has(l.id)) s.chiamati++
            if (risposto.has(l.id)) s.risposto++
            if (l.status === 'REJECTED') s.scartati++
            if (l.status === 'NEW' && l.callCount === 0) s.daLavorare++
            if (l.status === 'IN_PROGRESS' && l.recallDate) s.daRichiamare++
            if (fissatoNelTest(l)) {
                s.appuntamenti++
                if (l.presentedAt) s.presentati++
                if (isFunnelClosure(l)) {
                    s.vendite++
                    s.venduto += l.closeAmountEur ?? 0
                }
            }
        }
    }
    const ordinati = [...perGdo.values()].sort((a, b) => (a.gdoCode ?? 9999) - (b.gdoCode ?? 9999))
    return { perGdo: ordinati, totale }
}
