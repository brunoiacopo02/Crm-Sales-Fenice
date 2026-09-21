import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_SALES_PIPELINE_CONFIG,
    parseSalesPipelineConfig,
    canDivertFresh,
} from './config'
import { dayBoundsRome } from '../dateUtils'

test('config assente: pipeline spenta', () => {
    assert.deepEqual(parseSalesPipelineConfig(null), DEFAULT_SALES_PIPELINE_CONFIG)
    assert.equal(DEFAULT_SALES_PIPELINE_CONFIG.enabled, false)
})

test('JSON malformato non accende niente', () => {
    assert.equal(parseSalesPipelineConfig('{questo non e json').enabled, false)
    assert.equal(parseSalesPipelineConfig('[]').enabled, false)
})

test('config valida viene letta', () => {
    const cfg = parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":5}')
    assert.deepEqual(cfg, { enabled: true, salesUserId: 'u-1', freshCap: 5 })
})

test('accesa senza venditore = spenta: non si dirotta verso nessuno', () => {
    const cfg = parseSalesPipelineConfig('{"enabled":true,"salesUserId":null,"freshCap":5}')
    assert.equal(cfg.enabled, false)
})

test('freshCap non valido ricade sul default 5', () => {
    assert.equal(parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":-3}').freshCap, 5)
    assert.equal(parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":"tanti"}').freshCap, 5)
})

test('il tetto dei freschi si rispetta, e il confine e stretto', () => {
    const cfg = { enabled: true, salesUserId: 'u-1', freshCap: 5 }
    assert.equal(canDivertFresh(cfg, 0), true)
    assert.equal(canDivertFresh(cfg, 4), true)
    assert.equal(canDivertFresh(cfg, 5), false)
    assert.equal(canDivertFresh(cfg, 6), false)
})

test('pipeline spenta non dirotta mai, nemmeno a zero dirottati', () => {
    assert.equal(canDivertFresh({ enabled: false, salesUserId: 'u-1', freshCap: 5 }, 0), false)
})

// Il tetto e' GIORNALIERO (Europe/Rome), non un totale da sempre (chiarito
// dal PO 2026-09-21). `canDivertFresh` e' pura e non lo sa: chi la chiama
// (il webhook AC in `route.ts`, e `countDivertedFresh` in
// `salesPipelineActions.ts`) deve contare SOLO gli eventi dentro
// `dayBoundsRome(now)`. Qui si dimostra il pezzo che rende vero "stesso
// tetto, conteggio di ieri irrilevante": un evento di ieri sera non cade
// dentro i confini di oggi, quindi non puo' contribuire a `diverted`.
test('cambio di giorno: un dirottamento di ieri sera non cade nel giorno di oggi', () => {
    // Giorno "normale" (nessun cambio ora), cosi' il caso non si confonde con
    // le 23h/25h gia' coperte da dateUtils.test.ts.
    const oggiPomeriggio = new Date('2026-10-06T14:00:00Z')
    const ieriSera = new Date('2026-10-05T20:00:00Z') // 22:00 Europe/Rome del 5/10, ancora "ieri"
    const stamattina = new Date('2026-10-06T07:00:00Z') // 09:00 Europe/Rome del 6/10, gia' "oggi"

    const { start, end } = dayBoundsRome(oggiPomeriggio)
    const dentroOggi = (at: Date) => at >= start && at < end

    assert.equal(dentroOggi(ieriSera), false, 'un evento di ieri sera non deve contare per oggi')
    assert.equal(dentroOggi(stamattina), true, 'un evento di stamattina conta per oggi')

    // Tradotto nella semantica del tetto: se il conteggio scoped al giorno
    // esclude "ieri sera", 5 dirottamenti di ieri non riempiono il tetto di
    // oggi, e il sesto lead (di oggi) puo' comunque partire.
    const cfg = { enabled: true, salesUserId: 'u-1', freshCap: 5 }
    const dirottatiSoloDiOggi = 0 // i 5 di ieri non contano piu', scoped a [start, end)
    assert.equal(canDivertFresh(cfg, dirottatiSoloDiOggi), true)
})
