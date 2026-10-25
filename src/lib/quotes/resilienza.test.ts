import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colonnaMancante, creaFreno } from './resilienza'

test('colonna mancante: 42703 di pg, anche avvolto da drizzle in cause', () => {
    const pg = Object.assign(new Error('column dailyQuotes.technique does not exist'), { code: '42703' })
    assert.equal(colonnaMancante(pg), true)
    // DrizzleQueryError: messaggio "Failed query: ..." e l'errore di pg in cause
    const drizzle = Object.assign(new Error('Failed query: select ...'), { cause: pg })
    assert.equal(colonnaMancante(drizzle), true)
    // altri errori: tabella mancante, connessione, niente
    assert.equal(colonnaMancante(Object.assign(new Error('relation does not exist'), { code: '42P01' })), false)
    assert.equal(colonnaMancante(new Error('timeout')), false)
    assert.equal(colonnaMancante(null), false)
    assert.equal(colonnaMancante('42703'), false)
})

test('freno: dopo un errore niente letture per la pausa, poi si riprova', () => {
    let ora = 1_000
    const freno = creaFreno(5 * 60_000, () => ora)
    assert.equal(freno.fermo(), false)
    freno.segnaErrore()
    assert.equal(freno.fermo(), true)
    ora += 4 * 60_000
    assert.equal(freno.fermo(), true)
    ora += 60_000
    assert.equal(freno.fermo(), false)
    // un errore nuovo riparte da adesso
    freno.segnaErrore()
    ora += 60_000
    assert.equal(freno.fermo(), true)
})
