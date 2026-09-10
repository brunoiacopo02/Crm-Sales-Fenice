import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cohortClosing, isCohortPresence, type CohortLead } from './salesCohort'

const AGO_START = new Date(Date.UTC(2026, 7, 1))
const AGO_END = new Date(Date.UTC(2026, 8, 1))
const SET_START = new Date(Date.UTC(2026, 8, 1))
const SET_END = new Date(Date.UTC(2026, 9, 1))

function lead(over: Partial<CohortLead> = {}): CohortLead {
    return { presentedAt: null, salespersonOutcome: null, ...over }
}

test('la presenza di agosto non entra nel denominatore di settembre dopo tre follow-up', () => {
    // Presenziato il 20 agosto. Il venditore registra "Non chiuso" il 2, il 5 e
    // il 10 settembre: salespersonOutcomeAt è migrato a settembre tre volte,
    // presentedAt no. Il bug vecchio contava questo lead nel denominatore di
    // settembre (a volte più di una volta, con le viste per tentativo).
    const l = lead({
        presentedAt: new Date(Date.UTC(2026, 7, 20, 10)),
        salespersonOutcome: 'Non chiuso',
    })

    assert.equal(cohortClosing([l], SET_START, SET_END).presenze, 0)
    assert.equal(cohortClosing([l], AGO_START, AGO_END).presenze, 1)
    assert.equal(cohortClosing([l], AGO_START, AGO_END).nonChiusi, 1)
})

test('la presenza del mese ancora senza esito resta nel denominatore', () => {
    // È il prezzo della coorte, accettato dal PO: il rate di metà mese è basso
    // perché le trattative aperte pesano già. Devono restare visibili.
    const c = cohortClosing([
        lead({ presentedAt: new Date(Date.UTC(2026, 8, 28, 10)) }),
        lead({ presentedAt: new Date(Date.UTC(2026, 8, 3, 10)), salespersonOutcome: 'Chiuso' }),
    ], SET_START, SET_END)

    assert.equal(c.presenze, 2)
    assert.equal(c.chiusi, 1)
    assert.equal(c.inLavorazione, 1)
    assert.equal(c.closingPct, 50)
})

test('uno Sparito senza presenza non entra ne al numeratore ne al denominatore', () => {
    // Chi non si è presentato non è una trattativa: gonfiava il denominatore e
    // schiacciava il closing rate di chi lavorava appuntamenti veri.
    const c = cohortClosing([
        lead({ presentedAt: null, salespersonOutcome: 'Sparito' }),
        lead({ presentedAt: new Date(Date.UTC(2026, 8, 4, 10)), salespersonOutcome: 'Chiuso' }),
    ], SET_START, SET_END)

    assert.equal(c.presenze, 1)
    assert.equal(c.chiusi, 1)
    assert.equal(c.closingPct, 100)
})

test('uno Sparito registrato al follow-up non toglie una presenza gia maturata', () => {
    // Latch presentedAt (PO 2026-07-17): il cliente si era presentato, poi è
    // sparito al richiamo. La presenza resta, la chiusura no.
    const c = cohortClosing([
        lead({ presentedAt: new Date(Date.UTC(2026, 8, 9, 10)), salespersonOutcome: 'Sparito' }),
    ], SET_START, SET_END)

    assert.equal(c.presenze, 1)
    assert.equal(c.spariti, 1)
    assert.equal(c.closingPct, 0)
})

test('senza presenze il rate e zero, non una divisione per zero', () => {
    const c = cohortClosing([], SET_START, SET_END)
    assert.equal(c.presenze, 0)
    assert.equal(c.closingPct, 0)
})

test('i bordi del mese sono inclusivo a sinistra ed esclusivo a destra', () => {
    const primoIstante = lead({ presentedAt: SET_START, salespersonOutcome: 'Chiuso' })
    const primoIstanteDopo = lead({ presentedAt: SET_END, salespersonOutcome: 'Chiuso' })

    assert.equal(isCohortPresence(primoIstante, SET_START, SET_END), true)
    assert.equal(isCohortPresence(primoIstanteDopo, SET_START, SET_END), false)
})

test('scenario reale settembre 2026 di Sales 008: 9 chiusi su 19 presenze', () => {
    // Il bug mostrava 9/31 = 29% perché nel denominatore finivano i follow-up
    // delle presenze di luglio e agosto.
    const presenze = [
        ...Array.from({ length: 9 }, () => lead({ presentedAt: new Date(Date.UTC(2026, 8, 10)), salespersonOutcome: 'Chiuso' })),
        ...Array.from({ length: 10 }, () => lead({ presentedAt: new Date(Date.UTC(2026, 8, 11)), salespersonOutcome: 'Non chiuso' })),
    ]
    const followUpDiMesiPrecedenti = Array.from({ length: 12 }, () =>
        lead({ presentedAt: new Date(Date.UTC(2026, 6, 15)), salespersonOutcome: 'Non chiuso' }))

    const c = cohortClosing([...presenze, ...followUpDiMesiPrecedenti], SET_START, SET_END)
    assert.equal(c.presenze, 19)
    assert.equal(c.chiusi, 9)
    assert.equal(c.closingPct, 47)
})
