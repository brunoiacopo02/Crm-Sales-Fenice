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
 * Il lead sta ANCORA dentro il ciclo delle chiamate subito?
 *
 * È l'unico criterio con cui il CRM decide che questo lead non è un
 * appuntamento normale: sta nella scheda del venditore, non in Lista né in
 * Agenda, non fa scattare l'OutcomeGate e non matura multe.
 *
 * Il ciclo si CHIUDE in due modi, e in entrambi il lead torna un appuntamento
 * come tutti gli altri:
 *  - tre NR: il lead è passato alle Conferme (`attempts >= 3`). Se poi le
 *    Conferme lo ri-confermano e lo riassegnano a un venditore, quello è un
 *    appuntamento vero, con la sua scadenza e le sue multe.
 *  - c'è un esito: la serata per quel lead è finita.
 *
 * Senza questa distinzione — cioè guardando il solo `lancioScelta`, come
 * faceva la prima versione — un lead ri-confermato restava invisibile per
 * sempre: fuori dalla Lista, fuori dall'Agenda, fuori dal gate e fuori dalle
 * multe, e nella scheda compariva al più in "Esitati", senza bottoni.
 *
 * Il gemello SQL sta in `callNowSql.ts`: cambiando questa regola vanno
 * cambiati tutti e due.
 */
export function isInCallNowCycle(lead: {
    lancioScelta: string | null | undefined
    lancioCallNowAttempts: number | null | undefined
    salespersonOutcome: string | null | undefined
}): boolean {
    return lead.lancioScelta === 'chiamata_subito'
        && (lead.lancioCallNowAttempts ?? 0) < CALL_NOW_MAX_ATTEMPTS
        && (lead.salespersonOutcome ?? null) === null
}

/**
 * Finestra della scheda venditore: la tab guarda solo le scelte delle ultime
 * 72 ore. Il lancio dura una sera; senza questo limite la tab (e il suo badge)
 * resterebbero attaccati al venditore per sempre, anche a novembre.
 */
export const CALL_NOW_TAB_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Quanti lead restano da lavorare nella scheda: il badge della tab del
 * venditore. Gli "esitati" non contano — sono lì solo per memoria della serata.
 */
export function callNowPendingCount(leads: Array<{ column: CallNowColumn }>): number {
    return leads.filter(l => l.column !== 'esitati').length
}

/** Il giorno italiano dopo `dateStr`. Mezzogiorno: nessun cambio d'ora legale lo sposta. */
function giornoSuccessivo(dateStr: string): string {
    return toRomeDateStr(new Date(romeInstant(dateStr, 12).getTime() + 24 * 60 * 60 * 1000))
}

/**
 * Quando le Conferme devono richiamare chi non ha risposto tre volte:
 * le 09:00 del giorno dopo, o — se sono già passate — la prossima ora tonda
 * che lascia almeno un'ora di respiro.
 *
 * Oltre l'ultima ora servita dalle Conferme (le 20:00) si scivola alle 09:00
 * del giorno dopo: senza questo, un terzo NR della sera fissava le 22:00 o
 * l'una di notte, ore in cui non c'è nessuno al telefono e che nemmeno
 * `classifyAt` accetterebbe.
 *
 * La finestra 9-20 si applica a QUALUNQUE giorno, non solo al 6/10: quando la
 * regola guardava solo `cfg.giornoDopo`, ogni `now` del 7/10 cadeva nel ramo
 * "scivola" e tornava le 09:00 del 7/10 — cioè un appuntamento nel passato.
 * Questa funzione non restituisce mai un istante prima di `now`.
 */
export function handoffAppointmentAt(now: Date, cfg: LancioConfig = LANCIO_WEBDEV): Date {
    const prima = cfg.oreVenditori[0] ?? 9
    const nove = romeInstant(cfg.giornoDopo, prima)
    if (now.getTime() < nove.getTime()) return nove
    const min = new Date(now.getTime() + MIN_LEAD_TIME_MS)
    const dateStr = toRomeDateStr(min)
    let hour = romeHour(min)
    // Se `min` non è un'ora tonda, la prossima ora piena.
    if (romeInstant(dateStr, hour).getTime() < min.getTime()) hour += 1
    // Il controllo si fa su data+ora e NON sull'istante costruito: dopo le 23:00
    // `hour` vale 24 e `romeInstant` non saprebbe che farsene.
    const ultima = cfg.orePomeriggio[cfg.orePomeriggio.length - 1] ?? 20
    if (hour > ultima) return romeInstant(giornoSuccessivo(dateStr), prima)
    if (hour < prima) return romeInstant(dateStr, prima)
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
