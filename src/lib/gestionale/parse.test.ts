import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eurToCents, parseSnapshot, SnapshotParseError } from './parse'

const sample = () => JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'snapshot.sample.json'), 'utf8'))

test('eurToCents: formati validi', () => {
    assert.equal(eurToCents('1250.00', 'x'), 125000)
    assert.equal(eurToCents('-50.00', 'x'), -5000)
    assert.equal(eurToCents('1250.5', 'x'), 125050)
    assert.equal(eurToCents('1250', 'x'), 125000)
    assert.equal(eurToCents('0.07', 'x'), 7)
    assert.equal(eurToCents('130.33', 'x'), 13033)
})

test('eurToCents: formati rifiutati con il path', () => {
    for (const bad of ['1.250,00', '', null, undefined, 12.5, '12.345', 'abc']) {
        assert.throws(() => eurToCents(bad, 'contratti[0].importo_totale'),
            (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[0].importo_totale')
    }
})

test('parseSnapshot: fixture appiattita in righe', () => {
    const s = parseSnapshot(sample())
    assert.equal(s.generatoIl, '2026-10-02T18:00:00+02:00')
    assert.equal(s.contratti.length, 2)
    assert.equal(s.rate.length, 3)
    assert.equal(s.incassi.length, 3)
    assert.equal(s.commissioni.length, 2)
    const c1 = s.contratti.find(c => c.id === 'c1')!
    assert.equal(c1.importoTotaleCents, 318000)
    assert.equal(c1.clienteTelefono, '+393331234567')
    assert.equal(c1.venditoreCode, 'Sales 002')
    assert.equal(s.rate.find(r => r.id === 'r2')!.contrattoId, 'c1')
    const storno = s.incassi.find(i => i.id === 'i3')!
    assert.equal(storno.importoCents, -50000)
    assert.equal(storno.stornoDi, 'i2')
    assert.equal(storno.contrattoId, 'c2')
    assert.deepEqual(s.commissioni[0], { venditoreCode: 'Sales 002', mese: '2026-09', totaleIncassatoCents: 159000, commissioneLordaCents: 15900, commissioneImponibileCents: 13033 })
})

test('parseSnapshot: telefono assente, N/A o vuoto diventa null', () => {
    for (const tel of [null, 'N/A', '', '  ']) {
        const j = sample(); j.contratti[0].cliente.telefono = tel
        assert.equal(parseSnapshot(j).contratti[0].clienteTelefono, null)
    }
    const j = sample(); j.contratti[0].cliente.telefono = '393331234567'
    assert.equal(parseSnapshot(j).contratti[0].clienteTelefono, '+393331234567')
})

test('parseSnapshot: record malformato fa fallire tutto e nomina id e campo', () => {
    const j = sample(); delete j.contratti[1].incassi[0].id
    assert.throws(() => parseSnapshot(j), (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[1].incassi[0].id')
    const k = sample(); k.commissioni[0].mese = 'settembre'
    assert.throws(() => parseSnapshot(k), (e: unknown) => e instanceof SnapshotParseError && e.path === 'commissioni[0].mese')
    assert.throws(() => parseSnapshot({ contratti: 'x' }), SnapshotParseError)
    assert.throws(() => parseSnapshot(null), SnapshotParseError)
})

test('parseSnapshot: id duplicati sono un errore', () => {
    const j = sample(); j.contratti[1].id = 'c1'
    assert.throws(() => parseSnapshot(j), (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[1].id')
})

test('parseSnapshot: conta_commissione mancante vale false, venditore viene trimmato', () => {
    const j = sample(); delete j.contratti[0].incassi[0].conta_commissione; j.contratti[0].venditore = ' Sales 002 '
    const s = parseSnapshot(j)
    assert.equal(s.incassi[0].contaCommissione, false)
    assert.equal(s.contratti[0].venditoreCode, 'Sales 002')
})

test('parseSnapshot: blocco commissioni mancante è un errore', () => {
    const j = sample(); delete j.commissioni
    assert.throws(() => parseSnapshot(j), (e: unknown) => e instanceof SnapshotParseError && e.path === 'commissioni')
})
