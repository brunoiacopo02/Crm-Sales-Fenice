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

// Sabato: turno diverso, ~10:00-15:30 = 330 minuti.
// NOTA INTERNA: orario NON confermato dal committente (dedotto dai dati) —
// tenuto distinto dai feriali per poterlo correggere senza toccare l'altro.
export const SATURDAY_SHIFT = { startMin: 10 * 60, endMin: 15 * 60 + 30 }

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
