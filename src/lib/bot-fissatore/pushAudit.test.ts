import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DELIVERED_PUSH_RESULTS, DELIVERED_PUSH_RESULTS_SQL, isDeliveredPushResult,
    NO_REPUSH_RESULTS, NO_REPUSH_RESULTS_SQL, withLancioAudit,
} from './pushAudit'

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

test('non si rispinge chi e consegnato E chi e finito in network_error (un timeout e gia arrivato)', () => {
    assert.deepEqual([...NO_REPUSH_RESULTS], ['sent', 'duplicate', 'network_error'])
    for (const r of DELIVERED_PUSH_RESULTS) {
        assert.ok((NO_REPUSH_RESULTS as readonly string[]).includes(r), `${r} consegnato deve essere anche non-rispingibile`)
    }
    assert.equal(NO_REPUSH_RESULTS_SQL, "'sent', 'duplicate', 'network_error'")
    assert.ok(NO_REPUSH_RESULTS.every(r => /^[a-z_]+$/.test(r)), 'valori interpolati in sql.raw: solo lettere')
})

test('withLancioAudit: sui lead lancio l audit BOT_PUSHED porta lo slug, sugli altri no', () => {
    const at = new Date('2026-09-16T10:00:00Z')
    const conLancio = withLancioAudit({ result: 'sent', status: 200 }, { lancio: { slug: 'webdev-2026-10', ingresso: 'lista' } }, at)
    assert.deepEqual(conLancio, { result: 'sent', status: 200, at: '2026-09-16T10:00:00.000Z', lancio: 'webdev-2026-10' })
    const senza = withLancioAudit({ result: 'sent', status: 200 }, {}, at)
    assert.deepEqual(senza, { result: 'sent', status: 200, at: '2026-09-16T10:00:00.000Z' })
    assert.equal('lancio' in senza, false)
})
