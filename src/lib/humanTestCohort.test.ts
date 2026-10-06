import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaStatsLancioUmani, percentuale, type ChiamataCohort, type LeadCohortRow } from './humanTestCohort'

const INGRESSO = new Date('2026-10-06T18:00:00Z')
const DOPO = new Date('2026-10-07T13:00:00Z')
const PRIMA = new Date('2026-10-05T10:00:00Z')

function lead(over: Partial<LeadCohortRow> = {}): LeadCohortRow {
    return {
        id: 'l1', gdoUserId: 'u106', gdoCode: 106, gdoNome: 'GDO 106',
        status: 'NEW', callCount: 0, recallDate: null,
        appointmentDate: null, appointmentCreatedAt: null, presentedAt: null,
        salespersonOutcome: null, closeAmountEur: null, cohortAt: INGRESSO,
        ...over,
    }
}

const chiamata = (leadId: string, outcome: string, createdAt = DOPO, discardReason: string | null = null): ChiamataCohort =>
    ({ leadId, outcome, discardReason, createdAt })

test('lead nuovo mai chiamato: dato e da lavorare, nient\'altro', () => {
    const { totale } = calcolaStatsLancioUmani([lead()], [])
    assert.equal(totale.leadDati, 1)
    assert.equal(totale.daLavorare, 1)
    assert.equal(totale.chiamati, 0)
    assert.equal(totale.risposto, 0)
    assert.equal(totale.appuntamenti, 0)
})

test('chiamati e risposto contano lead distinti, non chiamate', () => {
    const leads = [lead({ id: 'a', status: 'IN_PROGRESS', callCount: 2 }), lead({ id: 'b', status: 'IN_PROGRESS', callCount: 1 })]
    const { totale } = calcolaStatsLancioUmani(leads, [
        chiamata('a', 'NON_RISPOSTO'), chiamata('a', 'RICHIAMO'), chiamata('b', 'NON_RISPOSTO'),
    ])
    assert.equal(totale.chiamati, 2)
    assert.equal(totale.risposto, 1)
})

test('numero inesistente non e\' una risposta (regola canonica isAnsweredLog)', () => {
    const { totale } = calcolaStatsLancioUmani([lead({ status: 'REJECTED', callCount: 1 })], [
        chiamata('l1', 'DA_SCARTARE', DOPO, 'Numero inesistente'),
    ])
    assert.equal(totale.chiamati, 1)
    assert.equal(totale.risposto, 0)
    assert.equal(totale.scartati, 1)
})

test('le chiamate di prima dell\'ingresso nel test non contano', () => {
    const { totale } = calcolaStatsLancioUmani([lead()], [chiamata('l1', 'RICHIAMO', PRIMA)])
    assert.equal(totale.chiamati, 0)
    assert.equal(totale.risposto, 0)
})

test('chiamate di lead fuori dal gruppo ignorate', () => {
    const { totale } = calcolaStatsLancioUmani([lead()], [chiamata('altro', 'APPUNTAMENTO')])
    assert.equal(totale.chiamati, 0)
})

test('appuntamento, presenza e vendita col fatturato', () => {
    const fissato = lead({
        id: 'a', status: 'APPOINTMENT', callCount: 1,
        appointmentDate: new Date('2026-10-09T08:00:00Z'), appointmentCreatedAt: DOPO,
        presentedAt: new Date('2026-10-09T08:00:00Z'), salespersonOutcome: 'Chiuso', closeAmountEur: 2500,
    })
    const nonPresentato = lead({
        id: 'b', status: 'APPOINTMENT', callCount: 1,
        appointmentDate: new Date('2026-10-09T09:00:00Z'), appointmentCreatedAt: DOPO,
    })
    const { totale } = calcolaStatsLancioUmani([fissato, nonPresentato], [chiamata('a', 'APPUNTAMENTO'), chiamata('b', 'APPUNTAMENTO')])
    assert.equal(totale.appuntamenti, 2)
    assert.equal(totale.presentati, 1)
    assert.equal(totale.vendite, 1)
    assert.equal(totale.venduto, 2500)
})

test('Chiuso senza presenza non e\' una vendita del funnel (isFunnelClosure)', () => {
    const { totale } = calcolaStatsLancioUmani([lead({
        status: 'APPOINTMENT', appointmentDate: DOPO, appointmentCreatedAt: DOPO,
        salespersonOutcome: 'Chiuso', closeAmountEur: 1000,
    })], [])
    assert.equal(totale.appuntamenti, 1)
    assert.equal(totale.vendite, 0)
    assert.equal(totale.venduto, 0)
})

test('appuntamento fissato prima del test non conta', () => {
    const { totale } = calcolaStatsLancioUmani([lead({
        appointmentDate: new Date('2026-10-06T08:00:00Z'), appointmentCreatedAt: PRIMA,
    })], [])
    assert.equal(totale.appuntamenti, 0)
})

test('da richiamare: in lavorazione con un richiamo', () => {
    const { totale } = calcolaStatsLancioUmani([
        lead({ id: 'a', status: 'IN_PROGRESS', callCount: 1, recallDate: DOPO }),
        lead({ id: 'b', status: 'IN_PROGRESS', callCount: 1 }),
    ], [])
    assert.equal(totale.daRichiamare, 1)
    assert.equal(totale.daLavorare, 0)
})

test('per GDO: un gruppo per assegnatario, ordinati per codice, totale = somma', () => {
    const { perGdo, totale } = calcolaStatsLancioUmani([
        lead({ id: 'a', gdoUserId: 'u119', gdoCode: 119, gdoNome: 'GDO 119' }),
        lead({ id: 'b' }),
        lead({ id: 'c', status: 'IN_PROGRESS', callCount: 1 }),
    ], [chiamata('c', 'NON_RISPOSTO')])
    assert.deepEqual(perGdo.map(g => g.gdoCode), [106, 119])
    assert.equal(perGdo[0].leadDati, 2)
    assert.equal(perGdo[0].chiamati, 1)
    assert.equal(perGdo[1].leadDati, 1)
    assert.equal(totale.leadDati, 3)
    assert.equal(totale.chiamati, 1)
})

test('percentuale: intera, null sul denominatore zero', () => {
    assert.equal(percentuale(1, 3), 33)
    assert.equal(percentuale(2, 3), 67)
    assert.equal(percentuale(0, 0), null)
})
