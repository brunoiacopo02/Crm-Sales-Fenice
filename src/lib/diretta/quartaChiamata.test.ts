import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    finestraFissaggioQuarta, fissaggioQuarta, mostraQuartaChiamata, scartiDalQuarta,
    MIN_LEAD_CHIAMATI_QUARTA, RIPARTENZA_QUARTA, SOGLIA_FISSAGGIO_QUARTA,
} from './quartaChiamata'

// Lunedì 26/10/2026 alle 15:00 di Roma, primo giorno di ora solare (UTC+1).
const LUNEDI = new Date('2026-10-26T14:00:00Z')

test('finestra: 7 giorni lavorativi con oggi, la domenica non conta', () => {
    const f = finestraFissaggioQuarta(LUNEDI)
    // lun 26, sab 24, ven 23, gio 22, mer 21, mar 20, lun 19 (ancora ora legale).
    assert.equal(f.start.toISOString(), '2026-10-18T22:00:00.000Z')
    assert.equal(f.end.toISOString(), '2026-10-26T23:00:00.000Z')
})

test('finestra: di domenica si parte da sabato e si arriva al sabato prima', () => {
    const f = finestraFissaggioQuarta(new Date('2026-10-25T15:00:00Z'))
    assert.equal(f.start.toISOString(), '2026-10-16T22:00:00.000Z')
    assert.equal(f.end.toISOString(), '2026-10-25T23:00:00.000Z')
})

test('fissaggio: intero arrotondato come in I miei risultati, null senza lead', () => {
    assert.equal(fissaggioQuarta(0, 0), null)
    assert.equal(fissaggioQuarta(100, 12), 12)
    assert.equal(fissaggioQuarta(200, 23), 12) // 11,5 -> 12: il GDO vede 12, la sezione non appare
})

test('regola: appare solo sotto la soglia e con abbastanza lead chiamati', () => {
    assert.equal(SOGLIA_FISSAGGIO_QUARTA, 12)
    assert.equal(MIN_LEAD_CHIAMATI_QUARTA, 30)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 100, appuntamenti: 11 }), true)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 100, appuntamenti: 12 }), false)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 200, appuntamenti: 23 }), false)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 30, appuntamenti: 0 }), true)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 29, appuntamenti: 0 }), false)
    assert.equal(mostraQuartaChiamata({ leadChiamati: 0, appuntamenti: 0 }), false)
})

test('scarti recuperabili: mai prima della ripartenza del 26/10, poi gli ultimi 30 giorni', () => {
    assert.equal(scartiDalQuarta(LUNEDI).getTime(), RIPARTENZA_QUARTA.getTime())
    const dicembre = new Date('2026-12-15T12:00:00Z')
    assert.equal(scartiDalQuarta(dicembre).toISOString(), '2026-11-15T12:00:00.000Z')
})
