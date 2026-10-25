// "I miei risultati" del GDO in veste Diretta (collaudo del 25/10/2026): il
// periodo scelto, i numeri del GDO da getAdvancedKpi e le etichette
// dell'andamento. Niente database qui: la pagina legge, questo calcola.

import { dayBoundsRome, monthBoundsRome, previousYearMonth, toRomeDateStr } from '@/lib/dateUtils'

export const PERIODI = [
    { chiave: 'oggi', etichetta: 'Oggi' },
    { chiave: '7', etichetta: 'Ultimi 7 giorni' },
    { chiave: 'mese', etichetta: 'Questo mese' },
    { chiave: 'mese-scorso', etichetta: 'Mese scorso' },
] as const

export type ChiavePeriodo = (typeof PERIODI)[number]['chiave']

export interface Periodo {
    chiave: ChiavePeriodo
    start: Date
    end: Date
    /** 'hour' solo per oggi, come nella pagina di sempre. */
    granularita: 'hour' | 'day'
}

/**
 * I confini del periodo in ora di Roma, gli stessi della pagina /kpi-gdo di
 * sempre: oggi; gli ultimi 7 giorni compreso oggi; il mese di adesso; il mese
 * prima. Una chiave sconosciuta vale oggi.
 */
export function periodoRisultati(chiave: string | null | undefined, now: Date): Periodo {
    const ym = toRomeDateStr(now).slice(0, 7)
    switch (chiave) {
        case '7': {
            const inizio = dayBoundsRome(new Date(now.getTime() - 6 * 86_400_000))
            return { chiave: '7', start: inizio.start, end: dayBoundsRome(now).end, granularita: 'day' }
        }
        case 'mese': {
            const b = monthBoundsRome(ym)
            return { chiave: 'mese', start: b.start, end: b.end, granularita: 'day' }
        }
        case 'mese-scorso': {
            const b = monthBoundsRome(previousYearMonth(ym))
            return { chiave: 'mese-scorso', start: b.start, end: b.end, granularita: 'day' }
        }
        default: {
            const b = dayBoundsRome(now)
            return { chiave: 'oggi', start: b.start, end: b.end, granularita: 'hour' }
        }
    }
}

/** Una riga di getAdvancedKpi().gdoStats, coi soli campi che servono qui. */
export interface RigaGdo {
    calls: number
    answers: number
    contactedLeads: number
    appointments: number
    confirmed: number
    presenziati: number
}

export interface NumeriPeriodo {
    chiamate: number
    risposte: number
    /** Risposte su chiamate, in percentuale intera; null senza chiamate. */
    tassoRisposta: number | null
    leadChiamati: number
    appuntamenti: number
    /** Appuntamenti sui lead chiamati, in percentuale intera; null senza lead chiamati. */
    fissaggio: number | null
    confermati: number
    presentati: number
}

const percento = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)

/**
 * I numeri del GDO nel periodo. Filtrata per GDO, getAdvancedKpi ha al più
 * una riga per persona (le chiamate di chi guarda e gli appuntamenti dei suoi
 * lead): si sommano, così una riga in più non sparisce.
 */
export function numeriPeriodo(righe: readonly RigaGdo[]): NumeriPeriodo {
    const t = righe.reduce((s, r) => ({
        calls: s.calls + r.calls,
        answers: s.answers + r.answers,
        contactedLeads: s.contactedLeads + r.contactedLeads,
        appointments: s.appointments + r.appointments,
        confirmed: s.confirmed + r.confirmed,
        presenziati: s.presenziati + r.presenziati,
    }), { calls: 0, answers: 0, contactedLeads: 0, appointments: 0, confirmed: 0, presenziati: 0 })
    return {
        chiamate: t.calls,
        risposte: t.answers,
        tassoRisposta: percento(t.answers, t.calls),
        leadChiamati: t.contactedLeads,
        appuntamenti: t.appointments,
        fissaggio: percento(t.appointments, t.contactedLeads),
        confermati: t.confirmed,
        presentati: t.presenziati,
    }
}

const GIORNI: Record<string, string> = { Mon: 'lun', Tue: 'mar', Wed: 'mer', Thu: 'gio', Fri: 'ven', Sat: 'sab', Sun: 'dom' }

/** "Mon 26/10" (date-fns, in inglese) diventa "lun 26/10"; le ore restano come sono. */
export function etichettaAndamento(label: string): string {
    const [giorno, resto] = label.split(' ')
    return resto && GIORNI[giorno] ? `${GIORNI[giorno]} ${resto}` : label
}

export interface PuntoAndamento {
    etichetta: string
    chiamate: number
    appuntamenti: number
}

/**
 * Le righe dell'andamento: le ore del turno sempre, dei giorni solo quelli in
 * cui è successo qualcosa (le domeniche e i giorni di riposo non fanno righe).
 */
export function righeAndamento(punti: readonly { timeLabel: string; chiamate: number; appuntamenti: number }[], granularita: 'hour' | 'day'): PuntoAndamento[] {
    return punti
        .filter(p => granularita === 'hour' || p.chiamate > 0 || p.appuntamenti > 0)
        .map(p => ({ etichetta: etichettaAndamento(p.timeLabel), chiamate: p.chiamate, appuntamenti: p.appuntamenti }))
}
