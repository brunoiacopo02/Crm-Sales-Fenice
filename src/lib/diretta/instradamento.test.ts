import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    riceveRidati, riceveVergini, ORDINE_RIPIEGO_FRESCHI, ordineRipiegoFreschi, SCELTE_PO_25_10,
    pianoInstradamento, pianoRidistribuzione, eLeadDelLancio, sottoTetto,
    type GdoInstradabile,
} from './instradamento'

function gdo(gdoCode: number | null, p: Partial<GdoInstradabile> = {}): GdoInstradabile {
    return {
        id: `id-${gdoCode ?? 'x'}`, gdoCode, role: 'GDO', isActive: true, isBot: false, isTest: false,
        firstName: gdoCode ? `Nome${gdoCode}` : null,
        acAutoIntake: false, botReturnIntake: false, dailyFreshCap: null,
        ...p,
    }
}

// ------------------------------------------------------------- chi riceve

test('ridati: li riceve il GDO della squadra col flag acceso', () => {
    assert.equal(riceveRidati(gdo(105, { botReturnIntake: true })), true)
    assert.equal(riceveRidati(gdo(105, { botReturnIntake: false })), false)
})

test('ridati: mai a chi è fuori squadra, anche col flag acceso (108 senza nome, il bot, un account spento)', () => {
    assert.equal(riceveRidati(gdo(108, { firstName: null, botReturnIntake: true })), false)
    assert.equal(riceveRidati(gdo(201, { isBot: true, firstName: null, botReturnIntake: true })), false)
    assert.equal(riceveRidati(gdo(107, { isActive: false, botReturnIntake: true })), false)
    assert.equal(riceveRidati(gdo(110, { firstName: '   ', botReturnIntake: true })), false)
})

test('vergini: li riceve il GDO della squadra coi freschi accesi, mai il bot', () => {
    assert.equal(riceveVergini(gdo(119, { acAutoIntake: true })), true)
    assert.equal(riceveVergini(gdo(201, { isBot: true, firstName: null, acAutoIntake: true })), false)
    assert.equal(riceveVergini(gdo(108, { firstName: null, acAutoIntake: true })), false)
})

test('account di prova: mai lead veri, nemmeno con tutti i flag accesi, e il piano del go-live non lo tocca', () => {
    const prova = gdo(990, { isTest: true, firstName: 'Prova GDO', acAutoIntake: true, botReturnIntake: true })
    assert.equal(riceveVergini(prova), false)
    assert.equal(riceveRidati(prova), false)
    const piano = pianoInstradamento([gdo(990, { isTest: true, firstName: 'Prova GDO' })], SCELTE_PO_25_10)
    assert.deepEqual(piano, [])
})

// ------------------------------------------------------------- ripiego a tetto pieno

test('freschi: a tetto pieno il lead va al bot prima che ai GDO senza tetto', () => {
    const o = [...ORDINE_RIPIEGO_FRESCHI]
    assert.equal(o[0], 'umani_sotto_tetto')
    assert.ok(o.indexOf('bot') < o.indexOf('umani_senza_tetto'))
})

test('freschi: le scorte, se qualcuno le accende, passano prima del bot', () => {
    const o = [...ORDINE_RIPIEGO_FRESCHI]
    assert.ok(o.indexOf('scorte') < o.indexOf('bot'))
})

test('freschi: l ultima rete resta umana, così un lead non resta mai senza padrone', () => {
    assert.equal(ORDINE_RIPIEGO_FRESCHI[ORDINE_RIPIEGO_FRESCHI.length - 1], 'umani_senza_tetto')
})

test('freschi: nel rientro "niente freschi al bot" (gdo_only) il bot resta fuori dalla catena', () => {
    assert.equal(ordineRipiegoFreschi('gdo_only').includes('bot'), false)
    assert.deepEqual([...ordineRipiegoFreschi('bot_first')], [...ORDINE_RIPIEGO_FRESCHI])
    assert.deepEqual([...ordineRipiegoFreschi('bot_only')], [...ORDINE_RIPIEGO_FRESCHI])
})

// ------------------------------------------------------------- piano di go-live

/** La squadra com'è il 25/10/2026 prima del go-live. */
function squadraOggi(): GdoInstradabile[] {
    return [
        gdo(105, { botReturnIntake: true }),
        gdo(106, { dailyFreshCap: 60 }),
        gdo(107, { isActive: false }),
        gdo(108, { firstName: null }),
        gdo(110),
        gdo(112, { dailyFreshCap: 60 }),
        gdo(114),
        gdo(115, { botReturnIntake: true }),
        gdo(116, { isActive: false }),
        gdo(118),
        gdo(119, { botReturnIntake: true, dailyFreshCap: 60 }),
        gdo(201, { isBot: true, firstName: null, acAutoIntake: true }),
    ]
}

test('piano: ridati e vergini (10 al giorno) a tutta la squadra tranne 112, 114 e Lorenzo (118)', () => {
    const piano = pianoInstradamento(squadraOggi(), SCELTE_PO_25_10)
    const dopo = new Map(piano.map((r) => [r.gdoCode, r.dopo]))

    for (const c of [105, 106, 107, 110, 115, 116, 119]) {
        const d = dopo.get(c) ?? squadraOggi().find((g) => g.gdoCode === c)!
        assert.equal(d.botReturnIntake, true, `ridati ${c}`)
        assert.equal(d.acAutoIntake, true, `vergini ${c}`)
        assert.equal(d.dailyFreshCap, 10, `tetto ${c}`)
    }
    for (const c of [112, 114, 118]) {
        const d = dopo.get(c) ?? squadraOggi().find((g) => g.gdoCode === c)!
        assert.equal(d.botReturnIntake, false, `ridati ${c}`)
        assert.equal(d.acAutoIntake, false, `vergini ${c}`)
    }
})

test('piano: Lorenzo (118) non riceve lead nuovi finché Bruno non lo accende, e il suo tetto resta', () => {
    // qualcuno gli aveva acceso i flag: il go-live li spegne
    const gdos = [gdo(118, { acAutoIntake: true, botReturnIntake: true, dailyFreshCap: 30 })]
    const [r] = pianoInstradamento(gdos, SCELTE_PO_25_10)
    assert.deepEqual(r.dopo, { acAutoIntake: false, botReturnIntake: false, dailyFreshCap: 30 })
    // già spento: niente da cambiare
    assert.deepEqual(pianoInstradamento([gdo(118, { dailyFreshCap: 30 })], SCELTE_PO_25_10), [])
})

// ------------------------------------------------------------- tetti del giorno

test('tetto: vuoto vuol dire nessun tetto, altrimenti si riceve finché si è sotto', () => {
    assert.equal(sottoTetto(500, null), true)
    assert.equal(sottoTetto(0, undefined), true)
    assert.equal(sottoTetto(29, 30), true)
    assert.equal(sottoTetto(30, 30), false)
    assert.equal(sottoTetto(31, 30), false)
    // tetto 0: spento anche col flag acceso
    assert.equal(sottoTetto(0, 0), false)
})

test('piano: non tocca il bot né chi è fuori squadra', () => {
    const piano = pianoInstradamento(squadraOggi(), SCELTE_PO_25_10)
    assert.equal(piano.some((r) => r.gdoCode === 201 || r.gdoCode === 108), false)
})

test('piano: elenca solo chi cambia, ed è idempotente', () => {
    const gdos = squadraOggi()
    const primo = pianoInstradamento(gdos, SCELTE_PO_25_10)
    const applicato = gdos.map((g) => {
        const r = primo.find((x) => x.id === g.id)
        return r ? { ...g, ...r.dopo } : g
    })
    assert.deepEqual(pianoInstradamento(applicato, SCELTE_PO_25_10), [])
})

test('piano: segnala chi riceverà lead ma ha l account spento', () => {
    const piano = pianoInstradamento(squadraOggi(), SCELTE_PO_25_10)
    assert.equal(piano.find((r) => r.gdoCode === 107)!.accountSpento, true)
    assert.equal(piano.find((r) => r.gdoCode === 110)!.accountSpento, false)
})

// ------------------------------------------------------------- ridistribuzione equa

test('ridistribuzione: parti uguali, al massimo uno di differenza', () => {
    const lead = Array.from({ length: 180 }, (_, i) => `l${String(i).padStart(3, '0')}`)
    const piano = pianoRidistribuzione(lead, ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'])
    const conta = new Map<string, number>()
    for (const s of piano) conta.set(s.a, (conta.get(s.a) ?? 0) + 1)
    assert.equal(piano.length, 180)
    assert.equal(Math.max(...conta.values()) - Math.min(...conta.values()) <= 1, true)
    assert.equal(new Set(piano.map((s) => s.leadId)).size, 180)
})

test('ridistribuzione: stesso input, stesso piano, in qualunque ordine arrivino i lead', () => {
    const lead = ['c', 'a', 'b', 'd']
    const uno = pianoRidistribuzione(lead, ['g2', 'g1'])
    const due = pianoRidistribuzione([...lead].reverse(), ['g1', 'g2'])
    assert.deepEqual(uno, due)
})

test('ridistribuzione: senza destinatari non sposta niente', () => {
    assert.deepEqual(pianoRidistribuzione(['a', 'b'], []), [])
})

// ------------------------------------------------------------- lancio

test('lancio: lo riconosce da bucket, funnel, pool o gruppo di prova', () => {
    const vuoto = { launchBucket: null, funnel: 'CORSO 10 ORE', lancioPool: null, humanTestCohort: null }
    assert.equal(eLeadDelLancio(vuoto), false)
    assert.equal(eLeadDelLancio({ ...vuoto, launchBucket: 'LANCIO_WEBDEV_2026' }), true)
    assert.equal(eLeadDelLancio({ ...vuoto, funnel: 'Lancio Web Dev AI' }), true)
    assert.equal(eLeadDelLancio({ ...vuoto, lancioPool: 'ARCHIVIATO' }), true)
    assert.equal(eLeadDelLancio({ ...vuoto, humanTestCohort: 'LANCIO_UMANI_20261007' }), true)
})

test('lancio: i pool database non sono il lancio', () => {
    assert.equal(eLeadDelLancio({ launchBucket: 'DB_2026_07', funnel: 'Database', lancioPool: null, humanTestCohort: null }), false)
})
