import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    leggiObiettiviSalvati, risolviObiettivi, validaObiettivi, obiettivoInProporzione, testoFonte,
    CHIAVI_OBIETTIVI, type ObiettiviDefault,
} from './obiettiviFissatore'
import { OBIETTIVI_FISSATORE_DEFAULT } from './obiettiviFissatoreDefault'

const DEFAULT_DI_PROVA: ObiettiviDefault = {
    appuntamenti: { valore: 457, fonte: 'piano', dettaglio: '§8.2' },
    risposta: { valore: 40, fonte: 'miglior_mese' },
    fissaggioTotale: { valore: 9, fonte: 'base_piano' },
    fissaggioRisposti: { valore: null, fonte: 'miglior_mese' },
    restituzione: { valore: 55, fonte: 'miglior_mese', dettaglio: 'agosto' },
}

const vuoto = { appuntamenti: '', risposta: '', fissaggioTotale: '', fissaggioRisposti: '', restituzione: '' }

test('il default copre tutti gli obiettivi', () => {
    assert.deepEqual(Object.keys(OBIETTIVI_FISSATORE_DEFAULT).sort(), [...CHIAVI_OBIETTIVI].sort())
})

test('i default decisi dal PO il 28/10/2026', () => {
    const d = OBIETTIVI_FISSATORE_DEFAULT
    assert.deepEqual(d.appuntamenti, { valore: 457, fonte: 'piano', dettaglio: '§8.2' })
    assert.deepEqual(d.risposta, { valore: 61.6, fonte: 'base_piano' })
    assert.deepEqual(d.fissaggioTotale, { valore: 10, fonte: 'base_piano' })
    assert.deepEqual(d.fissaggioRisposti, { valore: 16.3, fonte: 'base_piano' })
    assert.deepEqual(d.restituzione, { valore: 64.6, fonte: 'miglior_mese', dettaglio: 'agosto' })
})

test('senza niente di salvato vince il default, con la sua fonte', () => {
    const r = risolviObiettivi({}, DEFAULT_DI_PROVA)
    assert.deepEqual(r.risposta, { valore: 40, fonte: 'miglior_mese' })
    assert.deepEqual(r.fissaggioTotale, { valore: 9, fonte: 'base_piano' })
    assert.deepEqual(r.restituzione, { valore: 55, fonte: 'miglior_mese', dettaglio: 'agosto' })
})

test('il valore scritto dall\'admin vince sempre sul default', () => {
    const r = risolviObiettivi({ risposta: 35, fissaggioTotale: 12, appuntamenti: 500 }, DEFAULT_DI_PROVA)
    assert.deepEqual(r.risposta, { valore: 35, fonte: 'admin' })
    assert.deepEqual(r.fissaggioTotale, { valore: 12, fonte: 'admin' })
    assert.deepEqual(r.appuntamenti, { valore: 500, fonte: 'admin' })
    // non toccati: restano al default
    assert.deepEqual(r.restituzione, { valore: 55, fonte: 'miglior_mese', dettaglio: 'agosto' })
})

test('anche uno zero scritto dall\'admin vince', () => {
    const r = risolviObiettivi({ restituzione: 0 }, DEFAULT_DI_PROVA)
    assert.deepEqual(r.restituzione, { valore: 0, fonte: 'admin' })
})

test('default senza numero e niente di salvato: da impostare', () => {
    const r = risolviObiettivi({}, DEFAULT_DI_PROVA)
    assert.deepEqual(r.fissaggioRisposti, { valore: null, fonte: null })
})

test('testoFonte: etichetta più dettaglio', () => {
    assert.equal(testoFonte({ valore: 457, fonte: 'piano', dettaglio: '§8.2' }), 'dal piano (§8.2)')
    assert.equal(testoFonte({ valore: 61.6, fonte: 'base_piano' }), 'base del piano (1/8-14/9)')
    assert.equal(testoFonte({ valore: 64.6, fonte: 'miglior_mese', dettaglio: 'agosto' }), 'miglior mese del bot (agosto)')
    assert.equal(testoFonte({ valore: 3, fonte: 'admin' }), "scritto dall'admin")
})

test('leggiObiettiviSalvati: JSON rotto o assente = niente di salvato', () => {
    assert.deepEqual(leggiObiettiviSalvati(undefined), {})
    assert.deepEqual(leggiObiettiviSalvati('non json'), {})
    assert.deepEqual(leggiObiettiviSalvati('[1,2]'), {})
})

test('leggiObiettiviSalvati: tiene solo numeri validi delle chiavi note', () => {
    assert.deepEqual(
        leggiObiettiviSalvati(JSON.stringify({ risposta: 30, fissaggioTotale: 'x', altro: 5, restituzione: null, fissaggioRisposti: 120, appuntamenti: 600 })),
        { risposta: 30, appuntamenti: 600 },
    )
})

test('validaObiettivi: vuoto = torna al default, numeri con virgola, percentuali fuori 0-100 rifiutate', () => {
    const ok = validaObiettivi({ ...vuoto, risposta: '42,5', fissaggioRisposti: ' 20 ', restituzione: '60' })
    assert.deepEqual(ok, { ok: true, valori: { risposta: 42.5, fissaggioRisposti: 20, restituzione: 60 } })
    assert.equal(validaObiettivi({ ...vuoto, risposta: '101' }).ok, false)
    assert.equal(validaObiettivi({ ...vuoto, risposta: 'abc' }).ok, false)
})

test('validaObiettivi: gli appuntamenti sono un numero intero, anche sopra 100', () => {
    assert.deepEqual(validaObiettivi({ ...vuoto, appuntamenti: '480' }), { ok: true, valori: { appuntamenti: 480 } })
    assert.equal(validaObiettivi({ ...vuoto, appuntamenti: '12,5' }).ok, false)
    assert.equal(validaObiettivi({ ...vuoto, appuntamenti: '-1' }).ok, false)
})

// ------------------------------------------------------------- proporzione sui giorni

test('obiettivoInProporzione: mese in corso = obiettivo × giorni trascorsi ÷ giorni del mese', () => {
    // 28/10/2026 a Roma: 28 giorni su 31
    const r = obiettivoInProporzione(457, '2026-10', new Date('2026-10-28T17:00:00Z'))
    assert.equal(r.inCorso, true)
    assert.equal(r.giorniTrascorsi, 28)
    assert.equal(r.giorniMese, 31)
    assert.ok(Math.abs(r.valore - 457 * 28 / 31) < 1e-9)
})

test('obiettivoInProporzione: il giorno lo decide Roma, non UTC', () => {
    // 31/10 23:30 UTC è già 1/11 a Roma: novembre al primo giorno
    const r = obiettivoInProporzione(300, '2026-11', new Date('2026-10-31T23:30:00Z'))
    assert.equal(r.giorniTrascorsi, 1)
    assert.equal(r.giorniMese, 30)
    assert.equal(r.valore, 10)
})

test('obiettivoInProporzione: mese passato = obiettivo pieno', () => {
    const r = obiettivoInProporzione(457, '2026-09', new Date('2026-10-28T17:00:00Z'))
    assert.equal(r.inCorso, false)
    assert.equal(r.valore, 457)
    assert.equal(r.giorniTrascorsi, 30)
})
