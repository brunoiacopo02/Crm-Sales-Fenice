import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthsFrom, pickMonth, sellerMonthSummary, cashTotalCents, commissionableSumCents, classifyAtRisk, effectiveRunStatus, type AtRiskContract } from './metrics'

test('monthsFrom: dal corrente al primo, scavalla l anno', () => {
    assert.deepEqual(monthsFrom('2026-09', '2027-01'), ['2027-01', '2026-12', '2026-11', '2026-10', '2026-09'])
    assert.deepEqual(monthsFrom('2026-09', '2026-09'), ['2026-09'])
})

test('pickMonth: valido, fuori range, spazzatura', () => {
    assert.equal(pickMonth('2026-09', '2026-10'), '2026-09')
    assert.equal(pickMonth('2026-08', '2026-10'), '2026-10')
    assert.equal(pickMonth('2026-11', '2026-10'), '2026-10')
    assert.equal(pickMonth('<script>', '2026-10'), '2026-10')
    assert.equal(pickMonth(undefined, '2026-10'), '2026-10')
})

test('sellerMonthSummary: netto = imponibile meno multe', () => {
    const s = sellerMonthSummary({ totaleIncassatoCents: 1_000_000, commissioneLordaCents: 100_000, commissioneImponibileCents: 81_967 }, 30)
    assert.deepEqual(s, { incassatoCents: 1_000_000, lordaCents: 100_000, imponibileCents: 81_967, multeCents: 3000, nettoCents: 78_967, hasCommissionRow: true })
})

test('sellerMonthSummary: senza riga commissioni è zero esplicito, multe restano', () => {
    const s = sellerMonthSummary(undefined, 10)
    assert.equal(s.hasCommissionRow, false)
    assert.equal(s.imponibileCents, 0)
    assert.equal(s.nettoCents, -1000)
})

test('cashTotalCents: somma tutti gli incassi del mese, storni negativi compresi', () => {
    const rows = [
        { data: '2026-09-05', importoCents: 159000 },
        { data: '2026-09-12', importoCents: 50000 },   // originale poi stornato
        { data: '2026-09-20', importoCents: -50000 },  // storno
        { data: '2026-10-01', importoCents: 99900 },
        { data: null, importoCents: 12345 },
    ]
    assert.equal(cashTotalCents(rows, '2026-09'), 159000)
    assert.equal(cashTotalCents(rows, '2026-10'), 99900)
})

test('commissionableSumCents: solo conta_commissione', () => {
    assert.equal(commissionableSumCents([{ contaCommissione: true, importoCents: 100 }, { contaCommissione: false, importoCents: 50 }]), 100)
})

const c = (id: string, statoPagamento: string | null): AtRiskContract => ({ id, clienteNome: 'N', clienteCognome: 'C', clienteTelefono: null, venditoreCode: 'Sales 002', salesUserId: 'u2', statoPagamento, dataFirma: '2026-09-01' })

test('classifyAtRisk: stati a rischio o rate scadute, ordinati per gravità poi scaduto', () => {
    const rows = classifyAtRisk(
        [c('ok', 'Pagato'), c('sol', 'Sollecito'), c('avv', 'Avvocato'), c('solo-rata', 'Pagamento programmato'), c('sol2', 'Sollecito')],
        [
            { contrattoId: 'solo-rata', scadenza: '2026-09-10', importoCents: 1000, stato: 'scaduta' },
            { contrattoId: 'solo-rata', scadenza: '2026-10-10', importoCents: 1000, stato: 'da_pagare' },
            { contrattoId: 'sol', scadenza: '2026-09-01', importoCents: 500, stato: 'scaduta' },
            { contrattoId: 'sol2', scadenza: '2026-09-02', importoCents: 900, stato: 'scaduta' },
            { contrattoId: 'ok', scadenza: '2026-09-01', importoCents: 700, stato: 'pagata' },
        ],
        '2026-10-02',
    )
    assert.deepEqual(rows.map(r => r.id), ['avv', 'sol2', 'sol', 'solo-rata'])
    const sr = rows.find(r => r.id === 'solo-rata')!
    assert.equal(sr.rateScadute, 1)
    assert.equal(sr.scadutoCents, 1000)
    assert.equal(sr.residuoCents, 2000)
    assert.equal(sr.giorniDallaPiuVecchia, 22)
    assert.equal(rows.find(r => r.id === 'avv')!.giorniDallaPiuVecchia, null)
})

test('effectiveRunStatus: running oltre 10 minuti diventa errore', () => {
    const now = new Date('2026-10-02T10:00:00Z')
    assert.deepEqual(effectiveRunStatus({ status: 'running', startedAt: new Date('2026-10-02T09:49:00Z'), error: null }, now), { status: 'error', error: 'aggiornamento interrotto' })
    assert.deepEqual(effectiveRunStatus({ status: 'running', startedAt: new Date('2026-10-02T09:55:00Z'), error: null }, now), { status: 'running', error: null })
    assert.deepEqual(effectiveRunStatus({ status: 'ok', startedAt: new Date('2026-10-02T08:00:00Z'), error: null }, now), { status: 'ok', error: null })
})
