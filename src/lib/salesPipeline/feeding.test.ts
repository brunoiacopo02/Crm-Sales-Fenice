import test from 'node:test'
import assert from 'node:assert/strict'
import { decideDiversion, pickMostLoadedGdo, shouldDivertFreshLead } from './feeding'
import { LANCIO_FUNNEL } from '../lancio/intake'

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

// --- decideDiversion: la regola intera, quella che il webhook chiama davvero.
//
// Ogni caso qui sotto ha la stessa conclusione: `null`, cioe' "questo lead
// segue il routing di sempre". E' la proprieta' che protegge la produzione —
// a pipeline spenta il GDO scelto e' esattamente quello di prima — e prima di
// questi test era difesa solo da un commento.

const baseInput = {
    cfg: cfgOn,
    diverted: 0,
    funnel: 'BUSINESS' as string | null,
    launchBucket: null as string | null,
    phoneSuspicious: false,
}

test('decideDiversion: lead fresco pulito sotto tetto va al venditore', () => {
    assert.equal(decideDiversion(baseInput), 'marco')
})

test('decideDiversion: pipeline spenta -> null', () => {
    assert.equal(decideDiversion({
        ...baseInput,
        cfg: { enabled: false, salesUserId: 'marco', freshCap: 5 },
    }), null)
})

test('decideDiversion: config senza venditore -> null', () => {
    assert.equal(decideDiversion({
        ...baseInput,
        cfg: { enabled: true, salesUserId: null, freshCap: 5 },
    }), null)
})

test('decideDiversion: funnel del lancio -> null', () => {
    assert.equal(decideDiversion({ ...baseInput, funnel: LANCIO_FUNNEL }), null)
})

test('decideDiversion: funnel del lancio in maiuscolo (come lo scrive il webhook) -> null', () => {
    assert.equal(decideDiversion({ ...baseInput, funnel: LANCIO_FUNNEL.toUpperCase() }), null)
})

test('decideDiversion: funnel del lancio con spazi di troppo -> null', () => {
    assert.equal(decideDiversion({ ...baseInput, funnel: '  Lancio   Web  Dev   AI ' }), null)
})

test('decideDiversion: launchBucket qualsiasi -> null', () => {
    for (const bucket of ['LANCIO_WEBDEV_2026', 'DB_2026_04', 'BLACK_SUMMER', 'qualunque-cosa']) {
        assert.equal(decideDiversion({ ...baseInput, launchBucket: bucket }), null, bucket)
    }
})

test('decideDiversion: telefono in quarantena -> null', () => {
    assert.equal(decideDiversion({ ...baseInput, phoneSuspicious: true }), null)
})

test('decideDiversion: tetto pieno -> null', () => {
    assert.equal(decideDiversion({ ...baseInput, diverted: 5 }), null)
})

test('decideDiversion: tetto a zero -> null anche al primo lead', () => {
    assert.equal(decideDiversion({
        ...baseInput,
        cfg: { enabled: true, salesUserId: 'marco', freshCap: 0 },
    }), null)
})

test('decideDiversion: funnel assente non e il funnel del lancio', () => {
    assert.equal(decideDiversion({ ...baseInput, funnel: null }), 'marco')
})
