import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impronta, lettereColonna, leggiFoglio, normalizzaIntestazione } from './intestazioni'

const INTESTAZIONE = ['GDO', 'NOME', 'NUMERO', 'STATO', 'DATA ULTIMO CAMBIO', 'DATA ULTIMO SPAM', 'SOFTWARE', 'SIM', 'TASSO DI RSP']

test('intestazioni: maiuscole, punti, spazi e accenti non contano', () => {
    assert.equal(normalizzaIntestazione(' Tasso di rsp. '), 'TASSO DI RSP')
    assert.equal(normalizzaIntestazione('TASSO  DI RSP'), 'TASSO DI RSP')
    assert.equal(normalizzaIntestazione('Data ultimo  cambio'), 'DATA ULTIMO CAMBIO')
    assert.equal(normalizzaIntestazione(null), '')
})

test('foglio: colonne trovate dall\'intestazione, non dalla posizione', () => {
    const spostato = ['NOME', 'TASSO DI RSP.', 'NUMERO', 'GDO', 'STATO']
    const r = leggiFoglio([spostato, ['ZORA', '', '3522286297', '1017', 'SOSPETTO']])
    assert.ok(r.ok)
    assert.equal(r.colonne.tasso, 1)
    assert.equal(r.colonne.gdo, 3)
    assert.deepEqual(r.righe, [{ riga: 2, interno: '1017', nome: 'ZORA', numero: '3522286297', stato: 'SOSPETTO', dataCambio: '' }])
})

test('foglio: righe vere del foglio, note a destra ignorate, righe vuote saltate, numero di riga del foglio', () => {
    const r = leggiFoglio([
        INTESTAZIONE,
        ['1020', 'CHRISTIAN', 'da ins', 'OK', '', '', '2', '5', '', '', 'SIM RIMASTE', '6'],
        [],
        ['', '', '', '', '', '', '', '', '', '', 'ATTIVE', '3'],
        ['1008', 'GIUSY', '/', 'VUOTO', '14/11/2026', '', '2', '2'],
        // Letto senza formattazione: i numeri arrivano come numeri.
        [1019, 'RICCARDINO', 3522496491],
    ])
    assert.ok(r.ok)
    assert.deepEqual(r.righe.map(x => [x.riga, x.interno, x.numero, x.dataCambio]), [
        [2, '1020', 'da ins', ''],
        [5, '1008', '/', '14/11/2026'],
        [6, '1019', '3522496491', ''],
    ])
})

test('foglio: senza le colonne indispensabili non si scrive nulla', () => {
    const r = leggiFoglio([['GDO', 'NOME', 'NUMERO']])
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.errore, /TASSO DI RSP/)
    const vuoto = leggiFoglio([])
    assert.equal(vuoto.ok, false)
})

test('foglio: senza la colonna NOME (serve all\'aggancio) il giro si ferma', () => {
    const r = leggiFoglio([['GDO', 'NUMERO', 'TASSO DI RSP'], ['1020', '35', '']])
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.errore, /"NOME"/)
})

test('foglio: è una riga solo se GDO è un interno di sole cifre (note e totali mai toccati)', () => {
    const r = leggiFoglio([
        INTESTAZIONE,
        ['1020', 'CHRISTIAN', 'da ins'],
        ['TOTALE', '', ''],
        ['1020 bis', 'X', ''],
        ['nota: ordinare SIM', '', ''],
        [' 1019 ', 'RICCARDINO', '35'],
    ])
    assert.ok(r.ok)
    assert.deepEqual(r.righe.map(x => [x.riga, x.interno]), [[2, '1020'], [6, '1019']])
})

test('impronta: cambia se cambiano intestazione o posizione degli interni, non se cambiano gli altri valori', () => {
    const base = [INTESTAZIONE, ['1020', 'CHRISTIAN', 'da ins'], ['1017', 'ZORA', '35']]
    const altroNumero = [INTESTAZIONE, ['1020', 'CHRISTIAN', '3500000000'], ['1017', 'ZORA', '35']]
    const scambiate = [INTESTAZIONE, ['1017', 'ZORA', '35'], ['1020', 'CHRISTIAN', 'da ins']]
    const rigaInserita = [INTESTAZIONE, [], ['1020', 'CHRISTIAN', 'da ins'], ['1017', 'ZORA', '35']]
    const colonnaSpostata = [['NOME', ...INTESTAZIONE.filter(h => h !== 'NOME')], ['CHRISTIAN', '1020'], ['ZORA', '1017']]
    assert.equal(impronta(base), impronta(altroNumero))
    assert.notEqual(impronta(base), impronta(scambiate))
    assert.notEqual(impronta(base), impronta(rigaInserita))
    assert.notEqual(impronta(base), impronta(colonnaSpostata))
})

test('foglio: colonna del tasso ripetuta = ambiguo, non si scrive', () => {
    const r = leggiFoglio([['GDO', 'NUMERO', 'TASSO DI RSP', 'Tasso di rsp.']])
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.errore, /due volte/)
})

test('lettere della colonna', () => {
    assert.equal(lettereColonna(0), 'A')
    assert.equal(lettereColonna(8), 'I')
    assert.equal(lettereColonna(25), 'Z')
    assert.equal(lettereColonna(26), 'AA')
})
