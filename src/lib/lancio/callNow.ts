/**
 * Ciclo delle "chiamate subito" (spec §4.4 + assunzione A1): il venditore di
 * turno chiama, e a ogni "Non risponde" il lead scala di colonna. Al terzo NR
 * il lead passa alle Conferme il giorno dopo alle 09:00, senza venditore.
 * Puro: `now` esplicito, niente DB.
 */
import { romeHour, romeInstant } from '@/lib/venditore/calendarSlots'
import { toRomeDateStr } from '@/lib/dateUtils'
import { CALL_NOW_MAX_ATTEMPTS, CALL_NOW_RETRY_MINUTES, LANCIO_WEBDEV, MIN_LEAD_TIME_MS, type LancioConfig } from './config'

export type CallNowColumn = 'da_chiamare' | 'seconda' | 'terza' | 'esitati'

export function callNowColumn(lead: { lancioCallNowAttempts: number; salespersonOutcome: string | null }): CallNowColumn {
    if (lead.salespersonOutcome) return 'esitati'
    if (lead.lancioCallNowAttempts <= 0) return 'da_chiamare'
    if (lead.lancioCallNowAttempts === 1) return 'seconda'
    if (lead.lancioCallNowAttempts === 2) return 'terza'
    return 'esitati'
}

/**
 * Quando le Conferme devono richiamare chi non ha risposto tre volte:
 * le 09:00 del giorno dopo, o — se sono già passate — la prossima ora tonda
 * che lascia almeno un'ora di respiro.
 *
 * Oltre l'ultima ora servita dalle Conferme il 6/10 (le 20:00) si scivola alle
 * 09:00 del 7/10: senza questo, un terzo NR della sera del 6 fissava le 22:00 o
 * l'una di notte, ore in cui non c'è nessuno al telefono e che nemmeno
 * `classifyAt` accetterebbe.
 */
export function handoffAppointmentAt(now: Date, cfg: LancioConfig = LANCIO_WEBDEV): Date {
    const nove = romeInstant(cfg.giornoDopo, 9)
    if (now.getTime() < nove.getTime()) return nove
    const min = new Date(now.getTime() + MIN_LEAD_TIME_MS)
    const dateStr = toRomeDateStr(min)
    let hour = romeHour(min)
    // Se `min` non è un'ora tonda, la prossima ora piena.
    if (romeInstant(dateStr, hour).getTime() < min.getTime()) hour += 1
    // Il controllo si fa su data+ora e NON sull'istante costruito: dopo le 23:00
    // `hour` vale 24 e `romeInstant` non saprebbe che farsene.
    const ultima = cfg.orePomeriggio[cfg.orePomeriggio.length - 1] ?? 20
    if (dateStr !== cfg.giornoDopo || hour > ultima) return romeInstant(cfg.dopodomani, 9)
    return romeInstant(dateStr, hour)
}

export type CallNowNext =
    | { kind: 'retry'; attempts: number; nextAt: Date }
    | { kind: 'handoff'; attempts: number; appointmentAt: Date }

export function nextCallNowState(attemptsSoFar: number, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): CallNowNext {
    // Il contatore non supera mai il tetto: un doppio click sul "Non risponde"
    // della terza colonna non deve scrivere `4` su lancioCallNowAttempts.
    const attempts = Math.min(attemptsSoFar + 1, CALL_NOW_MAX_ATTEMPTS)
    if (attempts >= CALL_NOW_MAX_ATTEMPTS) {
        return { kind: 'handoff', attempts, appointmentAt: handoffAppointmentAt(now, cfg) }
    }
    return { kind: 'retry', attempts, nextAt: new Date(now.getTime() + CALL_NOW_RETRY_MINUTES * 60_000) }
}
