import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { leads } from '@/db/schema'
import {
    NESSUN_INIZIO, inizioPeriodo, leadConta, parseInizioAccount, rigaConta, sqlLeadConta, sqlRigaConta,
} from './inizioAccount'

const ID118 = 'id-118'
const inizio = parseInizioAccount(JSON.stringify({ [ID118]: '2026-10-27T13:00:00Z' }))

test('parse: legge la mappa e scarta le voci rotte', () => {
    const m = parseInizioAccount(JSON.stringify({ a: '2026-10-27T13:00:00Z', b: 'non una data', c: 5 }))
    assert.equal(m.size, 1)
    assert.equal(m.get('a')?.toISOString(), '2026-10-27T13:00:00.000Z')
    assert.equal(parseInizioAccount('{rotto').size, 0)
    assert.equal(parseInizioAccount(null).size, 0)
})

test('riga: prima della data non conta per l\'account ripartito, per gli altri sì', () => {
    assert.equal(rigaConta(inizio, ID118, '2026-10-17T10:00:00Z'), false)
    assert.equal(rigaConta(inizio, ID118, '2026-11-02T13:30:00Z'), true)
    assert.equal(rigaConta(inizio, ID118, null), false)
    assert.equal(rigaConta(inizio, 'id-105', '2026-10-17T10:00:00Z'), true)
    assert.equal(rigaConta(inizio, null, '2026-10-17T10:00:00Z'), true)
    assert.equal(rigaConta(NESSUN_INIZIO, ID118, '2026-10-17T10:00:00Z'), true)
})

test('lead: è del nuovo se preso in carico o fissato dalla data', () => {
    const vecchio = { assignedToId: ID118, assignedAt: new Date('2026-06-09'), appointmentCreatedAt: new Date('2026-10-17') }
    assert.equal(leadConta(inizio, vecchio), false)
    assert.equal(leadConta(inizio, { ...vecchio, appointmentCreatedAt: new Date('2026-11-03') }), true)
    assert.equal(leadConta(inizio, { ...vecchio, assignedAt: new Date('2026-11-03'), appointmentCreatedAt: null }), true)
    assert.equal(leadConta(inizio, { ...vecchio, assignedToId: 'id-105' }), true)
    assert.equal(leadConta(inizio, { assignedToId: null }), true)
})

test('periodo: parte dal più tardo fra inizio periodo e inizio account', () => {
    const ottobre = new Date('2026-10-01T00:00:00Z')
    assert.equal(inizioPeriodo(inizio, ID118, ottobre).toISOString(), '2026-10-27T13:00:00.000Z')
    assert.equal(inizioPeriodo(inizio, 'id-105', ottobre).toISOString(), ottobre.toISOString())
    const novembre = new Date('2026-11-01T00:00:00Z')
    assert.equal(inizioPeriodo(inizio, ID118, novembre).toISOString(), novembre.toISOString())
})

test('sql: nessun account ripartito = nessuna condizione; altrimenti una per account', () => {
    assert.equal(sqlRigaConta(NESSUN_INIZIO, leads.assignedToId, leads.createdAt), undefined)
    assert.equal(sqlLeadConta(NESSUN_INIZIO, leads), undefined)
    const dialect = new PgDialect()
    const riga = dialect.sqlToQuery(sqlRigaConta(inizio, leads.assignedToId, leads.createdAt)!)
    assert.match(riga.sql, /IS DISTINCT FROM/)
    assert.match(riga.sql, /::timestamptz/)
    assert.deepEqual(riga.params, [ID118, '2026-10-27T13:00:00.000Z'])
    const lead = dialect.sqlToQuery(sqlLeadConta(inizio, leads)!)
    assert.deepEqual(lead.params, [ID118, '2026-10-27T13:00:00.000Z', '2026-10-27T13:00:00.000Z'])
})
