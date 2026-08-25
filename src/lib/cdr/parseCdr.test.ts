import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCdrLine, dstKeyOf } from './parseCdr'

const base = {
    calldate: '2026-08-22 16:20:03', clid: '"1007" <1007>', src: '1007',
    dst: '3397605227', dcontext: 'from-internal', duration: '87', billsec: '62',
    disposition: 'ANSWERED', uniqueid: '1787408446.87752',
}

test('riconosce una chiamata in uscita da un interno', () => {
    const r = parseCdrLine(base as any)!
    assert.equal(r.id, '1787408446.87752')
    assert.equal(r.src, '1007')
    assert.equal(r.direction, 'out')
    assert.equal(r.dstKey, '3397605227')
    assert.equal(r.duration, 87)
    assert.equal(r.billsec, 62)
    assert.equal(r.dateLocal, '2026-08-22')
})

test('riconosce una chiamata in entrata verso un interno', () => {
    const r = parseCdrLine({ ...base, src: '393889341296', dst: '1010' } as any)!
    assert.equal(r.direction, 'in')
})

test('scarta le righe senza uniqueid', () => {
    assert.equal(parseCdrLine({ ...base, uniqueid: '' } as any), null)
})

test('scarta le righe interno-a-interno', () => {
    assert.equal(parseCdrLine({ ...base, src: '1007', dst: '1010' } as any), null)
})

test('dstKey prende le ultime 10 cifre e ignora prefissi e simboli', () => {
    assert.equal(dstKeyOf('+39 339 760 5227'), '3397605227')
    assert.equal(dstKeyOf('393397605227'), '3397605227')
    assert.equal(dstKeyOf('123'), null)
})

test('duration e billsec mancanti diventano zero', () => {
    const r = parseCdrLine({ ...base, duration: '', billsec: '' } as any)!
    assert.equal(r.duration, 0)
    assert.equal(r.billsec, 0)
})

test('interpreta l orario come italiano in ora legale (CEST, +2)', () => {
    const r = parseCdrLine({ ...base, calldate: '2026-08-22 16:20:03' } as any)!
    assert.equal(r.calldate.toISOString(), '2026-08-22T14:20:03.000Z')
    assert.equal(r.dateLocal, '2026-08-22')
})

test('interpreta l orario come italiano anche in ora solare (CET, +1)', () => {
    const r = parseCdrLine({ ...base, calldate: '2026-01-15 10:00:00' } as any)!
    assert.equal(r.calldate.toISOString(), '2026-01-15T09:00:00.000Z')
    assert.equal(r.dateLocal, '2026-01-15')
})
