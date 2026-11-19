import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secondaGiaVisibile, secondaVisibileDa } from './secondaDalGiornoDopo'

test('chiamata del pomeriggio: visibile dalle 10:00 di Roma del giorno dopo', () => {
    // 19/11/2026 15:30 Roma (+01:00) → 20/11 10:00 Roma = 09:00Z
    const da = secondaVisibileDa(new Date('2026-11-19T14:30:00Z'))
    assert.equal(da.toISOString(), '2026-11-20T09:00:00.000Z')
})

test('stesso giorno: nascosta fino a sera, e anche la mattina dopo prima delle 10', () => {
    const chiamata = new Date('2026-11-19T14:30:00Z')
    assert.equal(secondaGiaVisibile(chiamata, new Date('2026-11-19T14:31:00Z')), false)
    assert.equal(secondaGiaVisibile(chiamata, new Date('2026-11-19T19:00:00Z')), false)
    assert.equal(secondaGiaVisibile(chiamata, new Date('2026-11-20T08:59:59Z')), false)
    assert.equal(secondaGiaVisibile(chiamata, new Date('2026-11-20T09:00:00Z')), true)
})

test('chiamata di ieri: oggi pomeriggio si vede', () => {
    assert.equal(secondaGiaVisibile(new Date('2026-11-18T17:00:00Z'), new Date('2026-11-19T12:30:00Z')), true)
})

test('chiamata poco dopo mezzanotte di Roma: conta il giorno di Roma, non quello UTC', () => {
    // 19/11 00:30 Roma = 18/11 23:30Z → visibile dal 20/11 10:00 Roma
    const da = secondaVisibileDa(new Date('2026-11-18T23:30:00Z'))
    assert.equal(da.toISOString(), '2026-11-20T09:00:00.000Z')
})

test('cambio d\'ora: le 10:00 restano le 10:00 di Roma', () => {
    // sab 24/10/2026 (+02:00) → dom 25/10 10:00 è già +01:00 = 09:00Z
    assert.equal(secondaVisibileDa(new Date('2026-10-24T15:00:00Z')).toISOString(), '2026-10-25T09:00:00.000Z')
    // sab 28/03/2026 (+01:00) → dom 29/03 10:00 è già +02:00 = 08:00Z
    assert.equal(secondaVisibileDa(new Date('2026-03-28T15:00:00Z')).toISOString(), '2026-03-29T08:00:00.000Z')
})

test('estate: 10:00 di Roma a +02:00', () => {
    assert.equal(secondaVisibileDa(new Date('2026-07-10T15:00:00Z')).toISOString(), '2026-07-11T08:00:00.000Z')
})

test('senza data o con data illeggibile si mostra', () => {
    const adesso = new Date('2026-11-19T14:00:00Z')
    assert.equal(secondaGiaVisibile(null, adesso), true)
    assert.equal(secondaGiaVisibile(undefined, adesso), true)
    assert.equal(secondaGiaVisibile('non una data', adesso), true)
})

test('accetta anche la data come stringa ISO', () => {
    assert.equal(secondaGiaVisibile('2026-11-19T14:30:00Z', new Date('2026-11-19T18:00:00Z')), false)
})
