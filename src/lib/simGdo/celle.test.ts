import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLORI_CELLA, richiesteScrittura } from './celle'

test('scrittura: una richiesta per riga, solo nella colonna del tasso, valore + sfondo + formato', () => {
    const req = richiesteScrittura({
        sheetId: 7,
        colonnaTasso: 8,
        righe: [
            { riga: 2, tasso: 0.4, colore: 'verde' },
            { riga: 5, tasso: null, colore: null },
        ],
    })
    assert.equal(req.length, 2)
    const [a, b] = req
    assert.deepEqual(a.updateCells.range, { sheetId: 7, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 8, endColumnIndex: 9 })
    assert.equal(a.updateCells.fields, 'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.numberFormat')
    const cellaA = a.updateCells.rows[0].values[0]
    assert.deepEqual(cellaA.userEnteredValue, { numberValue: 0.4 })
    assert.deepEqual(cellaA.userEnteredFormat?.backgroundColor, COLORI_CELLA.verde)
    assert.deepEqual(cellaA.userEnteredFormat?.numberFormat, { type: 'PERCENT', pattern: '0.0%' })

    // cella vuota senza colore: valore e sfondo assenti con i campi nella maschera = cancellati
    assert.deepEqual(b.updateCells.range, { sheetId: 7, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 9 })
    const cellaB = b.updateCells.rows[0].values[0]
    assert.equal(cellaB.userEnteredValue, undefined)
    assert.equal(cellaB.userEnteredFormat?.backgroundColor, undefined)
})

test('colori: grigio, rosso e verde chiaro distinti', () => {
    const s = new Set(Object.values(COLORI_CELLA).map(c => JSON.stringify(c)))
    assert.equal(s.size, 3)
    for (const c of Object.values(COLORI_CELLA)) {
        for (const v of [c.red, c.green, c.blue]) assert.ok(v >= 0 && v <= 1)
    }
})
