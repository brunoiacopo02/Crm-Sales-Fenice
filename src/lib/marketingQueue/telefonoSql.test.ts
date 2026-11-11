import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { chiave10Sql, soloCifreSql, stessoNumeroSql } from './telefonoSql'

const dialect = new PgDialect()

/**
 * Fa con l'SQL generato cio' che farebbe Postgres con `regexp_replace(x, '<modello>', '', 'g')`:
 * prende il modello che parte DAVVERO e lo applica al numero.
 */
function cifreComePostgres(sqlGenerato: string, telefono: string): string {
    const m = /regexp_replace\(x, '([^']*)', '', 'g'\)/.exec(sqlGenerato)
    assert.ok(m, `regexp_replace non trovato in: ${sqlGenerato}`)
    return telefono.replace(new RegExp(m[1], 'g'), '')
}

test('a Postgres arriva \\D (non D): togli tutto cio\' che non e\' cifra', () => {
    const q = dialect.sqlToQuery(soloCifreSql(sql.raw('x')))
    assert.equal(q.sql, "regexp_replace(x, '\\D', '', 'g')")
    assert.deepEqual(q.params, [])
})

test('numero con spazi e trattini nel gestionale = stessa persona del lead in E.164', () => {
    const q = dialect.sqlToQuery(chiave10Sql(sql.raw('x'))).sql
    const gestionale = cifreComePostgres(q, '333 123-4567').slice(-10)
    const lead = cifreComePostgres(q, '+39 333 123 4567').slice(-10)
    assert.equal(gestionale, '3331234567')
    assert.equal(lead, '3331234567')
    assert.equal(cifreComePostgres(q, '+39-333-1234567').length >= 9, true)
})

test('stessoNumeroSql confronta le ultime 10 cifre dei due lati', () => {
    const q = dialect.sqlToQuery(stessoNumeroSql(sql.raw('pl.phone'), sql.raw('"leads"."phone"')))
    assert.equal(q.sql, `right(regexp_replace(pl.phone, '\\D', '', 'g'), 10) = right(regexp_replace("leads"."phone", '\\D', '', 'g'), 10)`)
})

test('databaseAlBot.ts: nessun \\D scritto con una barra sola dentro un template SQL', () => {
    // Nel sorgente TS un template deve contenere `'\\D'` (due barre) per mandare `'\D'` a
    // Postgres. Con una barra sola il JS la toglie: a Postgres arriva `'D'` e i numeri
    // con spazi o trattini non combaciano (cliente, appuntamento, richiamo, scarto, ultimo
    // contatto risultavano falsi: revisione 11/11/2026).
    const sorgente = readFileSync(join(__dirname, 'databaseAlBot.ts'), 'utf8')
    const modelli = sorgente.match(/'\\+D'/g) ?? []
    for (const m of modelli) assert.equal(m, "'\\\\D'", `modello sbagliato nel sorgente: ${m}`)
})
