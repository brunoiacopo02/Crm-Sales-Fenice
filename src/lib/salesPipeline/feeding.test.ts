import test from 'node:test'
import assert from 'node:assert/strict'
import { pickMostLoadedGdo, shouldDivertFreshLead } from './feeding'

test('i GDO escono dal piu carico al meno carico', () => {
    assert.deepEqual(
        pickMostLoadedGdo([
            { gdoId: 'a', nuovi: 12 },
            { gdoId: 'b', nuovi: 40 },
            { gdoId: 'c', nuovi: 31 },
        ]),
        ['b', 'c', 'a'],
    )
})

test('a parita di carico l ordine e stabile sull id', () => {
    assert.deepEqual(
        pickMostLoadedGdo([{ gdoId: 'z', nuovi: 5 }, { gdoId: 'a', nuovi: 5 }]),
        ['a', 'z'],
    )
})

test('nessun GDO: lista vuota, non un errore', () => {
    assert.deepEqual(pickMostLoadedGdo([]), [])
})

const cfgOn = { enabled: true, salesUserId: 'marco', freshCap: 5 }

test('lead fresco sotto tetto: si dirotta', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: null, phoneSuspicious: false,
    }), true)
})

test('i lead del lancio NON si dirottano mai', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: 'LANCIO_WEBDEV_2026', phoneSuspicious: false,
    }), false)
})

test('nessun lead con launchBucket si dirotta: i pool hanno un loro giro', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: 'DB_2026_04', phoneSuspicious: false,
    }), false)
})

test('telefono sospetto resta in quarantena', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: null, phoneSuspicious: true,
    }), false)
})

test('tetto raggiunto: torna tutto al routing di sempre', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 5, launchBucket: null, phoneSuspicious: false,
    }), false)
})

test('pipeline spenta: non si dirotta niente', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: { enabled: false, salesUserId: 'marco', freshCap: 5 },
        diverted: 0, launchBucket: null, phoneSuspicious: false,
    }), false)
})
