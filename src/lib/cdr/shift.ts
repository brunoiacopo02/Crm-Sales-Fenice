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
 * Quando il sabato c'è formazione, occupa l'ultima ora di turno: è lavoro,
 * non tempo fermo. Questo abbuono (minuti) scala l'assenza dal computo del
 * tempo fermo e delle pause, fino a questo massimo — l'eccedenza oltre
 * l'abbuono torna a contare normalmente.
 *
 * ATTENZIONE: l'abbuono NON spetta a ogni sabato. Fino al 2026-08-26 veniva
 * concesso a tutti i sabati indistintamente, il che abbassava le pause di
 * tutti di 10-13 minuti al giorno anche nei sabati in cui formazione non ce
 * n'era stata. Ora spetta solo ai sabati in cui la formazione è davvero
 * avvenuta, dedotti dai dati con isCollectiveTrainingDay.
 */
export const SATURDAY_TRAINING_ALLOWANCE_MIN = 60

/**
 * Assenza (minuti di anticipo a fine turno) che vale come indizio di
 * formazione per un singolo operatore. La formazione dura 30 o 60 minuti e
 * cade a fine turno, quindi chi la fa smette di chiamare.
 */
export const SATURDAY_TRAINING_MIN_ABSENCE_MIN = 30

/**
 * Quota della squadra che deve essersi fermata insieme perché il sabato
 * conti come giornata di formazione. La formazione è COLLETTIVA (o tutti o
 * nessuno), quindi il segnale è netto: sui 10 sabati fra giugno e agosto
 * 2026 la quota di operatori fermi nell'ultima mezz'ora è stata
 * 100%, 0%, 57%, 0%, 13%, 0%, 0%, 100%, 100%, 0%. Il 50% cade nel vuoto fra
 * i due gruppi (57% contro 13%) e isola i 4 sabati di formazione
 * confermati dal committente (06/06, 20/06, 01/08, 08/08 — zero a luglio).
 */
export const SATURDAY_TRAINING_QUORUM = 0.5

/**
 * Sotto questo numero di operatori con una giornata rappresentativa la
 * squadra non fa quorum: nessuna formazione dedotta, nessun abbuono. Serve
 * a non far decidere una giornata di formazione a una persona sola.
 */
export const SATURDAY_TRAINING_MIN_HEADCOUNT = 3

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
 * Quel sabato la squadra ha fatto formazione? Si deduce dai dati, non dal
 * calendario: `endEarlySecPerOperator` sono gli anticipi a fine turno di
 * tutti gli operatori con una giornata rappresentativa in quella data.
 * Formazione = almeno il quorum si è fermato insieme nell'ultima mezz'ora.
 *
 * Nei giorni diversi dal sabato è sempre `false`: la formazione infrasettimanale,
 * se mai ci fosse, non ha un abbuono previsto.
 */
export function isCollectiveTrainingDay(dateLocal: string, endEarlySecPerOperator: number[]): boolean {
    if (romeDowOf(dateLocal) !== 6) return false
    if (endEarlySecPerOperator.length < SATURDAY_TRAINING_MIN_HEADCOUNT) return false
    const fermi = endEarlySecPerOperator.filter(sec => sec >= SATURDAY_TRAINING_MIN_ABSENCE_MIN * 60).length
    return fermi / endEarlySecPerOperator.length >= SATURDAY_TRAINING_QUORUM
}

/**
 * Abbuono formazione (secondi) da scalare da un'assenza — l'anticipo a fine
 * turno nel computo del tempo fermo, oppure una pausa interna: 0 se quel
 * giorno la formazione non c'è stata, `min(absenceSec, SATURDAY_TRAINING_ALLOWANCE_MIN)`
 * se c'è stata. Il giorno di formazione si stabilisce con
 * isCollectiveTrainingDay, mai dal solo giorno della settimana.
 */
export function trainingAllowanceSec(isTrainingDay: boolean, absenceSec: number): number {
    if (!isTrainingDay) return 0
    return Math.min(absenceSec, SATURDAY_TRAINING_ALLOWANCE_MIN * 60)
}

/**
 * Tempo fermo totale della giornata (secondi), al netto dell'abbuono
 * formazione:
 *
 *   fermoTotale = durataTurno - tempoOccupato - min(anticipoFineTurno, abbuono)
 *
 * Nelle giornate senza formazione l'abbuono è 0, quindi la formula si
 * riduce a `durataTurno - tempoOccupato`.
 */
export function fermoTotalSeconds(
    isTrainingDay: boolean,
    shiftDurationSec: number,
    occupiedSeconds: number,
    endEarlySec: number,
): number {
    const allowanceSec = trainingAllowanceSec(isTrainingDay, endEarlySec)
    return Math.max(0, shiftDurationSec - occupiedSeconds - allowanceSec)
}
