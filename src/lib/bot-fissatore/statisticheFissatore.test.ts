import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    percentuale, semaforo, confronto, meseDaParametro, mesePrecedente,
    haRisposto, funnelDelBot, lineaDelPiano, eLeadEvergreen, lavoroDeiGdo, type LeadDelBot, type LeadRidato,
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

const T0 = new Date('2026-10-05T10:00:00Z')            // assegnato al bot
const T1 = new Date('2026-10-06T10:00:00Z')            // mentre è del bot
const TR = new Date('2026-10-09T10:00:00Z')            // prima restituzione
const T2 = new Date('2026-10-10T10:00:00Z')            // dopo la restituzione
const PRIMA = new Date('2026-10-04T10:00:00Z')         // prima dell'assegnazione

function lead(p: Partial<LeadDelBot>): LeadDelBot {
    return { assegnatoIl: T0, logDelBot: [], restituzione: null, segnali: [], assignedToId: 'bot', ...p }
}
const log = (outcome: string, at: Date, discardReason: string | null = null) => ({ outcome, discardReason, at })

test('haRisposto: appuntamento o scarto del bot contano', () => {
    assert.equal(haRisposto(lead({ logDelBot: [log('APPUNTAMENTO', T1)] })), true)
    assert.equal(haRisposto(lead({ logDelBot: [log('DA_SCARTARE', T1, 'non interessato')] })), true)
})

test('haRisposto: scarto "numero inesistente" non è una risposta', () => {
    assert.equal(haRisposto(lead({ logDelBot: [log('DA_SCARTARE', T1, 'Numero inesistente')] })), false)
    // Gli scarti "Nessun messaggio consegnato in 14 giorni" (26/07-25/09/2026,
    // 834 log) hanno tutti discardReason 'numero inesistente': fuori anche loro.
    assert.equal(haRisposto(lead({ logDelBot: [log('DA_SCARTARE', T1, 'numero inesistente')] })), false)
})

// ------------------------------------------------------------- evergreen

const base = { launchBucket: null, intakeBatch: null, funnel: 'TELEGRAM', lancioPool: null, humanTestCohort: null }

test('eLeadEvergreen: lead AC senza lancio, senza infornata e non database', () => {
    assert.equal(eLeadEvergreen(base), true)
    assert.equal(eLeadEvergreen({ ...base, funnel: null }), true)
})

test('eLeadEvergreen: lanci, infornate e database sono fuori', () => {
    assert.equal(eLeadEvergreen({ ...base, launchBucket: 'LANCIO_WEBDEV_2026' }), false)
    assert.equal(eLeadEvergreen({ ...base, intakeBatch: 'DB_LISTA133_20260915' }), false)
    assert.equal(eLeadEvergreen({ ...base, funnel: 'DATABASE' }), false)
    assert.equal(eLeadEvergreen({ ...base, funnel: ' Database ' }), false)
    assert.equal(eLeadEvergreen({ ...base, funnel: 'Lancio Web Dev AI' }), false)
    assert.equal(eLeadEvergreen({ ...base, lancioPool: 'VERGINI' }), false)
    assert.equal(eLeadEvergreen({ ...base, humanTestCohort: 'gdo_umani_lancio' }), false)
})

test('haRisposto: chat interrotta e segnali (report, messaggi, richiesta contatto) contano', () => {
    assert.equal(haRisposto(lead({ restituzione: { reason: 'chat_interrotta', toGdo: 'g', at: TR } })), true)
    assert.equal(haRisposto(lead({ segnali: [T1] })), true)
})

test('haRisposto: mai risposto restituito e nessun segnale = non ha risposto', () => {
    assert.equal(haRisposto(lead({ logDelBot: [log('NON_RISPOSTO', T1)], restituzione: { reason: 'mai_risposto', toGdo: null, at: TR } })), false)
})

test('haRisposto: contano solo i segnali mentre il lead è del bot (fra assegnazione e prima restituzione)', () => {
    const mai = { reason: 'mai_risposto', toGdo: null, at: TR }
    // dopo la restituzione: agenda e riscaldamento dei GDO passano dai numeri del bot
    assert.equal(haRisposto(lead({ restituzione: mai, segnali: [T2] })), false)
    assert.equal(haRisposto(lead({ restituzione: mai, logDelBot: [log('DA_SCARTARE', T2, 'non interessato')] })), false)
    // nello stesso istante della restituzione: già fuori
    assert.equal(haRisposto(lead({ restituzione: mai, segnali: [TR] })), false)
    // prima dell'assegnazione: non è una risposta al bot
    assert.equal(haRisposto(lead({ segnali: [PRIMA] })), false)
    // dentro la finestra
    assert.equal(haRisposto(lead({ restituzione: mai, segnali: [T1] })), true)
    // senza restituzione la finestra resta aperta
    assert.equal(haRisposto(lead({ segnali: [T2] })), true)
})

test('haRisposto: un lead fissato dal bot ha sempre risposto, anche se fissato dopo la restituzione', () => {
    const mai = { reason: 'mai_risposto', toGdo: null, at: TR }
    assert.equal(haRisposto(lead({ restituzione: mai, logDelBot: [log('APPUNTAMENTO', T2)] })), true)
    assert.equal(haRisposto(lead({ logDelBot: [log('APPUNTAMENTO', PRIMA)] })), true)
})

test('funnelDelBot: i fissati dopo la restituzione stanno nei fissati e fra chi risponde', () => {
    const mai = { reason: 'mai_risposto', toGdo: null, at: TR }
    const f = funnelDelBot([
        lead({ restituzione: mai, logDelBot: [log('APPUNTAMENTO', T2)] }),
        lead({ restituzione: mai }),
    ])
    assert.equal(f.fissati, 1)
    assert.equal(f.risposti, 1)
    assert.equal(f.pctFissaggioRisposti, 100)
})

// ------------------------------------------------------------- funnel del bot

test('funnelDelBot: conteggi e tassi sulla coorte', () => {
    const ci = (toGdo: string) => ({ reason: 'chat_interrotta', toGdo, at: TR })
    const mr = (toGdo: string | null) => ({ reason: 'mai_risposto', toGdo, at: TR })
    const f = funnelDelBot([
        lead({ logDelBot: [log('APPUNTAMENTO', T1)] }),
        lead({ segnali: [T1] }),
        lead({ restituzione: ci('gdo-1'), assignedToId: 'gdo-1' }),
        lead({ restituzione: ci('gdo-2'), assignedToId: null }),
        lead({ restituzione: mr(null), assignedToId: null }),
        lead({ restituzione: mr(null), assignedToId: 'gdo-3' }),
        lead({ restituzione: mr('gdo-4'), assignedToId: 'gdo-4' }),
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

// ------------------------------------------------------------- lavoro dei GDO sui ridati

const ORA = new Date('2026-10-28T12:00:00Z')
const RIDATO_IL = new Date('2026-10-05T10:00:00Z')
const PASSATO = new Date('2026-10-20T15:00:00Z')
const FUTURO = new Date('2026-11-03T15:00:00Z')

function ridato(over: Partial<LeadRidato> & { reason?: string | null; toGdo?: string | null } = {}): LeadRidato {
    const { reason = 'mai_risposto', toGdo = 'gdo-1', ...resto } = over
    return {
        restituzione: { reason, toGdo, at: RIDATO_IL },
        assignedToId: toGdo,
        fissaggi: [],
        appointmentDate: null,
        confirmationsOutcome: null,
        presentedAt: null,
        salespersonOutcome: null,
        ...resto,
    }
}
const gdo = (at: Date) => ({ at, delBot: false })
const bot = (at: Date) => ({ at, delBot: true })
const dopo = new Date('2026-10-06T10:00:00Z')

test('lavoroDeiGdo: due gruppi per motivo e totale; ridati, passati a un GDO, senza nessuno oggi', () => {
    const r = lavoroDeiGdo([
        ridato({ reason: 'chat_interrotta' }),
        ridato({ reason: 'chat_interrotta', toGdo: null }),
        ridato({ reason: 'mai_risposto' }),
        ridato({ reason: 'mai_risposto', assignedToId: null }),
        ridato({ reason: 'mai_risposto', toGdo: null }),
        ridato({ reason: 'altro' }),
    ], ORA)
    assert.equal(r.chatInterrotta.ridati, 2)
    assert.equal(r.chatInterrotta.aUnGdo, 1)
    assert.equal(r.chatInterrotta.ancoraDaChiamare, 1)
    assert.equal(r.maiRisposto.ridati, 3)
    assert.equal(r.maiRisposto.aUnGdo, 2)
    assert.equal(r.maiRisposto.ancoraDaChiamare, 2)
    // Il totale è la somma dei due gruppi: altri motivi fuori.
    assert.equal(r.totale.ridati, 5)
    assert.equal(r.totale.aUnGdo, 3)
    assert.equal(r.totale.ancoraDaChiamare, 3)
})

test('lavoroDeiGdo: fissati = appuntamento di un GDO dopo la restituzione, sui passati a un GDO', () => {
    const r = lavoroDeiGdo([
        ridato({ fissaggi: [gdo(dopo)] }),
        // appuntamento del bot prima della restituzione: non conta
        ridato({ fissaggi: [bot(new Date('2026-10-02T10:00:00Z'))] }),
        // appuntamento di un GDO prima della restituzione: non conta
        ridato({ fissaggi: [gdo(new Date('2026-10-01T10:00:00Z'))] }),
        // fissato dal bot dopo la restituzione: non è dei GDO
        ridato({ fissaggi: [bot(dopo)] }),
        ridato(),
        // non passato a un GDO: fuori dal denominatore anche se fissato
        ridato({ toGdo: null, fissaggi: [gdo(dopo)] }),
    ], ORA)
    assert.equal(r.maiRisposto.aUnGdo, 5)
    assert.equal(r.maiRisposto.fissati, 1)
    assert.equal(r.maiRisposto.pctFissati, 20)
})

test('lavoroDeiGdo: conferme, presenze e chiusure sugli appuntamenti dei GDO già passati', () => {
    const r = lavoroDeiGdo([
        ridato({ fissaggi: [gdo(dopo)], appointmentDate: PASSATO, confirmationsOutcome: 'confermato', presentedAt: PASSATO, salespersonOutcome: 'Chiuso' }),
        ridato({ fissaggi: [gdo(dopo)], appointmentDate: PASSATO, confirmationsOutcome: 'confermato', presentedAt: PASSATO, salespersonOutcome: 'Non chiuso' }),
        ridato({ fissaggi: [gdo(dopo)], appointmentDate: PASSATO, confirmationsOutcome: 'confermato' }),
        ridato({ fissaggi: [gdo(dopo)], appointmentDate: PASSATO, confirmationsOutcome: 'scartato' }),
        // appuntamento non ancora passato: fissato sì, nel resto no
        ridato({ fissaggi: [gdo(dopo)], appointmentDate: FUTURO, confirmationsOutcome: 'confermato' }),
        // il bot lo ha rifissato dopo il GDO: l'appuntamento di oggi è del bot
        ridato({ fissaggi: [gdo(dopo), bot(new Date('2026-10-08T10:00:00Z'))], appointmentDate: PASSATO, confirmationsOutcome: 'confermato' }),
    ], ORA)
    const g = r.maiRisposto
    assert.equal(g.fissati, 6)
    assert.equal(g.appuntamentiPassati, 4)
    assert.equal(g.confermati, 3)
    assert.equal(g.pctConferma, 75)
    assert.equal(g.presentatiConfermati, 2)
    assert.ok(Math.abs((g.pctPresenza ?? 0) - 200 / 3) < 1e-9)
    assert.equal(g.presentati, 2)
    assert.equal(g.chiusi, 1)
    assert.equal(g.pctClosing, 50)
    assert.equal(r.totale.appuntamentiPassati, 4)
})

test('lavoroDeiGdo: nessun lead, tutti i tassi null', () => {
    const r = lavoroDeiGdo([], ORA)
    assert.equal(r.totale.ridati, 0)
    assert.equal(r.totale.pctFissati, null)
    assert.equal(r.totale.pctConferma, null)
    assert.equal(r.totale.pctPresenza, null)
    assert.equal(r.totale.pctClosing, null)
})
