import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DELIVERED_PUSH_RESULTS, DELIVERED_PUSH_RESULTS_SQL, isDeliveredPushResult } from './pushAudit'

test('consegnati sono sent e duplicate, e nient altro', () => {
    assert.deepEqual([...DELIVERED_PUSH_RESULTS], ['sent', 'duplicate'])
})

test('un push fallito non prova la consegna', () => {
    for (const r of ['skipped_disabled', 'missing_env', 'http_error', 'rate_limited', 'network_error']) {
        assert.equal(isDeliveredPushResult(r), false, r)
    }
})

test('duplicate vale come consegnato: e il lead che il fornitore aveva gia', () => {
    assert.equal(isDeliveredPushResult('duplicate'), true)
    assert.equal(isDeliveredPushResult('sent'), true)
})

test('un result assente non e una consegna', () => {
    assert.equal(isDeliveredPushResult(null), false)
    assert.equal(isDeliveredPushResult(undefined), false)
    assert.equal(isDeliveredPushResult(''), false)
})

test('il frammento SQL e quotato e senza apici da iniettare', () => {
    assert.equal(DELIVERED_PUSH_RESULTS_SQL, "'sent', 'duplicate'")
    assert.ok(DELIVERED_PUSH_RESULTS.every(r => /^[a-z_]+$/.test(r)), 'valori interpolati in sql.raw: solo lettere')
})
