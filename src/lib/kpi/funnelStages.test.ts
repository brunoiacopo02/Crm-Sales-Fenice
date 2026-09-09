import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stageHits, type FunnelStageLead } from './funnelStages'

const AGO_START = new Date(Date.UTC(2026, 7, 1))
const AGO_END = new Date(Date.UTC(2026, 8, 1))
const SET_START = new Date(Date.UTC(2026, 8, 1))
const SET_END = new Date(Date.UTC(2026, 9, 1))

function lead(over: Partial<FunnelStageLead> = {}): FunnelStageLead {
    return {
        appointmentDate: null,
        appointmentCreatedAt: null,
        confirmationsOutcome: null,
        confirmationsTimestamp: null,
        salespersonOutcome: null,
        salespersonOutcomeAt: null,
        presentedAt: null,
        closeAmountEur: null,
        ...over,
    }
}

test('la presenza resta nel mese dell appuntamento anche dopo un follow-up del mese dopo', () => {
    // Presenziato il 20 agosto, follow-up "Non chiuso" registrato il 5 settembre:
    // salespersonOutcomeAt è migrato a settembre, presentedAt no.
    const l = lead({
        appointmentDate: new Date(Date.UTC(2026, 7, 20, 10)),
        appointmentCreatedAt: new Date(Date.UTC(2026, 7, 10)),
        presentedAt: new Date(Date.UTC(2026, 7, 20, 10)),
        salespersonOutcome: 'Non chiuso',
        salespersonOutcomeAt: new Date(Date.UTC(2026, 8, 5, 9)),
    })

    assert.equal(stageHits(l, AGO_START, AGO_END).trattative, true, 'deve contare ad agosto')
    assert.equal(stageHits(l, SET_START, SET_END).trattative, false, 'non deve ricontare a settembre')
})

test('tre follow-up non producono tre trattative', () => {
    const presenza = new Date(Date.UTC(2026, 7, 20, 10))
    const mesi: [Date, Date][] = [[AGO_START, AGO_END], [SET_START, SET_END]]
    // Stato finale del lead dopo il 3° follow-up: outcomeAt è l'ultimo esito.
    const l = lead({
        appointmentDate: presenza,
        presentedAt: presenza,
        salespersonOutcome: 'Non chiuso',
        salespersonOutcomeAt: new Date(Date.UTC(2026, 8, 25)),
    })
    const totale = mesi.filter(([s, e]) => stageHits(l, s, e).trattative).length
    assert.equal(totale, 1, 'una sola presenza in tutto il periodo')
})

test('un esito Sparito non toglie la presenza gia maturata', () => {
    const l = lead({
        appointmentDate: new Date(Date.UTC(2026, 7, 12)),
        presentedAt: new Date(Date.UTC(2026, 7, 12)),
        salespersonOutcome: 'Sparito',
        salespersonOutcomeAt: new Date(Date.UTC(2026, 8, 2)),
    })
    assert.equal(stageHits(l, AGO_START, AGO_END).trattative, true)
})

test('un appuntamento mai presenziato non conta come trattativa', () => {
    const l = lead({
        appointmentDate: new Date(Date.UTC(2026, 7, 14)),
        appointmentCreatedAt: new Date(Date.UTC(2026, 7, 1)),
        confirmationsOutcome: 'confermato',
        confirmationsTimestamp: new Date(Date.UTC(2026, 7, 13)),
    })
    const ago = stageHits(l, AGO_START, AGO_END)
    assert.equal(ago.app, true)
    assert.equal(ago.conferme, true)
    assert.equal(ago.trattative, false)
})

test('la chiusura conta nel mese dell esito, la presenza in quello dell appuntamento', () => {
    const l = lead({
        appointmentDate: new Date(Date.UTC(2026, 7, 28)),
        presentedAt: new Date(Date.UTC(2026, 7, 28)),
        salespersonOutcome: 'Chiuso',
        salespersonOutcomeAt: new Date(Date.UTC(2026, 8, 3)),
        closeAmountEur: 2500,
    })
    const ago = stageHits(l, AGO_START, AGO_END)
    const set = stageHits(l, SET_START, SET_END)
    assert.equal(ago.trattative, true)
    assert.equal(ago.close, false)
    assert.equal(ago.fatturato, 0)
    assert.equal(set.trattative, false)
    assert.equal(set.close, true)
    assert.equal(set.fatturato, 2500)
})

test('app fissato conta dal fissaggio, non dalla data appuntamento', () => {
    const l = lead({
        appointmentCreatedAt: new Date(Date.UTC(2026, 7, 30)),
        appointmentDate: new Date(Date.UTC(2026, 8, 4)),
    })
    assert.equal(stageHits(l, AGO_START, AGO_END).app, true)
    assert.equal(stageHits(l, SET_START, SET_END).app, false)
})
