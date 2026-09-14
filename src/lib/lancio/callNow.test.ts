import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callNowColumn, handoffAppointmentAt, nextCallNowState } from './callNow'

const SERA = new Date('2026-10-05T22:30:00+02:00')

test('colonne: 0 → da chiamare, 1 → seconda, 2 → terza, esito → esitati', () => {
    assert.equal(callNowColumn({ lancioCallNowAttempts: 0, salespersonOutcome: null }), 'da_chiamare')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 1, salespersonOutcome: null }), 'seconda')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 2, salespersonOutcome: null }), 'terza')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 1, salespersonOutcome: 'Chiuso' }), 'esitati')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 3, salespersonOutcome: null }), 'esitati')
})

test('primo e secondo NR: ritenta fra 30 minuti', () => {
    const r1 = nextCallNowState(0, SERA)
    assert.deepEqual(r1, { kind: 'retry', attempts: 1, nextAt: new Date('2026-10-05T23:00:00+02:00') })
    const r2 = nextCallNowState(1, SERA)
    assert.equal(r2.kind, 'retry')
    assert.equal(r2.attempts, 2)
})

test('terzo NR: passa alle Conferme il giorno dopo alle 09:00 (A1)', () => {
    const r = nextCallNowState(2, SERA)
    assert.deepEqual(r, { kind: 'handoff', attempts: 3, appointmentAt: new Date('2026-10-06T09:00:00+02:00') })
})

test('handoff dopo le 9 del 6: prossima ora tonda almeno un ora avanti', () => {
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T09:20:00+02:00')), new Date('2026-10-06T11:00:00+02:00'))
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T10:00:00+02:00')), new Date('2026-10-06T11:00:00+02:00'))
    assert.deepEqual(handoffAppointmentAt(SERA), new Date('2026-10-06T09:00:00+02:00'))
})
