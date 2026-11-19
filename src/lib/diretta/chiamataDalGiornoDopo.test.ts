import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chiamataSuccessivaGiaVisibile, chiamataSuccessivaVisibileDa, visibiliNellaColonnaSuccessiva } from './chiamataDalGiornoDopo'

test('chiamata del pomeriggio: visibile dalle 10:00 di Roma del giorno dopo', () => {
    // 19/11/2026 15:30 Roma (+01:00) → 20/11 10:00 Roma = 09:00Z
    const da = chiamataSuccessivaVisibileDa(new Date('2026-11-19T14:30:00Z'))
    assert.equal(da.toISOString(), '2026-11-20T09:00:00.000Z')
})

test('stesso giorno: nascosta fino a sera, e anche la mattina dopo prima delle 10', () => {
    const chiamata = new Date('2026-11-19T14:30:00Z')
    assert.equal(chiamataSuccessivaGiaVisibile(chiamata, new Date('2026-11-19T14:31:00Z')), false)
    assert.equal(chiamataSuccessivaGiaVisibile(chiamata, new Date('2026-11-19T19:00:00Z')), false)
    assert.equal(chiamataSuccessivaGiaVisibile(chiamata, new Date('2026-11-20T08:59:59Z')), false)
    assert.equal(chiamataSuccessivaGiaVisibile(chiamata, new Date('2026-11-20T09:00:00Z')), true)
})

test('chiamata di ieri: oggi pomeriggio si vede', () => {
    assert.equal(chiamataSuccessivaGiaVisibile(new Date('2026-11-18T17:00:00Z'), new Date('2026-11-19T12:30:00Z')), true)
})

test('chiamata poco dopo mezzanotte di Roma: conta il giorno di Roma, non quello UTC', () => {
    // 19/11 00:30 Roma = 18/11 23:30Z → visibile dal 20/11 10:00 Roma
    const da = chiamataSuccessivaVisibileDa(new Date('2026-11-18T23:30:00Z'))
    assert.equal(da.toISOString(), '2026-11-20T09:00:00.000Z')
})

test('cambio d\'ora: le 10:00 restano le 10:00 di Roma', () => {
    // sab 24/10/2026 (+02:00) → dom 25/10 10:00 è già +01:00 = 09:00Z
    assert.equal(chiamataSuccessivaVisibileDa(new Date('2026-10-24T15:00:00Z')).toISOString(), '2026-10-25T09:00:00.000Z')
    // sab 28/03/2026 (+01:00) → dom 29/03 10:00 è già +02:00 = 08:00Z
    assert.equal(chiamataSuccessivaVisibileDa(new Date('2026-03-28T15:00:00Z')).toISOString(), '2026-03-29T08:00:00.000Z')
})

test('estate: 10:00 di Roma a +02:00', () => {
    assert.equal(chiamataSuccessivaVisibileDa(new Date('2026-07-10T15:00:00Z')).toISOString(), '2026-07-11T08:00:00.000Z')
})

test('senza data o con data illeggibile si mostra', () => {
    const adesso = new Date('2026-11-19T14:00:00Z')
    assert.equal(chiamataSuccessivaGiaVisibile(null, adesso), true)
    assert.equal(chiamataSuccessivaGiaVisibile(undefined, adesso), true)
    assert.equal(chiamataSuccessivaGiaVisibile('non una data', adesso), true)
})

test('accetta anche la data come stringa ISO', () => {
    assert.equal(chiamataSuccessivaGiaVisibile('2026-11-19T14:30:00Z', new Date('2026-11-19T18:00:00Z')), false)
})

const colonna = [
    { id: 'oggi', lastCallDate: new Date('2026-11-19T14:30:00Z') },
    { id: 'ieri', lastCallDate: new Date('2026-11-18T17:00:00Z') },
    { id: 'mai', lastCallDate: null },
]

test('colonna successiva (2ª, 3ª, 4ª): al GDO restano fuori i lead chiamati oggi', () => {
    const adesso = new Date('2026-11-19T15:00:00Z')
    assert.deepEqual(visibiliNellaColonnaSuccessiva(colonna, { isGdo: true, adesso }).map(l => l.id), ['ieri', 'mai'])
})

test('colonna successiva: dalle 10:00 del giorno dopo il GDO li vede tutti, nello stesso ordine', () => {
    const adesso = new Date('2026-11-20T09:00:00Z')
    assert.deepEqual(visibiliNellaColonnaSuccessiva(colonna, { isGdo: true, adesso }).map(l => l.id), ['oggi', 'ieri', 'mai'])
})

test('colonna successiva: admin e manager vedono sempre tutto', () => {
    const adesso = new Date('2026-11-19T15:00:00Z')
    assert.deepEqual(visibiliNellaColonnaSuccessiva(colonna, { isGdo: false, adesso }).map(l => l.id), ['oggi', 'ieri', 'mai'])
})
