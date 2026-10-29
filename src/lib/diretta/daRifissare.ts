// Appuntamenti "da rifissare" visti dal GDO (PO 29/10/2026).
//
// Quando le Conferme mettono un appuntamento "da rifissare" (scheduleConfermeRecall
// con needsReschedule), il CRM azzera appointmentDate, accende confNeedsReschedule
// e mette in recallDate il giorno in cui le Conferme richiamano il lead. Lo stato
// resta APPOINTMENT e il lead resta del GDO, ma senza data spariva da "In programma":
// il GDO non sapeva più dove fosse (caso Eleonora, GDO 119, 29/10/2026).
//
// Chi lo rifissa non cambia: sono le Conferme. Il GDO deve solo vederlo, con la
// data del richiamo e la nota delle Conferme.
//
// Funzioni pure, senza DB.

import { PAROLE_VIETATE } from './vistaGdo'

export interface LeadPerRifissaggio {
    status: string | null
    appointmentDate: Date | string | null
    confNeedsReschedule: boolean | null
    confirmationsOutcome: string | null
}

/**
 * Il lead è in mano alle Conferme per essere rifissato: appuntamento senza data,
 * messo "da rifissare" dalle Conferme e senza un loro esito. È la stessa regola
 * dell'avviso dei richiami delle Conferme (confirmationsOutcome vuoto): un lead
 * già scartato o confermato non è più un richiamo da fare.
 */
export function daRifissareDalleConferme(l: LeadPerRifissaggio): boolean {
    return l.status === 'APPOINTMENT'
        && !l.appointmentDate
        && l.confNeedsReschedule === true
        && !l.confirmationsOutcome
}

/**
 * Divide gli appuntamenti senza data: prima quelli che le Conferme stanno
 * rifissando (per data del richiamo, i più vicini in alto), poi tutti gli altri
 * nell'ordine in cui arrivano.
 */
export function dividiRifissaggi<T extends LeadPerRifissaggio & { recallDate?: Date | string | null }>(
    lista: readonly T[],
): { attivi: T[]; altri: T[] } {
    const attivi: T[] = []
    const altri: T[] = []
    for (const l of lista) (daRifissareDalleConferme(l) ? attivi : altri).push(l)
    const t = (v: Date | string | null | undefined) => {
        if (!v) return Infinity
        const n = new Date(v).getTime()
        return Number.isNaN(n) ? Infinity : n
    }
    attivi.sort((a, b) => { const ta = t(a.recallDate), tb = t(b.recallDate); return ta === tb ? 0 : ta - tb })
    return { attivi, altri }
}

/**
 * La nota delle Conferme come la può leggere un GDO: niente se è vuota o se
 * nomina il bot (regola PO 25/10/2026: nessuna schermata GDO lo nomina).
 */
export function notaConfermePerGdo(nota: string | null | undefined): string | null {
    const t = typeof nota === 'string' ? nota.trim() : ''
    if (!t) return null
    return PAROLE_VIETATE.test(t) ? null : t
}
