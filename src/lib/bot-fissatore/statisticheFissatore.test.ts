import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    percentuale, semaforo, confronto, meseDaParametro, mesePrecedente,
    haRisposto, funnelDelBot, lineaDelPiano, type LeadDelBot,
} from './statisticheFissatore'

// ------------------------------------------------------------- percentuale

test('percentuale: null con denominatore zero, altrimenti num/den*100', () => {
    assert.equal(percentuale(1, 0), null)
    assert.equal(percentuale(1, 4), 25)
    assert.equal(percentuale(0, 3), 0)
})

// ------------------------------------------------------------- semaforo

test('semaforo: più alto è meglio, verde alla linea e sopra', () => {
    assert.equal(semaforo(18.6, 18.6, 'alto'), 'verde')
    assert.equal(semaforo(20, 18.6, 'alto'), 'verde')
    assert.equal(semaforo(18.59, 18.6, 'alto'), 'rosso')
})

test('semaforo: più basso è meglio (restituzioni), verde alla soglia e sotto', () => {
    assert.equal(semaforo(50, 50, 'basso'), 'verde')
    assert.equal(semaforo(40, 50, 'basso'), 'verde')
    assert.equal(semaforo(51, 50, 'basso'), 'rosso')
})

test('semaforo: senza valore o senza soglia nessun colore', () => {
    assert.equal(semaforo(null, 18.6, 'alto'), null)
    assert.equal(semaforo(20, null, 'alto'), null)
})

// ------------------------------------------------------------- confronto

test('confronto: differenza col mese prima, null se manca uno dei due', () => {
    assert.equal(confronto(20, 15), 5)
    assert.equal(confronto(10, 12.5), -2.5)
    assert.equal(confronto(null, 3), null)
    assert.equal(confronto(3, null), null)
})

// ------------------------------------------------------------- mesi

test('meseDaParametro: mese corrente di Roma come default', () => {
    // 31/10 alle 23:30 UTC a Roma è già novembre
    assert.equal(meseDaParametro(undefined, new Date('2026-10-31T23:30:00Z')), '2026-11')
    assert.equal(meseDaParametro('', new Date('2026-10-28T10:00:00Z')), '2026-10')
})

test('meseDaParametro: accetta YYYY-MM valido, scarta il resto e i mesi futuri', () => {
    const ora = new Date('2026-10-28T10:00:00Z')
    assert.equal(meseDaParametro('2026-09', ora), '2026-09')
    assert.equal(meseDaParametro('2026-13', ora), '2026-10')
    assert.equal(meseDaParametro('ciao', ora), '2026-10')
    assert.equal(meseDaParametro('2026-11', ora), '2026-10')
})

test('mesePrecedente: anche a cavallo dell\'anno', () => {
    assert.equal(mesePrecedente('2026-10'), '2026-09')
    assert.equal(mesePrecedente('2027-01'), '2026-12')
})

// ------------------------------------------------------------- risposta

test('haRisposto: appuntamento o scarto del bot contano', () => {
    assert.equal(haRisposto({ logDelBot: [{ outcome: 'APPUNTAMENTO', discardReason: null }], restituzione: null, segnaliDiRisposta: false }), true)
    assert.equal(haRisposto({ logDelBot: [{ outcome: 'DA_SCARTARE', discardReason: 'non interessato' }], restituzione: null, segnaliDiRisposta: false }), true)
})

test('haRisposto: scarto "numero inesistente" non è una risposta', () => {
    assert.equal(haRisposto({ logDelBot: [{ outcome: 'DA_SCARTARE', discardReason: 'Numero inesistente' }], restituzione: null, segnaliDiRisposta: false }), false)
})

test('haRisposto: chat interrotta e segnali (report, messaggi, richiesta contatto) contano', () => {
    assert.equal(haRisposto({ logDelBot: [], restituzione: { reason: 'chat_interrotta', toGdo: 'g' }, segnaliDiRisposta: false }), true)
    assert.equal(haRisposto({ logDelBot: [], restituzione: null, segnaliDiRisposta: true }), true)
})

test('haRisposto: mai risposto restituito e nessun segnale = non ha risposto', () => {
    assert.equal(haRisposto({ logDelBot: [{ outcome: 'NON_RISPOSTO', discardReason: null }], restituzione: { reason: 'mai_risposto', toGdo: null }, segnaliDiRisposta: false }), false)
})

// ------------------------------------------------------------- funnel del bot

function lead(p: Partial<LeadDelBot>): LeadDelBot {
    return { logDelBot: [], restituzione: null, segnaliDiRisposta: false, assignedToId: 'bot', ...p }
}

test('funnelDelBot: conteggi e tassi sulla coorte', () => {
    const f = funnelDelBot([
        lead({ logDelBot: [{ outcome: 'APPUNTAMENTO', discardReason: null }] }),
        lead({ segnaliDiRisposta: true }),
        lead({ restituzione: { reason: 'chat_interrotta', toGdo: 'gdo-1' }, assignedToId: 'gdo-1' }),
        lead({ restituzione: { reason: 'chat_interrotta', toGdo: 'gdo-2' }, assignedToId: null }),
        lead({ restituzione: { reason: 'mai_risposto', toGdo: null }, assignedToId: null }),
        lead({ restituzione: { reason: 'mai_risposto', toGdo: null }, assignedToId: 'gdo-3' }),
        lead({ restituzione: { reason: 'mai_risposto', toGdo: 'gdo-4' }, assignedToId: 'gdo-4' }),
        lead({}),
    ])
    assert.equal(f.ricevuti, 8)
    assert.equal(f.risposti, 4)
    assert.equal(f.fissati, 1)
    assert.equal(f.pctRisposta, 50)
    assert.equal(f.pctFissaggioTotale, 12.5)
    assert.equal(f.pctFissaggioRisposti, 25)
    assert.equal(f.restituiti, 5)
    assert.equal(f.pctRestituzione, 62.5)
    assert.deepEqual(f.chatInterrotta, { totale: 2, aUnGdo: 2, parcheggiati: 0, ancoraDaChiamare: 1 })
    assert.deepEqual(f.maiRisposto, { totale: 3, aUnGdo: 1, parcheggiati: 2, ancoraDaChiamare: 1 })
})

test('funnelDelBot: coorte vuota, tassi null', () => {
    const f = funnelDelBot([])
    assert.equal(f.ricevuti, 0)
    assert.equal(f.pctRisposta, null)
    assert.equal(f.pctFissaggioRisposti, null)
})

// ------------------------------------------------------------- linea del piano

test('lineaDelPiano: conferme sugli appuntamenti, presenze sui confermati, chiusi sui presentati', () => {
    const d = new Date('2026-10-10T10:00:00Z')
    const l = lineaDelPiano([
        { confirmationsOutcome: 'confermato', presentedAt: d, salespersonOutcome: 'Chiuso' },
        { confirmationsOutcome: 'confermato', presentedAt: d, salespersonOutcome: 'Non chiuso' },
        { confirmationsOutcome: 'confermato', presentedAt: d, salespersonOutcome: null },
        { confirmationsOutcome: 'confermato', presentedAt: null, salespersonOutcome: null },
        { confirmationsOutcome: 'scartato', presentedAt: null, salespersonOutcome: null },
        // chiuso senza presenza: non è una chiusura del funnel
        { confirmationsOutcome: null, presentedAt: null, salespersonOutcome: 'Chiuso' },
        { confirmationsOutcome: null, presentedAt: null, salespersonOutcome: null },
        { confirmationsOutcome: null, presentedAt: null, salespersonOutcome: null },
    ])
    assert.equal(l.appuntamenti, 8)
    assert.equal(l.confermati, 4)
    assert.equal(l.pctConferma, 50)
    assert.equal(l.presentatiConfermati, 3)
    assert.equal(l.pctPresenza, 75)
    assert.equal(l.presentati, 3)
    assert.equal(l.chiusi, 1)
    assert.equal(l.inLavorazione, 1)
    assert.ok(Math.abs((l.pctClosing ?? 0) - 100 / 3) < 1e-9)
})
