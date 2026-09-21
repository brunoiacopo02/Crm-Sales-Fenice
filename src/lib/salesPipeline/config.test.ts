import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_SALES_PIPELINE_CONFIG,
    parseSalesPipelineConfig,
    canDivertFresh,
} from './config'

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
