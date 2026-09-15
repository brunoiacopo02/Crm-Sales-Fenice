import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callNowColumn, callNowPendingCount, handoffAppointmentAt, nextCallNowState } from './callNow'

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

test('oltre le 20:00 del 6/10 il richiamo scivola alle 09:00 del 7/10', () => {
    // 20:30: la prossima ora tonda utile sarebbe le 22:00, ora in cui non
    // risponde nessuno.
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T20:30:00+02:00')), new Date('2026-10-07T09:00:00+02:00'))
    // 23:30: `min` cade gia' il 7/10 all'una di notte.
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T23:30:00+02:00')), new Date('2026-10-07T09:00:00+02:00'))
    // Le 19:00 restano dentro: ultima ora servita = 20:00.
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T19:00:00+02:00')), new Date('2026-10-06T20:00:00+02:00'))
})

test('il 7/10 il richiamo non torna mai indietro alle 09:00 gia passate', () => {
    // Regressione: la regola guardava solo il 6/10, quindi ogni `now` del 7/10
    // finiva su romeInstant(dopodomani, 9) — un appuntamento nel passato.
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-07T10:30:00+02:00')), new Date('2026-10-07T12:00:00+02:00'))
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-07T20:30:00+02:00')), new Date('2026-10-08T09:00:00+02:00'))
    // Prima delle 8 del 7/10 la prossima ora utile e' l'apertura, non le 6 del mattino.
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-07T05:00:00+02:00')), new Date('2026-10-07T09:00:00+02:00'))
})

test('i tentativi non superano mai il tetto', () => {
    assert.deepEqual(nextCallNowState(3, SERA), { kind: 'handoff', attempts: 3, appointmentAt: new Date('2026-10-06T09:00:00+02:00') })
    assert.deepEqual(nextCallNowState(9, SERA), { kind: 'handoff', attempts: 3, appointmentAt: new Date('2026-10-06T09:00:00+02:00') })
})

test('badge della tab: contano i lead non ancora esitati', () => {
    const leads = [
        { column: 'da_chiamare' as const },
        { column: 'seconda' as const },
        { column: 'terza' as const },
        { column: 'esitati' as const },
        { column: 'esitati' as const },
    ]
    assert.equal(callNowPendingCount(leads), 3)
    assert.equal(callNowPendingCount([]), 0)
    assert.equal(callNowPendingCount([{ column: 'esitati' as const }]), 0)
})
