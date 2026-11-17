import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggiornaStatoSim, inizioConteggio, leggiStatoSim, normalizzaDataCambio } from './cambioSim'

const ADESSO = new Date('2026-11-14T15:05:00+01:00')
const DOPO = new Date('2026-11-14T17:05:00+01:00')
const riga = (interno: string, dataCambio = '') => ({ interno, dataCambio })

test('data ultimo cambio: si tolgono gli spazi', () => {
    assert.equal(normalizzaDataCambio(' 14 / 11 / 2026 '), '14/11/2026')
    assert.equal(normalizzaDataCambio(''), '')
})

test('primo giro: si memorizza il valore senza azzerare', () => {
    const r = aggiornaStatoSim({}, [riga('1017', '14/11/2026'), riga('1016')], ADESSO)
    assert.deepEqual(r.stato['1017'], { dataCambio: '14/11/2026', dal: null })
    assert.deepEqual(r.stato['1016'], { dataCambio: '', dal: null })
    assert.deepEqual(r.cambiati, [])
})

test('valore invariato (anche con spazi diversi): nessun azzeramento, la ripartenza di prima resta', () => {
    const dal = '2026-11-14T10:00:00.000Z'
    const r = aggiornaStatoSim({ '1017': { dataCambio: '14/11/2026', dal } }, [riga('1017', '14/11/2026 ')], ADESSO)
    assert.deepEqual(r.stato['1017'], { dataCambio: '14/11/2026', dal })
    assert.deepEqual(r.cambiati, [])
})

test('valore nuovo: si riparte dall\'istante del giro, anche se la data non si capisce o è di un altro giorno', () => {
    for (const nuovo of ['14/11/2026', '01/01/2020', 'cambiata stamattina']) {
        const r = aggiornaStatoSim({ '1017': { dataCambio: '', dal: null } }, [riga('1017', nuovo)], ADESSO)
        assert.deepEqual(r.stato['1017'], { dataCambio: normalizzaDataCambio(nuovo), dal: ADESSO.toISOString() }, nuovo)
        assert.deepEqual(r.cambiati, ['1017'])
    }
})

test('cella svuotata: nessun azzeramento, si aggiorna solo il ricordo', () => {
    const r = aggiornaStatoSim({ '1017': { dataCambio: '13/11/2026', dal: null } }, [riga('1017', '')], ADESSO)
    assert.deepEqual(r.stato['1017'], { dataCambio: '', dal: null })
    assert.deepEqual(r.cambiati, [])
    // e se poi si riscrive la stessa data di prima è un valore nuovo rispetto al vuoto
    const r2 = aggiornaStatoSim(r.stato, [riga('1017', '13/11/2026')], DOPO)
    assert.deepEqual(r2.cambiati, ['1017'])
})

test('due cambi nello stesso giorno: vale l\'ultimo', () => {
    const r1 = aggiornaStatoSim({ '1017': { dataCambio: '', dal: null } }, [riga('1017', '14/11/2026')], ADESSO)
    const r2 = aggiornaStatoSim(r1.stato, [riga('1017', '14/11/2026 bis')], DOPO)
    assert.equal(r2.stato['1017'].dal, DOPO.toISOString())
    assert.equal(inizioConteggio(r2.stato['1017'].dal, DOPO).toISOString(), DOPO.toISOString())
})

test('il cambio del numero da solo non azzera niente', () => {
    const prima = { '1017': { dataCambio: '', dal: null } }
    const r = aggiornaStatoSim(prima, [{ interno: '1017', dataCambio: '', numero: '3511111111' } as { interno: string; dataCambio: string }], ADESSO)
    assert.deepEqual(r.cambiati, [])
})

test('stato del formato vecchio (sul numero): letto senza errori, al primo giro nuovo nessun azzeramento', () => {
    const vecchio = JSON.stringify({ '1017': { numero: '3522286297', dal: null }, '1016': { numero: '', dal: '2026-11-14T10:00:00.000Z' } })
    const stato = leggiStatoSim(vecchio)
    assert.deepEqual(stato, {
        '1017': { dataCambio: null, dal: null },
        '1016': { dataCambio: null, dal: '2026-11-14T10:00:00.000Z' },
    })
    const r = aggiornaStatoSim(stato, [riga('1017', '14/11/2026'), riga('1016', '')], ADESSO)
    assert.deepEqual(r.cambiati, [])
    assert.deepEqual(r.stato['1017'], { dataCambio: '14/11/2026', dal: null })
})

test('righe sparite dal foglio: il loro stato resta; interno ripetuto: vale la prima riga', () => {
    const r = aggiornaStatoSim({ '1005': { dataCambio: 'x', dal: null } }, [riga('1017', 'a'), riga('1017', 'b')], ADESSO)
    assert.ok(r.stato['1005'])
    assert.equal(r.stato['1017'].dataCambio, 'a')
})

test('inizio del conteggio: mezzanotte di Roma, o la ripartenza se è di oggi', () => {
    assert.equal(inizioConteggio(null, ADESSO).toISOString(), '2026-11-13T23:00:00.000Z')
    assert.equal(inizioConteggio('2026-11-12T10:00:00.000Z', ADESSO).toISOString(), '2026-11-13T23:00:00.000Z')
    assert.equal(inizioConteggio('2026-11-14T12:00:00.000Z', ADESSO).toISOString(), '2026-11-14T12:00:00.000Z')
})

test('stato salvato: JSON rovinato = stato vuoto, righe malformate scartate', () => {
    assert.deepEqual(leggiStatoSim(null), {})
    assert.deepEqual(leggiStatoSim('non json'), {})
    assert.deepEqual(leggiStatoSim('[1,2]'), {})
    assert.deepEqual(leggiStatoSim(JSON.stringify({ '1017': { dataCambio: '1/1', dal: null }, x: 3 })), { '1017': { dataCambio: '1/1', dal: null } })
})
