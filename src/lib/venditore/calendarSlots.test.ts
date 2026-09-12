import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SLOTS_PER_WEEK,
    romeDow,
    romeHour,
    slotStartFor,
    slotKey,
    weekStartKey,
    weekSlots,
    weeklyDeadline,
    slotLabel,
} from './calendarSlots'

// 2026-09-14 è un lunedì; l'Italia è in ora legale (UTC+2).
const LUN_16_45 = new Date('2026-09-14T16:45:00+02:00')

test('romeDow: lunedi e 1, domenica e 7', () => {
    assert.equal(romeDow(LUN_16_45), 1)
    assert.equal(romeDow(new Date('2026-09-20T10:00:00+02:00')), 7)
})

test('romeHour legge l ora italiana, non quella UTC', () => {
    // 23:30 UTC del 13 settembre e' l'1:30 del 14 a Roma.
    assert.equal(romeHour(new Date('2026-09-13T23:30:00Z')), 1)
})

test('slotStartFor tronca all ora piena', () => {
    const s = slotStartFor(LUN_16_45)
    assert.ok(s)
    assert.equal(s!.toISOString(), '2026-09-14T14:00:00.000Z') // 16:00 Roma
})

test('slotStartFor esclude domenica e le ore fuori griglia', () => {
    assert.equal(slotStartFor(new Date('2026-09-20T15:00:00+02:00')), null) // domenica
    assert.equal(slotStartFor(new Date('2026-09-14T08:59:00+02:00')), null) // prima delle 9
    assert.equal(slotStartFor(new Date('2026-09-14T22:00:00+02:00')), null) // dopo le 21
    assert.ok(slotStartFor(new Date('2026-09-14T21:30:00+02:00')))          // 21:30 -> slot 21
})

test('slotKey e slotLabel sono leggibili in ora italiana', () => {
    assert.equal(slotKey(LUN_16_45), '2026-09-14@16')
    assert.equal(slotLabel(LUN_16_45), '16:00')
})

test('weekStartKey torna il lunedi anche partendo dal sabato', () => {
    assert.equal(weekStartKey(new Date('2026-09-19T20:00:00+02:00')), '2026-09-14')
    assert.equal(weekStartKey(LUN_16_45), '2026-09-14')
})

test('weekSlots produce 78 slot, dal lunedi 9 al sabato 21', () => {
    const slots = weekSlots(new Date('2026-09-14T00:00:00+02:00'))
    assert.equal(slots.length, SLOTS_PER_WEEK)
    assert.equal(slotKey(slots[0]), '2026-09-14@9')
    assert.equal(slotKey(slots[slots.length - 1]), '2026-09-19@21')
})

test('weekSlots regge il cambio di ora legale: la settimana resta di 78 slot', () => {
    // L'ora legale 2026 finisce domenica 25 ottobre, fuori griglia.
    const prima = weekSlots(new Date('2026-10-19T00:00:00+02:00'))
    const dopo = weekSlots(new Date('2026-10-26T00:00:00+01:00'))
    assert.equal(prima.length, SLOTS_PER_WEEK)
    assert.equal(dopo.length, SLOTS_PER_WEEK)
    // Sabato 24/10 alle 21:00 e' CEST (+2) -> 19:00Z
    assert.equal(prima[prima.length - 1].toISOString(), '2026-10-24T19:00:00.000Z')
    // Sabato 31/10 alle 21:00 e' CET (+1) -> 20:00Z
    assert.equal(dopo[dopo.length - 1].toISOString(), '2026-10-31T20:00:00.000Z')
})

test('weeklyDeadline e il lunedi alle 14 italiane', () => {
    const d = weeklyDeadline(new Date('2026-09-14T00:00:00+02:00'))
    assert.equal(d.toISOString(), '2026-09-14T12:00:00.000Z')
})
