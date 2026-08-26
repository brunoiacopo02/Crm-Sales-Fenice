import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    romeDowOf, shiftBoundsFor, lateAndEarly, WEEKDAY_SHIFT, SATURDAY_SHIFT,
    trainingAllowanceSec, isCollectiveTrainingDay, fermoTotalSeconds, SATURDAY_TRAINING_ALLOWANCE_MIN,
    WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, SATURDAY_DAYS_SHORT_THRESHOLD_MIN,
} from './shift'

// 2026-08-24 = lunedì, 2026-08-22 = sabato, 2026-08-23 = domenica.
const WEEKDAY = '2026-08-24'
const SATURDAY = '2026-08-22'
const SUNDAY = '2026-08-23'

test('un feriale ha un turno di 390 minuti (13:30-20:00)', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    assert.equal(shift.minutes, 390)
    assert.equal(shift.minutes, WEEKDAY_SHIFT.endMin - WEEKDAY_SHIFT.startMin)
})

test('il sabato ha un turno di 390 minuti (10:00-16:30), come i feriali', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    assert.equal(shift.minutes, 390)
    assert.equal(shift.minutes, SATURDAY_SHIFT.endMin - SATURDAY_SHIFT.startMin)
})

test('la domenica è esclusa: nessun turno', () => {
    assert.equal(shiftBoundsFor(SUNDAY), null)
    assert.equal(romeDowOf(SUNDAY), 0)
})

test('calcola correttamente il ritardo a inizio turno', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    // Turno feriale inizia alle 13:30 Europe/Rome (11:30 UTC in agosto, CEST).
    const firstAt = new Date(shift.start.getTime() + 12 * 60000) // 12 minuti dopo l'inizio
    const lastAt = shift.end
    const { startLateSec } = lateAndEarly(firstAt, lastAt, shift)
    assert.equal(startLateSec, 12 * 60)
})

test('calcola correttamente l\'anticipo a fine turno', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    const firstAt = shift.start
    const lastAt = new Date(shift.end.getTime() - 27 * 60000) // 27 minuti prima della fine
    const { endEarlySec } = lateAndEarly(firstAt, lastAt, shift)
    assert.equal(endEarlySec, 27 * 60)
})

test('prima chiamata prima dell\'inizio turno: ritardo mai negativo', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    const firstAt = new Date(shift.start.getTime() - 10 * 60000) // 10 minuti prima dell'inizio
    const lastAt = shift.end
    const { startLateSec } = lateAndEarly(firstAt, lastAt, shift)
    assert.equal(startLateSec, 0)
})

test('ultima chiamata dopo la fine turno: anticipo mai negativo', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    const firstAt = shift.start
    const lastAt = new Date(shift.end.getTime() + 15 * 60000) // 15 minuti dopo la fine
    const { endEarlySec } = lateAndEarly(firstAt, lastAt, shift)
    assert.equal(endEarlySec, 0)
})

// Abbuono formazione: nelle giornate in cui la squadra ha fatto formazione
// l'assenza non conta come fermo fino a SATURDAY_TRAINING_ALLOWANCE_MIN (60)
// minuti; oltre, l'eccedenza torna a contare normalmente. Nelle giornate
// senza formazione nessun abbuono, sabato incluso.

test('giornata di formazione, 45 minuti di anticipo: abbuono pieno, nessun tempo fermo aggiuntivo', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    const endEarlySec = 45 * 60
    // Nessun ritardo/buco interno: l'intero fermo grezzo viene dall'anticipo.
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(true, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(trainingAllowanceSec(true, endEarlySec), 45 * 60)
    assert.equal(fermo, 0)
})

test('giornata di formazione, 90 minuti di anticipo: 60 abbuonati, 30 contati come fermo', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    const endEarlySec = 90 * 60
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(true, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(trainingAllowanceSec(true, endEarlySec), SATURDAY_TRAINING_ALLOWANCE_MIN * 60)
    assert.equal(fermo, 30 * 60)
})

test('sabato SENZA formazione: nessun abbuono, l anticipo conta tutto come fermo', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    const endEarlySec = 45 * 60
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(false, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(trainingAllowanceSec(false, endEarlySec), 0)
    assert.equal(fermo, 45 * 60)
})

test('feriale, 45 minuti di anticipo: nessun abbuono, tutti e 45 contati come fermo', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    const endEarlySec = 45 * 60
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(false, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(fermo, 45 * 60)
})

// Riconoscimento della giornata di formazione dai dati: la formazione e'
// collettiva, quindi si vede come fermata sincronizzata dell'ultima mezz'ora.
// Quote reali dei 10 sabati giugno-agosto 2026: 100, 0, 57, 0, 13, 0, 0, 100, 100, 0.

test('sabato di formazione: tutta la squadra ferma nell ultima mezz ora', () => {
    const anticipi = [72, 74, 80, 84, 51, 69].map(m => m * 60)
    assert.equal(isCollectiveTrainingDay(SATURDAY, anticipi), true)
})

test('sabato senza formazione: nessuno si ferma (22/08/2026, anticipi 0-5 min)', () => {
    const anticipi = [0, 1, 2, 3, 5, 4, 0, 2].map(m => m * 60)
    assert.equal(isCollectiveTrainingDay(SATURDAY, anticipi), false)
})

test('sabato con una sola persona ferma: sotto quorum, nessun abbuono per nessuno', () => {
    // 1 su 8 = 13%: e' il caso dell 11/07/2026, un permesso individuale.
    const anticipi = [95, 7, 3, 0, 2, 6, 1, 4].map(m => m * 60)
    assert.equal(isCollectiveTrainingDay(SATURDAY, anticipi), false)
})

test('sabato al 57% di fermi: sopra quorum (e il 20/06/2026 la formazione c era)', () => {
    const anticipi = [27, 35, 60, 65, 137, 5, 10].map(m => m * 60)  // 4 fermi su 7
    assert.equal(isCollectiveTrainingDay(SATURDAY, anticipi), true)
})

test('meno di tre operatori: nessun quorum possibile', () => {
    assert.equal(isCollectiveTrainingDay(SATURDAY, [70 * 60, 80 * 60]), false)
})

test('un feriale non e mai giornata di formazione, per quanto sincronizzato', () => {
    const anticipi = [70, 75, 80, 90].map(m => m * 60)
    assert.equal(isCollectiveTrainingDay(WEEKDAY, anticipi), false)
})

// Soglie di daysShort: feriali 60 min, sabato 120 min.
// La soglia sabato 120 min sta nel gap fra formazione legittima (≤95) e anomalie (≥113).

test('feriale, 90 minuti di anticipo: supera soglia (60), risulta "corta"', () => {
    const endEarlySec = 90 * 60
    const threshold = WEEKDAY_DAYS_SHORT_THRESHOLD_MIN * 60
    assert.equal(WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, 60)
    assert.ok(endEarlySec > threshold, '90 min > 60 min threshold')
})

test('sabato, 90 minuti di anticipo: non supera soglia (120), non risulta "corta"', () => {
    const endEarlySec = 90 * 60
    const threshold = SATURDAY_DAYS_SHORT_THRESHOLD_MIN * 60
    assert.equal(SATURDAY_DAYS_SHORT_THRESHOLD_MIN, 120)
    assert.ok(endEarlySec <= threshold, '90 min ≤ 120 min threshold')
})

test('sabato, 130 minuti di anticipo: supera soglia (120), risulta "corta"', () => {
    const endEarlySec = 130 * 60
    const threshold = SATURDAY_DAYS_SHORT_THRESHOLD_MIN * 60
    assert.ok(endEarlySec > threshold, '130 min > 120 min threshold')
})
