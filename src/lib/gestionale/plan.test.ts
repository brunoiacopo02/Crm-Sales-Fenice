import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffIds, assertSafeToApply, SyncGuardError, resolveSeller } from './plan'

test('diffIds: nuovi, aggiornati, ripristinati, eliminati', () => {
    const d = diffIds(
        [{ id: 'a', deleted: false }, { id: 'b', deleted: false }, { id: 'c', deleted: true }, { id: 'z', deleted: true }],
        ['a', 'c', 'n'],
    )
    assert.deepEqual(d.insertIds, ['n'])
    assert.deepEqual(d.updateIds, ['a'])
    assert.deepEqual(d.restoreIds, ['c'])
    assert.deepEqual(d.deleteIds, ['b'])
})

test('guardia: snapshot vuoto con righe vive blocca', () => {
    assert.throws(() => assertSafeToApply('contratti', 5, 0, 5), SyncGuardError)
})

test('guardia: primo sync vuoto è ammesso', () => {
    assert.doesNotThrow(() => assertSafeToApply('contratti', 0, 0, 0))
})

test('guardia: oltre il 30% di eliminazioni blocca solo sopra 10 righe vive', () => {
    assert.throws(() => assertSafeToApply('incassi', 100, 69, 31), SyncGuardError)
    assert.doesNotThrow(() => assertSafeToApply('incassi', 100, 70, 30))
    assert.doesNotThrow(() => assertSafeToApply('incassi', 9, 4, 5))
})

test('resolveSeller: codice noto, DIREZIONE, sconosciuto, null', () => {
    const sellers = new Map([['Sales 002', 'u2']])
    const w = new Set<string>()
    assert.equal(resolveSeller('Sales 002', sellers, w), 'u2')
    assert.equal(resolveSeller('DIREZIONE', sellers, w), null)
    assert.equal(resolveSeller(null, sellers, w), null)
    assert.equal(resolveSeller('Sales 099', sellers, w), null)
    assert.deepEqual([...w], ['Codice venditore sconosciuto: Sales 099'])
})
