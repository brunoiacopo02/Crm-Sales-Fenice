import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    leggiObiettiviSalvati, risolviObiettivi, validaObiettivi, CHIAVI_OBIETTIVI,
    type ObiettiviDefault,
} from './obiettiviFissatore'
import { OBIETTIVI_FISSATORE_DEFAULT } from './obiettiviFissatoreDefault'

const DEFAULT_DI_PROVA: ObiettiviDefault = {
    risposta: { valore: 40, fonte: 'miglior_mese' },
    fissaggioTotale: { valore: 9, fonte: 'piano' },
    fissaggioRisposti: { valore: null, fonte: 'miglior_mese' },
    restituzione: { valore: 55, fonte: 'miglior_mese' },
}

test('il default copre tutti e quattro gli obiettivi', () => {
    assert.deepEqual(Object.keys(OBIETTIVI_FISSATORE_DEFAULT).sort(), [...CHIAVI_OBIETTIVI].sort())
})

test('senza niente di salvato vince il default, con la sua fonte', () => {
    const r = risolviObiettivi({}, DEFAULT_DI_PROVA)
    assert.deepEqual(r.risposta, { valore: 40, fonte: 'miglior_mese' })
    assert.deepEqual(r.fissaggioTotale, { valore: 9, fonte: 'piano' })
})

test('il valore scritto dall\'admin vince sempre sul default', () => {
    const r = risolviObiettivi({ risposta: 35, fissaggioTotale: 12 }, DEFAULT_DI_PROVA)
    assert.deepEqual(r.risposta, { valore: 35, fonte: 'admin' })
    assert.deepEqual(r.fissaggioTotale, { valore: 12, fonte: 'admin' })
    // non toccati: restano al default
    assert.deepEqual(r.restituzione, { valore: 55, fonte: 'miglior_mese' })
})

test('anche uno zero scritto dall\'admin vince', () => {
    const r = risolviObiettivi({ restituzione: 0 }, DEFAULT_DI_PROVA)
    assert.deepEqual(r.restituzione, { valore: 0, fonte: 'admin' })
})

test('default senza numero e niente di salvato: da impostare', () => {
    const r = risolviObiettivi({}, DEFAULT_DI_PROVA)
    assert.deepEqual(r.fissaggioRisposti, { valore: null, fonte: null })
})

test('leggiObiettiviSalvati: JSON rotto o assente = niente di salvato', () => {
    assert.deepEqual(leggiObiettiviSalvati(undefined), {})
    assert.deepEqual(leggiObiettiviSalvati('non json'), {})
    assert.deepEqual(leggiObiettiviSalvati('[1,2]'), {})
})

test('leggiObiettiviSalvati: tiene solo numeri validi delle chiavi note', () => {
    assert.deepEqual(
        leggiObiettiviSalvati(JSON.stringify({ risposta: 30, fissaggioTotale: 'x', altro: 5, restituzione: null, fissaggioRisposti: 120 })),
        { risposta: 30 },
    )
})

test('validaObiettivi: vuoto = torna al default, numeri con virgola, fuori 0-100 rifiutato', () => {
    const ok = validaObiettivi({ risposta: '42,5', fissaggioTotale: '', fissaggioRisposti: ' 20 ', restituzione: '60' })
    assert.deepEqual(ok, { ok: true, valori: { risposta: 42.5, fissaggioRisposti: 20, restituzione: 60 } })
    const ko = validaObiettivi({ risposta: '101', fissaggioTotale: '', fissaggioRisposti: '', restituzione: '' })
    assert.equal(ko.ok, false)
    const ko2 = validaObiettivi({ risposta: 'abc', fissaggioTotale: '', fissaggioRisposti: '', restituzione: '' })
    assert.equal(ko2.ok, false)
})
