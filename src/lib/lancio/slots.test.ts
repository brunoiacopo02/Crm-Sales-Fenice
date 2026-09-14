import { test } from 'node:test'
import assert from 'node:assert/strict'
import { declaredHoursFor, isFreeAt, mattinaSlots, pickRoundRobin, type VenditoreDayFacts } from './slots'

const D = '2026-10-06'
const k = (h: number) => `${D}@${h}`
const SERA = new Date('2026-10-05T22:30:00+02:00')
const HOURS = [9, 10, 11, 12, 13, 14]

function v(id: string, declared: number[], blocked: number[] = [], busy: number[] = []): VenditoreDayFacts {
    return {
        salesUserId: id, lastAssignedAt: null,
        declared: new Set(declared.map(k)), blocked: new Set(blocked.map(k)), busy: new Set(busy.map(k)),
    }
}

test('conta i venditori liberi per ora: dichiarato meno bloccato meno occupato', () => {
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [
        v('a', [9, 10, 11], [10], []),
        v('b', [9, 11], [], [11]),
    ] })
    assert.deepEqual(out.mattina, [
        { hour: 9, liberi: 2, venditoriLiberi: ['a', 'b'] },
        { hour: 10, liberi: 0, venditoriLiberi: [] },
        { hour: 11, liberi: 1, venditoriLiberi: ['a'] },
        { hour: 12, liberi: 0, venditoriLiberi: [] },
        { hour: 13, liberi: 0, venditoriLiberi: [] },
        { hour: 14, liberi: 0, venditoriLiberi: [] },
    ])
    assert.equal(out.mattinaEsaurita, false)
})

test('mattina esaurita quando nessuna ora ha un venditore libero', () => {
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [v('a', [], [], [])] })
    assert.equal(out.mattinaEsaurita, true)
    assert.ok(out.mattina.every(m => m.liberi === 0))
})

test('turno vuoto = mattina esaurita', () => {
    assert.equal(mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [] }).mattinaEsaurita, true)
})

test('le ore che cominciano entro un ora da now non si offrono', () => {
    const now = new Date('2026-10-06T08:30:00+02:00')
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now, venditori: [v('a', HOURS)] })
    assert.deepEqual(out.mattina.map(m => m.hour), [10, 11, 12, 13, 14])
    const tardi = mattinaSlots({ dateStr: D, hours: HOURS, now: new Date('2026-10-06T13:30:00+02:00'), venditori: [v('a', HOURS)] })
    assert.deepEqual(tardi.mattina.map(m => m.hour), [])
    assert.equal(tardi.mattinaEsaurita, true)
})

test('round robin: lastAssignedAt piu vecchio, null prima di tutti, tiebreak id', () => {
    const t1 = new Date('2026-10-05T21:00:00Z')
    const t2 = new Date('2026-10-05T22:00:00Z')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: t2 },
        { salesUserId: 'a', lastAssignedAt: t1 },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: t1 },
        { salesUserId: 'a', lastAssignedAt: null },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: null },
        { salesUserId: 'a', lastAssignedAt: null },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([]), null)
})

test('pickRoundRobin non muta l input', () => {
    const arr = [{ salesUserId: 'b', lastAssignedAt: null }, { salesUserId: 'a', lastAssignedAt: null }]
    pickRoundRobin(arr)
    assert.deepEqual(arr.map(x => x.salesUserId), ['b', 'a'])
})

test('un esente conta dichiarato su tutte le ore del turno, ma non se bloccato o occupato', () => {
    const esente = declaredHoursFor({ calendarExempt: true }, [], { dateStr: D, hours: HOURS })
    assert.deepEqual([...esente].sort(), HOURS.map(k).sort())

    const normale = declaredHoursFor({ calendarExempt: false }, [k(9)], { dateStr: D, hours: HOURS })
    assert.deepEqual([...normale], [k(9)])

    // Le ore gia' salvate da un esente non si perdono: unione, non sostituzione.
    const misto = declaredHoursFor({ calendarExempt: true }, [`${D}@21`], { dateStr: D, hours: HOURS })
    assert.equal(misto.has(`${D}@21`), true)
    assert.equal(misto.size, HOURS.length + 1)

    const v: VenditoreDayFacts = {
        salesUserId: 'e', lastAssignedAt: null,
        declared: esente, blocked: new Set([k(10)]), busy: new Set([k(11)]),
    }
    assert.equal(isFreeAt(v, k(9)), true)
    assert.equal(isFreeAt(v, k(10)), false)
    assert.equal(isFreeAt(v, k(11)), false)
})
