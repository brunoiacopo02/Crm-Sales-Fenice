import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSlots } from './botGuard'

const SERA = new Date('2026-10-05T21:30:00+02:00')

// Il ramo `dopodomani` e quello della data fuori regole non leggono il DB:
// sono decisioni pure sulla data, e la loro forma e' il contratto che il bot
// legge (B4). La mattina del 6/10 passa dal DB ed e' coperta dai test di
// mattinaSlots (slots.test.ts).

test('il 7/10 e la mattina delle Conferme: nessuna ora, nessun pomeriggio', async () => {
    const r = await computeSlots('2026-10-07', SERA)
    assert.deepEqual(r, {
        date: '2026-10-07',
        mattina: 'conferme',
        pomeriggio: { aperto: false, ore: [] },
        mattinaEsaurita: false,
        oreAmmesse: [9, 10, 11, 12, 13, 14],
    })
})

test('una data qualsiasi esce null: il chiamante risponde 422', async () => {
    assert.equal(await computeSlots('2026-10-09', SERA), null)
    assert.equal(await computeSlots('2026-10-05', SERA), null)
    assert.equal(await computeSlots('non-una-data', SERA), null)
})

test('anche il 7/10 non offre ore gia passate o entro l ora', async () => {
    // Mezzogiorno del 7/10: 9-12 sono passate o troppo vicine, restano 13 e 14.
    const r = await computeSlots('2026-10-07', new Date('2026-10-07T12:00:00+02:00'))
    assert.deepEqual(r?.oreAmmesse, [13, 14])
    // A giornata finita non resta niente da proporre.
    const tardi = await computeSlots('2026-10-07', new Date('2026-10-07T18:00:00+02:00'))
    assert.deepEqual(tardi?.oreAmmesse, [])
})

test('oreAmmesse del 7/10 e una copia: modificarla non tocca la config', async () => {
    const r = await computeSlots('2026-10-07', SERA)
    assert.ok(r)
    r.oreAmmesse.push(99)
    const r2 = await computeSlots('2026-10-07', SERA)
    assert.deepEqual(r2?.oreAmmesse, [9, 10, 11, 12, 13, 14])
})
