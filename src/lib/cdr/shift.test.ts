import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    romeDowOf, shiftBoundsFor, lateAndEarly, WEEKDAY_SHIFT, SATURDAY_SHIFT,
    saturdayAllowanceSec, fermoTotalSeconds, SATURDAY_TRAINING_ALLOWANCE_MIN,
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

// Abbuono formazione del sabato: l'anticipo a fine turno non conta come
// fermo fino a SATURDAY_TRAINING_ALLOWANCE_MIN (60) minuti; oltre, l'eccedenza
// torna a contare normalmente. Nei feriali nessun abbuono.

test('sabato, 45 minuti di anticipo: abbuono pieno, nessun tempo fermo aggiuntivo', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    const endEarlySec = 45 * 60
    // Nessun ritardo/buco interno: l'intero fermo grezzo viene dall'anticipo.
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(SATURDAY, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(saturdayAllowanceSec(SATURDAY, endEarlySec), 45 * 60)
    assert.equal(fermo, 0)
})

test('sabato, 90 minuti di anticipo: 60 abbuonati, 30 contati come fermo', () => {
    const shift = shiftBoundsFor(SATURDAY)!
    const endEarlySec = 90 * 60
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(SATURDAY, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(saturdayAllowanceSec(SATURDAY, endEarlySec), SATURDAY_TRAINING_ALLOWANCE_MIN * 60)
    assert.equal(fermo, 30 * 60)
})

test('feriale, 45 minuti di anticipo: nessun abbuono, tutti e 45 contati come fermo', () => {
    const shift = shiftBoundsFor(WEEKDAY)!
    const endEarlySec = 45 * 60
    const occupiedSeconds = shift.minutes * 60 - endEarlySec
    const fermo = fermoTotalSeconds(WEEKDAY, shift.minutes * 60, occupiedSeconds, endEarlySec)
    assert.equal(saturdayAllowanceSec(WEEKDAY, endEarlySec), 0)
    assert.equal(fermo, 45 * 60)
})
