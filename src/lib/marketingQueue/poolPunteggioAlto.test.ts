import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_PUNTEGGIO_ALTO_PER_VOLTA, etichettaFunnel, haSegnale, mesiDiEta, fasciaEta, etaTesto,
    quantiDaAssegnare, pianificaPareggio, quantiATesta,
} from './poolPunteggioAlto'

test('punteggio alto: funnel del marketing in italiano semplice', () => {
    assert.equal(etichettaFunnel('corso10ore'), 'Corso 10 ore')
    assert.equal(etichettaFunnel('jobsimulator'), 'Job Simulator')
    assert.equal(etichettaFunnel('TELEGRAM'), 'Telegram')
    assert.equal(etichettaFunnel('JOB SIMULATOR'), 'Job Simulator')
    assert.equal(etichettaFunnel('sconosciuto'), 'Non indicato')
    assert.equal(etichettaFunnel(null), 'Non indicato')
    assert.equal(etichettaFunnel('  '), 'Non indicato')
    assert.equal(etichettaFunnel('org'), 'org')
})

test('punteggio alto: segnale del marketing', () => {
    assert.equal(haSegnale("Ha cliccato l'email «X» oggi"), true)
    assert.equal(haSegnale('Ha visitato il sito 3 giorni fa'), true)
    assert.equal(haSegnale('Nessun segnale recente'), false)
    assert.equal(haSegnale('nessun segnale'), false)
    assert.equal(haSegnale(''), false)
    assert.equal(haSegnale(null), false)
})

test('punteggio alto: età del contatto', () => {
    assert.equal(mesiDiEta('2026-10-30', '2026-10-30'), 0)
    assert.equal(mesiDiEta('2026-04-30', '2026-10-30'), 6)
    assert.equal(mesiDiEta('2026-05-01', '2026-10-30'), 5)
    assert.equal(mesiDiEta('2024-07-21', '2026-10-30'), 27)
    assert.equal(mesiDiEta(null, '2026-10-30'), null)
    assert.equal(mesiDiEta('boh', '2026-10-30'), null)
    assert.equal(mesiDiEta('2026-12-01', '2026-10-30'), 0)

    assert.equal(fasciaEta(null), 'Non indicata')
    assert.equal(fasciaEta(5), 'Meno di 6 mesi')
    assert.equal(fasciaEta(6), 'Da 6 a 12 mesi')
    assert.equal(fasciaEta(12), 'Da 1 a 2 anni')
    assert.equal(fasciaEta(24), 'Oltre 2 anni')

    assert.equal(etaTesto(null), '—')
    assert.equal(etaTesto(0), 'meno di un mese')
    assert.equal(etaTesto(1), '1 mese')
    assert.equal(etaTesto(12), '1 anno')
    assert.equal(etaTesto(13), '1 anno e 1 mese')
    assert.equal(etaTesto(27), '2 anni e 3 mesi')
})

test('punteggio alto: quanti se ne assegnano', () => {
    assert.equal(quantiDaAssegnare(10, 41), 10)
    assert.equal(quantiDaAssegnare(100, 41), 41)
    assert.equal(quantiDaAssegnare(-1, 41), 0)
    assert.equal(quantiDaAssegnare(3.7, 41), 3)
    assert.equal(quantiDaAssegnare(Number.NaN, 41), 0)
    assert.equal(quantiDaAssegnare(5000, 5000), MAX_PUNTEGGIO_ALTO_PER_VOLTA)
})

test('punteggio alto: pareggio sulle prime chiamate, prima il più scarico', () => {
    const piano = pianificaPareggio(['l1', 'l2', 'l3', 'l4', 'l5'], [
        { id: 'a', carico: 10 },
        { id: 'b', carico: 7 },
        { id: 'c', carico: 10 },
    ])
    // b sale da 7 a 10, poi a parità decide l'ordine: a, b, c...
    assert.deepEqual(piano.map(p => p.gdoId), ['b', 'b', 'b', 'a', 'b'])
    assert.deepEqual(piano.map(p => p.leadId), ['l1', 'l2', 'l3', 'l4', 'l5'])
    assert.deepEqual([...quantiATesta(piano)].sort(), [['a', 1], ['b', 4]])
})

test('punteggio alto: niente GDO, niente piano', () => {
    assert.deepEqual(pianificaPareggio(['l1'], []), [])
    assert.deepEqual(pianificaPareggio([], [{ id: 'a', carico: 0 }]), [])
})
