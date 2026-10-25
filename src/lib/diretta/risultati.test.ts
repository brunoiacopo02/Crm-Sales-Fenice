import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etichettaAndamento, numeriPeriodo, periodoRisultati, righeAndamento, PERIODI } from './risultati'

// Lunedì 26/10/2026 alle 15:00 di Roma, primo giorno di ora solare (UTC+1).
const ORA = new Date('2026-10-26T14:00:00Z')

test('periodi: oggi, ultimi 7 giorni, questo mese e mese scorso in ora di Roma', () => {
    const oggi = periodoRisultati('oggi', ORA)
    assert.equal(oggi.start.toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(oggi.end.toISOString(), '2026-10-26T23:00:00.000Z')
    assert.equal(oggi.granularita, 'hour')

    const sette = periodoRisultati('7', ORA)
    // Da martedì 20/10 (ancora ora legale) a lunedì 26/10 compreso.
    assert.equal(sette.start.toISOString(), '2026-10-19T22:00:00.000Z')
    assert.equal(sette.end.toISOString(), '2026-10-26T23:00:00.000Z')
    assert.equal(sette.granularita, 'day')

    const mese = periodoRisultati('mese', ORA)
    assert.equal(mese.start.toISOString(), '2026-09-30T22:00:00.000Z')
    assert.equal(mese.end.toISOString(), '2026-10-31T23:00:00.000Z')

    const scorso = periodoRisultati('mese-scorso', ORA)
    assert.equal(scorso.start.toISOString(), '2026-08-31T22:00:00.000Z')
    assert.equal(scorso.end.toISOString(), '2026-09-30T22:00:00.000Z')
})

test('periodi: una chiave sconosciuta o mancante vale oggi', () => {
    assert.equal(periodoRisultati(undefined, ORA).chiave, 'oggi')
    assert.equal(periodoRisultati('30', ORA).chiave, 'oggi')
    assert.deepEqual(PERIODI.map(p => p.chiave), ['oggi', '7', 'mese', 'mese-scorso'])
})

test('numeri del periodo: somme e percentuali intere, nessuna divisione per zero', () => {
    assert.deepEqual(numeriPeriodo([]), {
        chiamate: 0, risposte: 0, tassoRisposta: null, leadChiamati: 0, appuntamenti: 0, fissaggio: null, confermati: 0, presentati: 0,
    })
    const n = numeriPeriodo([
        { calls: 120, answers: 40, contactedLeads: 80, appointments: 5, confirmed: 3, presenziati: 2 },
        // Appuntamenti dei suoi lead senza chiamate nel periodo: una seconda riga.
        { calls: 0, answers: 0, contactedLeads: 0, appointments: 1, confirmed: 1, presenziati: 0 },
    ])
    assert.equal(n.chiamate, 120)
    assert.equal(n.tassoRisposta, 33)
    assert.equal(n.appuntamenti, 6)
    assert.equal(n.fissaggio, 8)
    assert.equal(n.confermati, 4)
    assert.equal(n.presentati, 2)
})

test('andamento: giorni in italiano, ore intatte, i giorni vuoti non fanno righe', () => {
    assert.equal(etichettaAndamento('Mon 26/10'), 'lun 26/10')
    assert.equal(etichettaAndamento('Sun 25/10'), 'dom 25/10')
    assert.equal(etichettaAndamento('13:30'), '13:30')
    const giorni = righeAndamento([
        { timeLabel: 'Sat 24/10', chiamate: 30, appuntamenti: 1 },
        { timeLabel: 'Sun 25/10', chiamate: 0, appuntamenti: 0 },
        { timeLabel: 'Mon 26/10', chiamate: 0, appuntamenti: 1 },
    ], 'day')
    assert.deepEqual(giorni.map(g => g.etichetta), ['sab 24/10', 'lun 26/10'])
    const ore = righeAndamento([{ timeLabel: '13:30', chiamate: 0, appuntamenti: 0 }, { timeLabel: '14:00', chiamate: 12, appuntamenti: 0 }], 'hour')
    assert.equal(ore.length, 2)
})
