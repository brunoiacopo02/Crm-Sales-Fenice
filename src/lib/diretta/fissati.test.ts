import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contaFissati, fissatoValido, soloValidi } from './fissati'
import { forzieriRaggiunti, destinatariForziere, pianoScalini } from '@/lib/economy/rules'
import { DEFAULT_TARGETS, stepReached } from './config'

// Lunedì 26/10/2026 è il primo giorno di ora solare: Roma = UTC+1.
const LUN = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00+01:00`)

test('fissato valido: solo se il lead è ancora in appuntamento', () => {
    assert.equal(fissatoValido('APPOINTMENT'), true)
    for (const s of ['IN_PROGRESS', 'REJECTED', 'NEW', 'ARCHIVIATO', null, undefined]) {
        assert.equal(fissatoValido(s), false, String(s))
    }
})

test('fissati: lead distinti nel periodo, per squadra e per persona', () => {
    const start = new Date('2026-10-26T12:30:00Z')
    const end = new Date('2026-10-26T19:00:00Z')
    const rows = [
        { userId: 'u1', leadId: 'A', createdAt: '2026-10-26T13:00:00Z' },
        { userId: 'u1', leadId: 'A', createdAt: '2026-10-26T14:00:00Z' },   // stesso lead, una volta
        { userId: 'u1', leadId: 'B', createdAt: new Date('2026-10-26T15:00:00Z') },
        { userId: 'u2', leadId: 'A', createdAt: '2026-10-26T16:00:00Z' },   // stesso lead di u1
        { userId: 'u2', leadId: 'C', createdAt: '2026-10-26T19:00:00Z' },   // fine esclusa
        { userId: null, leadId: 'D', createdAt: '2026-10-26T15:00:00Z' },
    ]
    const r = contaFissati(rows, start, end)
    assert.equal(r.totale, 2)
    assert.deepEqual(r.perUtente, { u1: 2, u2: 1 })
    // senza estremi: tutte le righe
    assert.deepEqual(contaFissati(rows), { totale: 3, perUtente: { u1: 2, u2: 2 } })
})

test('fissati nella finestra (ora di punta)', () => {
    const righe = [
        { userId: 'u1', leadId: 'a', createdAt: LUN('17:59') },
        { userId: 'u1', leadId: 'b', createdAt: LUN('18:00') },
        { userId: 'u1', leadId: 'b', createdAt: LUN('18:30') },
        { userId: 'u2', leadId: 'c', createdAt: LUN('18:59') },
        { userId: 'u2', leadId: 'd', createdAt: LUN('19:00') },
    ]
    assert.equal(contaFissati(righe).totale, 4)
    assert.equal(contaFissati(righe, LUN('18:00'), LUN('19:00')).totale, 2)
})

// "Fissa e togli" (revisione del 25/10): i callLog APPUNTAMENTO restano, ma il
// lead non è più in appuntamento e il fissato non conta più.
const fissaETogli = (n: number, stato: string) => Array.from({ length: n }, (_, i) => ({
    userId: 'u1', leadId: `L${i}`, createdAt: LUN('15:00'), stato,
}))

test('fissa e togli: dieci appuntamenti tolti non valgono nessun fissato', () => {
    const letti = fissaETogli(10, 'IN_PROGRESS')
    const validi = soloValidi(letti)
    assert.equal(validi.length, 0)
    const n = contaFissati(validi).totale
    assert.equal(n, 0)
    assert.equal(stepReached(n, DEFAULT_TARGETS.personale), 0)
    // nessuno scalino da accreditare
    assert.deepEqual(pianoScalini([], 'u1', '2026-10-26', n, DEFAULT_TARGETS.personale, [20, 60]).accredita, [])
})

test('fissa e togli: la squadra non sblocca forzieri con appuntamenti tolti', () => {
    const veri = Array.from({ length: 50 }, (_, i) => ({ userId: `u${i % 8}`, leadId: `V${i}`, createdAt: LUN('16:00'), stato: 'APPOINTMENT' }))
    const tolti = Array.from({ length: 20 }, (_, i) => ({ userId: 'u1', leadId: `T${i}`, createdAt: LUN('16:30'), stato: 'REJECTED' }))
    const conteggio = contaFissati(soloValidi([...veri, ...tolti]))
    assert.equal(conteggio.totale, 50)
    assert.deepEqual(forzieriRaggiunti(conteggio.totale, null, DEFAULT_TARGETS), [])
    // con i tolti sarebbero stati 70: primo e secondo forziere
    assert.deepEqual(forzieriRaggiunti(contaFissati([...veri, ...tolti]).totale, null, DEFAULT_TARGETS), ['giorno_1', 'giorno_2'])
})

test('forzieri e home contano allo stesso modo: un lead fissato da due persone vale uno per la squadra', () => {
    const righe = soloValidi([
        { userId: 'a', leadId: 'L1', createdAt: LUN('18:10'), stato: 'APPOINTMENT' },
        { userId: 'b', leadId: 'L1', createdAt: LUN('18:20'), stato: 'APPOINTMENT' },   // rifissato da un collega
        { userId: 'b', leadId: 'L2', createdAt: LUN('18:30'), stato: 'APPOINTMENT' },
    ])
    const c = contaFissati(righe)
    assert.equal(c.totale, 2)
    assert.deepEqual(c.perUtente, { a: 1, b: 2 })
    assert.deepEqual(destinatariForziere(c.perUtente, ['a', 'b', 'c'], 1), ['a', 'b'])
    assert.deepEqual(destinatariForziere(c.perUtente, ['a', 'b', 'c'], 2), ['b'])
    assert.deepEqual(destinatariForziere(c.perUtente, ['a', 'b', 'c'], 0), ['a', 'b', 'c'])
})
