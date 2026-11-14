import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggiornaStatoSim, cambioDiOggi, inizioConteggio, leggiStatoSim, normalizzaNumero } from './cambioSim'

const ADESSO = new Date('2026-11-14T15:05:00+01:00')
const riga = (interno: string, numero: string, dataCambio = '') => ({ interno, numero, dataCambio })

test('numero: solo cifre, prefisso italiano tolto, testo e "/" = nessun numero', () => {
    assert.equal(normalizzaNumero('352 228 6297'), '3522286297')
    assert.equal(normalizzaNumero('+39 352 228 6297'), '3522286297')
    assert.equal(normalizzaNumero('0039 3522286297'), '3522286297')
    assert.equal(normalizzaNumero('/'), '')
    assert.equal(normalizzaNumero('da ins'), '')
    assert.equal(normalizzaNumero(''), '')
})

test('data ultimo cambio: vale solo se è oggi (ora di Roma)', () => {
    assert.equal(cambioDiOggi('14/11/2026', ADESSO), true)
    assert.equal(cambioDiOggi('14/11/26', ADESSO), true)
    assert.equal(cambioDiOggi('14/11', ADESSO), true)
    assert.equal(cambioDiOggi('2026-11-14', ADESSO), true)
    assert.equal(cambioDiOggi('13/11/2026', ADESSO), false)
    assert.equal(cambioDiOggi('', ADESSO), false)
    assert.equal(cambioDiOggi('boh', ADESSO), false)
})

test('primo giro: si memorizza il numero, nessuna ripartenza se la data del cambio non è oggi', () => {
    const r = aggiornaStatoSim({}, [riga('1017', '3522286297', '01/11/2026')], ADESSO)
    assert.deepEqual(r.stato['1017'], { numero: '3522286297', dal: null })
    assert.deepEqual(r.cambiati, [])
})

test('primo giro con DATA ULTIMO CAMBIO di oggi: il conteggio riparte da adesso', () => {
    const r = aggiornaStatoSim({}, [riga('1017', '3522286297', '14/11/2026')], ADESSO)
    assert.equal(r.stato['1017'].dal, ADESSO.toISOString())
    assert.deepEqual(r.cambiati, ['1017'])
})

test('numero cambiato: il conteggio riparte dal giro che lo vede, anche senza data compilata', () => {
    const prima = { '1017': { numero: '3522286297', dal: null } }
    const r = aggiornaStatoSim(prima, [riga('1017', '3511111111')], ADESSO)
    assert.deepEqual(r.stato['1017'], { numero: '3511111111', dal: ADESSO.toISOString() })
    assert.deepEqual(r.cambiati, ['1017'])
})

test('numero uguale (anche scritto diverso): la ripartenza di prima resta', () => {
    const dal = '2026-11-14T10:00:00.000Z'
    const prima = { '1017': { numero: '3522286297', dal } }
    const r = aggiornaStatoSim(prima, [riga('1017', '352 228 6297', '14/11/2026')], ADESSO)
    assert.deepEqual(r.stato['1017'], { numero: '3522286297', dal })
    assert.deepEqual(r.cambiati, [])
})

test('SIM tolta ("/") o messa ("da ins" → numero): sono cambi', () => {
    const r1 = aggiornaStatoSim({ '1008': { numero: '3522286297', dal: null } }, [riga('1008', '/')], ADESSO)
    assert.deepEqual(r1.cambiati, ['1008'])
    const r2 = aggiornaStatoSim({ '1020': { numero: '', dal: null } }, [riga('1020', '3522286297')], ADESSO)
    assert.deepEqual(r2.cambiati, ['1020'])
    const r3 = aggiornaStatoSim({ '1020': { numero: '', dal: null } }, [riga('1020', 'da ins')], ADESSO)
    assert.deepEqual(r3.cambiati, [])
})

test('righe sparite dal foglio: il loro stato resta (se tornano non sono un "primo giro")', () => {
    const r = aggiornaStatoSim({ '1005': { numero: '3522595107', dal: null } }, [riga('1017', '3522286297')], ADESSO)
    assert.ok(r.stato['1005'])
    assert.ok(r.stato['1017'])
})

test('interno ripetuto nel foglio: vale la prima riga', () => {
    const r = aggiornaStatoSim({}, [riga('1017', '3522286297'), riga('1017', '3511111111')], ADESSO)
    assert.equal(r.stato['1017'].numero, '3522286297')
})

test('inizio del conteggio: mezzanotte di Roma, o la ripartenza se è di oggi', () => {
    assert.equal(inizioConteggio(null, ADESSO).toISOString(), '2026-11-13T23:00:00.000Z')
    assert.equal(inizioConteggio('2026-11-12T10:00:00.000Z', ADESSO).toISOString(), '2026-11-13T23:00:00.000Z')
    assert.equal(inizioConteggio('2026-11-14T12:00:00.000Z', ADESSO).toISOString(), '2026-11-14T12:00:00.000Z')
})

test('stato salvato: JSON rovinato o vecchio = stato vuoto, righe malformate scartate', () => {
    assert.deepEqual(leggiStatoSim(null), {})
    assert.deepEqual(leggiStatoSim('non json'), {})
    assert.deepEqual(leggiStatoSim('[1,2]'), {})
    assert.deepEqual(
        leggiStatoSim(JSON.stringify({ '1017': { numero: '35', dal: null }, x: 3, y: { numero: 5 } })),
        { '1017': { numero: '35', dal: null } },
    )
})
