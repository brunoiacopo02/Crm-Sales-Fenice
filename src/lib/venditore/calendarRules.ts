/**
 * Le tre regole economiche del calendario disponibilità.
 *
 * Tutte pure: nessun accesso al DB, nessun `new Date()` implicito. Chi chiama
 * passa `now`, così le regole sono testabili al minuto e il cron è idempotente
 * per costruzione.
 */

import { weeklyDeadline } from './calendarSlots'
import { romeMonthKey, type PenaltyRuleState } from './latePenalties'

/** Trattenuta delle due multe nuove. I 10 € dei ritardi restano dove sono. */
export const CALENDAR_PENALTY_EUR = 50
/** Preavviso minimo per bloccare uno slot per imprevisto. */
export const MANUAL_BLOCK_NOTICE_MINUTES = 60
/** Oltre questa finestra lo slot è troppo vecchio per essere segnalato. */
export const ABSENCE_REPORT_WINDOW_HOURS = 48

export type CalendarPenaltyKind = 'CALENDAR_MISSING' | 'ABSENT_SLOT'

export interface CalendarUserRow {
    id: string
    companyId: string
    isActive: boolean
    calendarExempt: boolean
}

export interface PendingCalendarPenalty {
    salesUserId: string
    companyId: string
    kind: CalendarPenaltyKind
    dueAt: Date
    monthKey: string
    amountEur: number
}

/**
 * Chi va multato per non aver compilato la settimana.
 *
 * `notBefore` è la data di attivazione della regola: senza, o con una scadenza
 * anteriore, non si registra nulla. È la stessa protezione del malus ritardi —
 * una regola nuova non deve mai poter multare il passato.
 */
export function selectMissingCalendarPenalties(
    users: CalendarUserRow[],
    submittedUserIds: Set<string>,
    weekStart: Date,
    now: Date,
    notBefore: Date | null,
): PendingCalendarPenalty[] {
    if (!notBefore) return []
    const dueAt = weeklyDeadline(weekStart)
    if (now < dueAt) return []
    if (dueAt < notBefore) return []

    return users
        .filter(u => u.isActive && !u.calendarExempt && !submittedUserIds.has(u.id))
        .map(u => ({
            salesUserId: u.id,
            companyId: u.companyId,
            kind: 'CALENDAR_MISSING' as const,
            dueAt,
            monthKey: romeMonthKey(dueAt),
            amountEur: CALENDAR_PENALTY_EUR,
        }))
}

export type BlockRefusal =
    | 'preavviso_insufficiente'
    | 'slot_non_dichiarato'
    | 'appuntamento_presente'
    | 'gia_bloccato'

export type BlockDecision = { ok: true } | { ok: false; reason: BlockRefusal }

/**
 * Un venditore può bloccare uno slot per imprevisto solo con più di un'ora di
 * preavviso e solo se non c'è già un appuntamento dentro: senza quest'ultima
 * guardia basterebbe bloccare a 61 minuti dall'appuntamento per non pagare.
 */
export function manualBlockCheck(input: {
    slotStart: Date
    now: Date
    declared: boolean
    hasAppointment: boolean
    alreadyBlocked: boolean
}): BlockDecision {
    if (!input.declared) return { ok: false, reason: 'slot_non_dichiarato' }
    if (input.alreadyBlocked) return { ok: false, reason: 'gia_bloccato' }
    if (input.hasAppointment) return { ok: false, reason: 'appuntamento_presente' }
    const minutiDiPreavviso = (input.slotStart.getTime() - input.now.getTime()) / 60_000
    if (minutiDiPreavviso <= MANUAL_BLOCK_NOTICE_MINUTES) {
        return { ok: false, reason: 'preavviso_insufficiente' }
    }
    return { ok: true }
}

export function blockRefusalMessage(reason: BlockRefusal, slotStart: Date): string {
    const ora = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(slotStart)
    switch (reason) {
        case 'preavviso_insufficiente':
            return `Troppo tardi: uno slot si blocca almeno un'ora prima. Le ${ora} restano disponibili.`
        case 'slot_non_dichiarato':
            return 'Questo slot non è fra quelli che hai dichiarato disponibili.'
        case 'appuntamento_presente':
            return `C'è un appuntamento alle ${ora}: avvisa le Conferme per spostarlo.`
        case 'gia_bloccato':
            return 'Questo slot è già bloccato.'
    }
}

export type AbsenceRefusal =
    | 'venditore_esente'
    | 'slot_futuro'
    | 'finestra_scaduta'
    | 'non_dichiarato'
    | 'slot_bloccato'
    | 'gia_segnalato'

export type AbsenceDecision = { ok: true } | { ok: false; reason: AbsenceRefusal }

/**
 * Ammissibilità della segnalazione "non c'era". L'ordine dei controlli è
 * l'ordine dei messaggi: si dice per prima la cosa più utile a chi guarda il
 * bottone spento.
 */
export function absenceReportCheck(input: {
    slotStart: Date
    now: Date
    declared: boolean
    blocked: boolean
    exempt: boolean
    alreadyReported: boolean
}): AbsenceDecision {
    if (input.exempt) return { ok: false, reason: 'venditore_esente' }
    if (input.now < input.slotStart) return { ok: false, reason: 'slot_futuro' }
    const oreTrascorse = (input.now.getTime() - input.slotStart.getTime()) / 3_600_000
    if (oreTrascorse > ABSENCE_REPORT_WINDOW_HOURS) return { ok: false, reason: 'finestra_scaduta' }
    if (!input.declared) return { ok: false, reason: 'non_dichiarato' }
    if (input.blocked) return { ok: false, reason: 'slot_bloccato' }
    if (input.alreadyReported) return { ok: false, reason: 'gia_segnalato' }
    return { ok: true }
}

export function absenceRefusalMessage(reason: AbsenceRefusal): string {
    switch (reason) {
        case 'venditore_esente': return 'Questo venditore è esente dal calendario.'
        case 'slot_futuro': return "Lo slot non è ancora iniziato."
        case 'finestra_scaduta': return 'Sono passate più di 48 ore: la segnalazione non è più possibile.'
        case 'non_dichiarato': return 'Questo slot non era dichiarato disponibile: non può generare multa.'
        case 'slot_bloccato': return 'Lo slot era bloccato: il venditore aveva avvisato.'
        case 'gia_segnalato': return 'Assenza già segnalata per questo slot.'
    }
}

/**
 * Stato della regola calendario, gemello di `penaltyRuleState` dei ritardi.
 * Una sezione vuota perché nessuno è in ritardo e una vuota perché la regola
 * non è mai stata accesa si assomigliano troppo: la seconda sembra un guasto.
 */
export function calendarRuleState(): PenaltyRuleState {
    const raw = process.env.SALES_CALENDAR_PENALTIES_FROM
    const from = raw ? new Date(raw) : null
    const valid = from && !isNaN(from.getTime()) ? from : null
    if (process.env.SALES_CALENDAR_PENALTIES === 'off') {
        return { active: false, reason: 'kill_switch', from: valid }
    }
    if (!valid) return { active: false, reason: 'not_activated', from: null }
    return { active: true, from: valid }
}
