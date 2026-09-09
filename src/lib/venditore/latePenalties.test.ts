import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    deadlineFor,
    isLate,
    lateHours,
    penaltyKey,
    romeMonthKey,
    selectLatePenalties,
    LATE_PENALTY_EUR,
    type DueCandidate,
} from './latePenalties'

const ATTIVAZIONE = new Date('2026-09-09T00:00:00Z')

function cand(over: Partial<DueCandidate> = {}): DueCandidate {
    return {
        leadId: 'lead-1',
        salesUserId: 'sales-1',
        kind: 'APPOINTMENT',
        dueAt: new Date('2026-09-10T09:00:00Z'),
        assignedAt: new Date('2026-09-08T09:00:00Z'),
        ...over,
    }
}

test('entro due ore non e ritardo, oltre si', () => {
    const c = cand()
    assert.equal(isLate(c, new Date('2026-09-10T10:59:00Z')), false)
    assert.equal(isLate(c, new Date('2026-09-10T11:00:00Z')), false, 'esattamente 2h: ancora in tempo')
    assert.equal(isLate(c, new Date('2026-09-10T11:01:00Z')), true)
})

test('la grazia corre anche di notte e nel weekend', () => {
    // Sabato 19:00 -> in ritardo alle 21:00 dello stesso sabato.
    const c = cand({ dueAt: new Date('2026-09-12T19:00:00Z') })
    assert.equal(isLate(c, new Date('2026-09-12T21:30:00Z')), true)
})

test('un lead assegnato dopo l appuntamento non fa maturare ritardo dal giorno prima', () => {
    const c = cand({
        dueAt: new Date('2026-09-10T09:00:00Z'),
        assignedAt: new Date('2026-09-11T15:00:00Z'), // arrivato il giorno dopo
    })
    assert.equal(deadlineFor(c).toISOString(), '2026-09-11T17:00:00.000Z')
    assert.equal(isLate(c, new Date('2026-09-11T16:00:00Z')), false)
    assert.equal(isLate(c, new Date('2026-09-11T18:00:00Z')), true)
})

test('nessuna penale retroattiva sulle scadenze precedenti all attivazione', () => {
    const vecchia = cand({ dueAt: new Date('2026-09-01T09:00:00Z') })
    const nuova = cand({ leadId: 'lead-2', dueAt: new Date('2026-09-10T09:00:00Z') })
    const out = selectLatePenalties([vecchia, nuova], new Date('2026-09-11T09:00:00Z'), ATTIVAZIONE)
    assert.deepEqual(out.map(p => p.leadId), ['lead-2'])
})

test('una scadenza gia a registro non genera una seconda penale', () => {
    const c = cand()
    const now = new Date('2026-09-11T09:00:00Z')
    const primo = selectLatePenalties([c], now, ATTIVAZIONE)
    assert.equal(primo.length, 1)
    const secondo = selectLatePenalties([c], now, ATTIVAZIONE, new Set([penaltyKey(c)]))
    assert.equal(secondo.length, 0, 'il secondo giro di cron non deve raddoppiare')
})

test('rifissare a una data nuova e una scadenza nuova', () => {
    const vecchia = cand()
    const rifissata = cand({ dueAt: new Date('2026-09-15T09:00:00Z') })
    assert.notEqual(penaltyKey(vecchia), penaltyKey(rifissata))
    const out = selectLatePenalties(
        [rifissata],
        new Date('2026-09-16T09:00:00Z'),
        ATTIVAZIONE,
        new Set([penaltyKey(vecchia)]),
    )
    assert.equal(out.length, 1)
})

test('appuntamento e follow-up dello stesso lead sono due scadenze distinte', () => {
    const appuntamento = cand({ kind: 'APPOINTMENT' })
    const followUp = cand({ kind: 'FOLLOWUP', dueAt: new Date('2026-09-20T09:00:00Z') })
    const out = selectLatePenalties(
        [appuntamento, followUp],
        new Date('2026-09-21T09:00:00Z'),
        ATTIVAZIONE,
    )
    assert.equal(out.length, 2)
    assert.equal(out.reduce((s, p) => s + p.amountEur, 0), 2 * LATE_PENALTY_EUR)
})

test('il mese di competenza e quello della scadenza letto a Roma', () => {
    // 31 agosto 23:30 UTC = 1 settembre 01:30 a Roma -> competenza settembre.
    assert.equal(romeMonthKey(new Date('2026-08-31T23:30:00Z')), '2026-09')
    assert.equal(romeMonthKey(new Date('2026-09-10T09:00:00Z')), '2026-09')
    // Una scadenza di fine mese resta nel suo mese anche se esitata il mese dopo.
    const out = selectLatePenalties(
        [cand({ dueAt: new Date('2026-08-31T10:00:00Z'), assignedAt: new Date('2026-08-20T10:00:00Z') })],
        new Date('2026-09-02T10:00:00Z'),
        new Date('2026-08-01T00:00:00Z'),
    )
    assert.equal(out[0].monthKey, '2026-08')
})

test('le ore di ritardo si fermano all esito registrato', () => {
    const due = new Date('2026-09-10T09:00:00Z')
    const now = new Date('2026-09-12T09:00:00Z')
    assert.equal(lateHours(due, new Date('2026-09-10T14:00:00Z'), now), 5)
    assert.equal(lateHours(due, null, now), 48, 'ancora da esitare: conta fino ad ora')
})
