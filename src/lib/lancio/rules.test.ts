import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAt, hourKey, sameInstant, slotDateKind } from './rules'

// La sera del webinar, dopo il pitch.
const SERA = new Date('2026-10-05T22:30:00+02:00')

test('9-14 del 6/10 sono mattina venditori', () => {
    const r = classifyAt(new Date('2026-10-06T09:00:00+02:00'), SERA)
    assert.deepEqual(r, { ok: true, kind: 'mattina', dateStr: '2026-10-06', hour: 9 })
    const r14 = classifyAt(new Date('2026-10-06T14:00:00+02:00'), SERA)
    assert.equal(r14.ok && r14.kind, 'mattina')
})

test('15-20 del 6/10 sono pomeriggio Conferme', () => {
    const r = classifyAt(new Date('2026-10-06T15:00:00+02:00'), SERA)
    assert.equal(r.ok && r.kind, 'pomeriggio')
    assert.equal(classifyAt(new Date('2026-10-06T20:00:00+02:00'), SERA).ok, true)
})

test('9-14 del 7/10 sono dopodomani, il pomeriggio del 7 no', () => {
    const r7 = classifyAt(new Date('2026-10-07T10:00:00+02:00'), SERA)
    assert.equal(r7.ok && r7.kind, 'dopodomani')
    assert.deepEqual(classifyAt(new Date('2026-10-07T15:00:00+02:00'), SERA), { ok: false, motivo: 'fuori_regole' })
})

test('fuori regole: ora non tonda, 21 del 6, 8 del 6, altro giorno, data non valida', () => {
    for (const iso of ['2026-10-06T09:30:00+02:00', '2026-10-06T21:00:00+02:00', '2026-10-06T08:00:00+02:00', '2026-10-08T10:00:00+02:00']) {
        assert.deepEqual(classifyAt(new Date(iso), SERA), { ok: false, motivo: 'fuori_regole' }, iso)
    }
    assert.deepEqual(classifyAt(new Date('non-una-data'), SERA), { ok: false, motivo: 'fuori_regole' })
})

test('at deve stare almeno un ora dopo now', () => {
    const now = new Date('2026-10-06T08:30:00+02:00')
    assert.deepEqual(classifyAt(new Date('2026-10-06T09:00:00+02:00'), now), { ok: false, motivo: 'fuori_regole' })
    assert.equal(classifyAt(new Date('2026-10-06T10:00:00+02:00'), now).ok, true)
    // Esattamente un'ora dopo è ammesso.
    assert.equal(classifyAt(new Date('2026-10-06T09:30:00+02:00'), new Date('2026-10-06T08:30:00+02:00')).ok, false) // non tonda
    assert.equal(classifyAt(new Date('2026-10-06T10:00:00+02:00'), new Date('2026-10-06T09:00:00+02:00')).ok, true)
})

test('hourKey ha la stessa forma di slotKey', () => {
    assert.equal(hourKey('2026-10-06', 9), '2026-10-06@9')
})

test('sameInstant tollera 60 secondi', () => {
    const a = new Date('2026-10-06T09:00:00+02:00')
    assert.equal(sameInstant(a, new Date('2026-10-06T09:00:30+02:00')), true)
    assert.equal(sameInstant(a, new Date('2026-10-06T09:02:00+02:00')), false)
    assert.equal(sameInstant(null, a), false)
})

test('slotDateKind riconosce solo le due date del lancio', () => {
    assert.equal(slotDateKind('2026-10-06'), 'giornoDopo')
    assert.equal(slotDateKind('2026-10-07'), 'dopodomani')
    assert.equal(slotDateKind('2026-10-08'), null)
    assert.equal(slotDateKind('06/10/2026'), null)
})
