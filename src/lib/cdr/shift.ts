/**
 * Turno reale degli operatori telefonici, fornito dal committente il
 * 2026-08-25. Prima si misurava la finestra osservata (prima-ultima
 * chiamata), che nascondeva i bordi: chi comincia tardi o stacca presto
 * non si vedeva. Le metriche di turno vanno invece calcolate su questi
 * orari fissi.
 *
 * Modulo puro: nessuna dipendenza da database o da Next, per poter essere
 * testato in isolamento (vedi shift.test.ts) — la logica precedente viveva
 * dentro una server action e l'unica verifica era una query SQL manuale.
 */

import { dayBoundsRome } from "@/lib/dateUtils"

// Feriali (lun-ven): 13:30-20:00 = 390 minuti.
export const WEEKDAY_SHIFT = { startMin: 13 * 60 + 30, endMin: 20 * 60 }

// Sabato: 10:00-16:30 = 390 minuti, stessa durata dei feriali su fascia
// diversa. Orario CONFERMATO dal committente il 2026-08-25 (non più dedotto
// dai dati): la finestra osservata sembrava chiudersi prima delle 16:30
// perché spesso l'ultima ora è dedicata alla formazione (vedi
// SATURDAY_TRAINING_ALLOWANCE_MIN più sotto), non perché il turno sia più corto.
export const SATURDAY_SHIFT = { startMin: 10 * 60, endMin: 16 * 60 + 30 }

/**
 * Il sabato, la formazione occupa spesso l'ultima ora di turno: è lavoro,
 * non tempo fermo. Questo abbuono (minuti) scala l'anticipo a fine turno
 * dal computo del tempo fermo, fino a questo massimo — l'eventuale
 * eccedenza oltre l'abbuono torna a contare normalmente come fermo. Nei
 * feriali non si applica alcun abbuono. Valore unico e modificabile qui
 * (vedi fermoTotalSeconds/saturdayAllowanceSec più sotto e il suo uso in
 * productivityActions.ts per fermoTotalMin e daysShort).
 */
export const SATURDAY_TRAINING_ALLOWANCE_MIN = 60

/**
 * Soglia (minuti di anticipo a fine turno) oltre la quale una giornata si
 * considera "corta" (mezza giornata, permesso, uscita autorizzata).
 *
 * Feriali: 60 minuti (invariato dalla genesi del modulo).
 *
 * Sabato: 120 minuti. Distribuzione reale agosto 2026 (75 sabati):
 *   - 0–15 min: 42 sabati (arrivano a fine turno)
 *   - 27–54 min: 8 sabati (formazione 30 min)
 *   - 61–95 min: 22 sabati (formazione 60 min) ← ABBUONATI
 *   - [gap vuoto 95–113]
 *   - 113–137 min: 3 sabati (anomali) ← OLTRE SOGLIA
 *
 * Il valore 120 minuti sta dentro il gap, così le giornate con sola
 * formazione (fino a 95 min) non risultano "corte", mentre quelle
 * realmente anomale (da 113 min) lo sono.
 */
export const WEEKDAY_DAYS_SHORT_THRESHOLD_MIN = 60
export const SATURDAY_DAYS_SHORT_THRESHOLD_MIN = 120

export type ShiftBounds = { start: Date; end: Date; minutes: number }

/** Giorno della settimana Europe/Rome di una `dateLocal` ("YYYY-MM-DD"): 0=domenica..6=sabato. */
export function romeDowOf(dateLocal: string): number {
    // dateLocal è già una data di calendario Europe/Rome (vedi parseCdr.ts);
    // mezzogiorno UTC non attraversa mai il cambio di giorno per nessun fuso.
    return new Date(`${dateLocal}T12:00:00Z`).getUTCDay()
}

/** Bordi del turno (istanti UTC) per la giornata data. `null` = domenica, esclusa. */
export function shiftBoundsFor(dateLocal: string): ShiftBounds | null {
    const dow = romeDowOf(dateLocal)
    if (dow === 0) return null
    const shift = dow === 6 ? SATURDAY_SHIFT : WEEKDAY_SHIFT
    const dayStart = dayBoundsRome(new Date(`${dateLocal}T12:00:00Z`)).start
    return {
        start: new Date(dayStart.getTime() + shift.startMin * 60000),
        end: new Date(dayStart.getTime() + shift.endMin * 60000),
        minutes: shift.endMin - shift.startMin,
    }
}

/**
 * Ritardo (inizio turno -> prima chiamata) e anticipo (ultima chiamata ->
 * fine turno), in secondi. Mai negativi: se la prima chiamata precede
 * l'inizio turno, o l'ultima segue la fine turno, il valore corrispondente
 * è 0 invece di un numero negativo.
 */
export function lateAndEarly(
    firstAt: Date,
    lastAt: Date,
    shift: ShiftBounds,
): { startLateSec: number; endEarlySec: number } {
    return {
        startLateSec: Math.max(0, (firstAt.getTime() - shift.start.getTime()) / 1000),
        endEarlySec: Math.max(0, (shift.end.getTime() - lastAt.getTime()) / 1000),
    }
}

/**
 * Abbuono formazione (secondi) da scalare dall'anticipo a fine turno nel
 * computo del tempo fermo: 0 nei feriali, `min(endEarlySec, SATURDAY_TRAINING_ALLOWANCE_MIN)`
 * il sabato.
 */
export function saturdayAllowanceSec(dateLocal: string, endEarlySec: number): number {
    if (romeDowOf(dateLocal) !== 6) return 0
    return Math.min(endEarlySec, SATURDAY_TRAINING_ALLOWANCE_MIN * 60)
}

/**
 * Tempo fermo totale della giornata (secondi), al netto dell'abbuono
 * formazione del sabato:
 *
 *   fermoTotale = durataTurno - tempoOccupato - min(anticipoFineTurno, abbuono)
 *
 * Nei feriali l'abbuono è 0, quindi la formula si riduce a
 * `durataTurno - tempoOccupato` come prima di questa modifica.
 */
export function fermoTotalSeconds(
    dateLocal: string,
    shiftDurationSec: number,
    occupiedSeconds: number,
    endEarlySec: number,
): number {
    const allowanceSec = saturdayAllowanceSec(dateLocal, endEarlySec)
    return Math.max(0, shiftDurationSec - occupiedSeconds - allowanceSec)
}
