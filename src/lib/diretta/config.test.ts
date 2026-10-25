import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_TARGETS, parseTargets, peakWindow, shiftWindow, euroFromPresences,
    stepReached, isTeamMember, personName, isSaturdayRome,
} from './config'

test('parseTargets: default se vuoto o rotto, merge se parziale', () => {
    assert.deepEqual(parseTargets(null), DEFAULT_TARGETS)
    assert.deepEqual(parseTargets('{rotto'), DEFAULT_TARGETS)
    const t = parseTargets(JSON.stringify({ squadra: [50, 60] }))
    assert.deepEqual(t.squadra, [50, 60])
    assert.deepEqual(t.personale, [8, 10])
})

test('ora di punta: lunedì 26/10/2026 (ora solare) 18-19 di Roma = 17-18 UTC', () => {
    const w = peakWindow(new Date('2026-10-26T15:00:00Z'), DEFAULT_TARGETS)!
    assert.equal(w.start.toISOString(), '2026-10-26T17:00:00.000Z')
    assert.equal(w.end.toISOString(), '2026-10-26T18:00:00.000Z')
})

test('ora di punta: venerdì 23/10/2026 (ora legale) 18-19 di Roma = 16-17 UTC', () => {
    const w = peakWindow(new Date('2026-10-23T15:00:00Z'), DEFAULT_TARGETS)!
    assert.equal(w.start.toISOString(), '2026-10-23T16:00:00.000Z')
})

test('sabato: punta 12:30-13:30 e turno 10-16:30; domenica niente', () => {
    const sat = new Date('2026-10-31T10:00:00Z')
    assert.equal(isSaturdayRome(sat), true)
    // 31/10 è ora solare (+1): 12:30 di Roma = 11:30 UTC
    const w = peakWindow(sat, DEFAULT_TARGETS)!
    assert.equal(w.start.toISOString(), '2026-10-31T11:30:00.000Z')
    assert.equal(w.end.toISOString(), '2026-10-31T12:30:00.000Z')
    assert.equal(shiftWindow(sat, DEFAULT_TARGETS)!.end.toISOString(), '2026-10-31T15:30:00.000Z')
    assert.equal(peakWindow(new Date('2026-11-01T10:00:00Z'), DEFAULT_TARGETS), null)
})

test('sabato: due pause, 12:00-12:15 e 14:15-14:30, dentro il turno e fuori dalla punta', () => {
    assert.deepEqual(DEFAULT_TARGETS.pauseSabato, [
        { start: '12:00', end: '12:15' },
        { start: '14:15', end: '14:30' },
    ])
    for (const p of DEFAULT_TARGETS.pauseSabato) {
        assert.ok(p.start >= DEFAULT_TARGETS.turnoSabato.start && p.end <= DEFAULT_TARGETS.turnoSabato.end, `${p.start} nel turno`)
        assert.ok(p.end <= DEFAULT_TARGETS.puntaSabato.start || p.start >= DEFAULT_TARGETS.puntaSabato.end, `${p.start} fuori dalla punta`)
    }
})

test('euro presenze: €12 dalla 5ª', () => {
    assert.equal(euroFromPresences(4, DEFAULT_TARGETS), 0)
    assert.equal(euroFromPresences(5, DEFAULT_TARGETS), 12)
    assert.equal(euroFromPresences(7, DEFAULT_TARGETS), 36)
})

test('scalini', () => {
    assert.equal(stepReached(7, [8, 10]), 0)
    assert.equal(stepReached(8, [8, 10]), 1)
    assert.equal(stepReached(12, [8, 10]), 2)
})

test('squadra e nomi', () => {
    assert.equal(isTeamMember({ role: 'GDO', isActive: true, isBot: false, firstName: 'Zora' }), true)
    assert.equal(isTeamMember({ role: 'GDO', isActive: true, isBot: true, firstName: 'Bot' }), false)
    assert.equal(isTeamMember({ role: 'GDO', isActive: true, isBot: false, firstName: null }), false)
    assert.equal(personName({ firstName: 'Zora', displayName: 'GDO 106' }), 'Zora')
    assert.equal(personName({ firstName: null, displayName: 'GDO 108' }), 'GDO 108')
})
