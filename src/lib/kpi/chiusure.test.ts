import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contaComeChiusura, euroFatturato, isChiuso, isUpsell, riepilogoFirme, tentativoContaComeChiusura } from './chiusure'
import { isFunnelClosure } from './canon'
import { cohortClosing } from './salesCohort'
import { stageHits } from './funnelStages'
import { closingStats, attemptsToClose, followUpFunnel, type AttemptInput } from '../venditorePerformance/aggregate'
import { calcolaGuadagno, percentualeGuadagno } from '../venditore/obiettivi'
import { attribuisciChiusureAltrove, stadiSm, type LeadBf } from '../blackFriday/monitor'

// Caso del titolare (21/11/2026): Sales 008 a novembre ha 1 chiusura vera (2.000 €)
// e l'upsell di Marina Nicul (1.180 €, scheda FUORI FUNNEL senza presenza).
const NOV_START = new Date('2026-10-31T23:00:00Z')
const NOV_END = new Date('2026-11-30T23:00:00Z')
const vera = { salespersonOutcome: 'Chiuso', closeIsUpsell: false, amount: 2000 }
const upsell = { salespersonOutcome: 'Chiuso', closeIsUpsell: true, amount: 1180 }

test('helper: upsell è Chiuso per i soldi ma non conta come chiusura', () => {
    assert.equal(isUpsell({ closeIsUpsell: true }), true)
    assert.equal(isUpsell({ closeIsUpsell: false }), false)
    assert.equal(isUpsell({ closeIsUpsell: null }), false)
    assert.equal(isUpsell({}), false)
    assert.equal(isChiuso('Chiuso'), true)
    assert.equal(isChiuso('chiuso'), true)
    assert.equal(isChiuso('Non chiuso'), false)
    assert.equal(contaComeChiusura({ salespersonOutcome: 'Chiuso', closeIsUpsell: false }), true)
    assert.equal(contaComeChiusura({ salespersonOutcome: 'Chiuso', closeIsUpsell: null }), true)
    assert.equal(contaComeChiusura({ salespersonOutcome: 'Chiuso', closeIsUpsell: true }), false)
    assert.equal(contaComeChiusura({ salespersonOutcome: 'Non chiuso', closeIsUpsell: false }), false)
    assert.equal(tentativoContaComeChiusura({ outcome: 'Chiuso', closeIsUpsell: true }), false)
    assert.equal(tentativoContaComeChiusura({ outcome: 'Chiuso', closeIsUpsell: false }), true)
    assert.equal(euroFatturato({ salespersonOutcome: 'Chiuso', closeAmountEur: 1180 }), 1180)
    assert.equal(euroFatturato({ salespersonOutcome: 'Non chiuso', closeAmountEur: 1180 }), 0)
})

test('KPI venditori (riepilogoFirme): 1 chiusura vera + 1 upsell nello stesso mese = 1 chiusura, euro sommati', () => {
    const r = riepilogoFirme([vera, upsell, { salespersonOutcome: 'Non chiuso', closeIsUpsell: false, amount: null }])
    assert.equal(r.chiusi, 1)
    assert.equal(r.upsell, 1)
    assert.equal(r.nonChiusi, 1)
    assert.equal(r.totalEsitati, 2, "l'upsell non è una trattativa esitata")
    assert.equal(r.fatturato, 3180)
})

test('riepilogoFirme senza upsell: comportamento di prima', () => {
    const r = riepilogoFirme([vera, { ...vera, amount: 500 }, { salespersonOutcome: 'Sparito', closeIsUpsell: false, amount: null }, { salespersonOutcome: 'Perso', closeIsUpsell: false, amount: null }])
    assert.deepEqual(r, { chiusi: 2, upsell: 0, nonChiusi: 0, sparito: 1, perso: 1, totalEsitati: 4, fatturato: 2500 })
})

test('obiettivi: il firmato con l\'upsell fa scattare la soglia (gli euro contano), il numero non c\'entra', () => {
    const firmato = riepilogoFirme([vera, upsell]).fatturato
    const obiettivi = { target1Eur: 3000, target2Eur: 6000 }
    assert.equal(percentualeGuadagno(riepilogoFirme([vera]).fatturato, obiettivi), 10)
    assert.equal(percentualeGuadagno(firmato, obiettivi), 11)
    const g = calcolaGuadagno({ incassatoCents: 122_000, firmatoEur: firmato, obiettivi })
    assert.equal(g.raggiunto, 1)
})

test('closing rate di coorte: la scheda upsell resta fuori da presenze e chiusi', () => {
    const presenza = new Date('2026-11-10T15:00:00Z')
    const righe = [
        { presentedAt: presenza, salespersonOutcome: 'Chiuso', closeIsUpsell: false },
        { presentedAt: null, salespersonOutcome: 'Chiuso', closeIsUpsell: true },
        // cintura: anche un upsell con presenza non entra nella coorte
        { presentedAt: presenza, salespersonOutcome: 'Chiuso', closeIsUpsell: true },
    ]
    const c = cohortClosing(righe, NOV_START, NOV_END)
    assert.equal(c.presenze, 1)
    assert.equal(c.chiusi, 1)
    assert.equal(c.closingPct, 100)
    assert.equal(isFunnelClosure({ salespersonOutcome: 'Chiuso', presentedAt: presenza, closeIsUpsell: true }), false)
    assert.equal(isFunnelClosure({ salespersonOutcome: 'Chiuso', presentedAt: presenza }), true)
})

test('Panoramica / Sales Manager (stageHits): upsell porta fatturato ma close = false', () => {
    const base = {
        appointmentDate: null, appointmentCreatedAt: null, confirmationsOutcome: null, confirmationsTimestamp: null,
        salespersonOutcome: 'Chiuso', salespersonOutcomeAt: new Date('2026-11-19T12:00:00Z'), presentedAt: null, closeAmountEur: 1180,
    }
    const hUp = stageHits({ ...base, closeIsUpsell: true }, NOV_START, NOV_END)
    assert.equal(hUp.close, false)
    assert.equal(hUp.fatturato, 1180)
    const hVera = stageHits({ ...base, closeIsUpsell: false }, NOV_START, NOV_END)
    assert.equal(hVera.close, true)
    assert.equal(hVera.fatturato, 1180)
    // Campo assente (letture vecchie): comportamento di prima.
    assert.equal(stageHits(base, NOV_START, NOV_END).close, true)
})

test('Performance venditori (salesAttempts): 1 vera + 1 upsell = 1 chiusura, fatturato sommato, ticket medio sulla sola vera', () => {
    const d = (s: string) => new Date(s)
    const attempts: AttemptInput[] = [
        { leadId: 'VERA', attemptNumber: 1, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 2000, outcomeAt: d('2026-11-12T10:00:00Z'), presentedAt: d('2026-11-05T15:00:00Z'), closeIsUpsell: false },
        { leadId: 'VERA', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-11-12T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-11-05T16:00:00Z'), presentedAt: d('2026-11-05T15:00:00Z'), closeIsUpsell: false },
        { leadId: 'UPSELL', attemptNumber: 0, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: null, closeAmountEur: 1180, outcomeAt: d('2026-11-19T12:00:00Z'), presentedAt: null, closeIsUpsell: true },
    ]
    const cs = closingStats(attempts, NOV_START, NOV_END)
    assert.equal(cs.chiusi, 1)
    assert.equal(cs.presenze, 1)
    assert.equal(cs.fatturato, 3180)
    assert.equal(cs.ticketMedio, 3180, 'DA CONFERMARE col titolare: euro con upsell / chiusure senza upsell')
    assert.equal(cs.topProduct, 'gold')
    const atc = attemptsToClose(attempts, NOV_START, NOV_END)
    assert.equal(atc.avgAttempts, 2, 'il tentativo #0 dell\'upsell non abbassa la media')
    assert.equal(atc.firstShotPct, 0)
    assert.equal(followUpFunnel(attempts, NOV_START, NOV_END).closed, 1)
})

test('monitor Black Friday: un upsell portato sulla scheda BF dà euro ma non una vendita in più', () => {
    const lead: LeadBf = {
        id: 'BF1', createdAt: new Date('2026-11-08T10:00:00Z'), utmSource: null, utmMedium: null, status: 'NEW', assignedToId: null,
        appointmentDate: null, confirmationsOutcome: null, confirmationsDiscardReason: null, presentedAt: null,
        salespersonOutcome: null, closeAmountEur: null, closeProduct: null, appointmentCreatedAt: null,
        confirmationsTimestamp: null, salespersonOutcomeAt: null, persona: '3330000605',
    }
    const { leads, attribuite } = attribuisciChiusureAltrove([lead], [
        { leadId: 'UPSELL', persona: '3330000605', at: new Date('2026-11-19T12:00:00Z'), closeAmountEur: 1180, closeProduct: null, closeIsUpsell: true },
    ])
    assert.equal(attribuite.length, 1)
    assert.equal(leads[0].salespersonOutcome, 'Chiuso')
    assert.equal(leads[0].closeIsUpsell, true)
    const s = stadiSm(leads, new Date('2026-11-07T00:00:00Z'), NOV_END)
    assert.equal(s.chiusi, 0)
    assert.equal(s.euro, 1180)
})
