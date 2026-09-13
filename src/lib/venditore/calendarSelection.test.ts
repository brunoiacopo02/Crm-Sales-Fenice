// src/lib/venditore/calendarSelection.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toggleGroup, paintDirection, applyPaint } from './calendarSelection'

const never = () => false

test('toggleGroup: nessuna selezionata → seleziona tutte', () => {
    const out = toggleGroup(new Set(), ['a', 'b', 'c'], never)
    assert.deepEqual([...out].sort(), ['a', 'b', 'c'])
})

test('toggleGroup: alcune selezionate → seleziona le mancanti (non le toglie)', () => {
    const out = toggleGroup(new Set(['a']), ['a', 'b', 'c'], never)
    assert.deepEqual([...out].sort(), ['a', 'b', 'c'])
})

test('toggleGroup: tutte selezionate → le toglie tutte', () => {
    const out = toggleGroup(new Set(['a', 'b', 'c', 'z']), ['a', 'b', 'c'], never)
    assert.deepEqual([...out], ['z'])
})

test('toggleGroup: le chiavi bloccate non contano e non cambiano', () => {
    // 'b' è bloccata e selezionata: resta com'è; a e c sono tutte e due selezionate → si tolgono
    const out = toggleGroup(new Set(['a', 'b', 'c']), ['a', 'b', 'c'], k => k === 'b')
    assert.deepEqual([...out], ['b'])
    // 'b' bloccata e NON selezionata: resta fuori anche quando si accende il gruppo
    const out2 = toggleGroup(new Set(), ['a', 'b'], k => k === 'b')
    assert.deepEqual([...out2], ['a'])
})

test('toggleGroup: solo chiavi bloccate → copia identica', () => {
    const src = new Set(['b'])
    const out = toggleGroup(src, ['b'], () => true)
    assert.notEqual(out, src)
    assert.deepEqual([...out], ['b'])
})

test('paintDirection: origine non selezionata → true (rende disponibile)', () => {
    assert.equal(paintDirection(new Set(), 'a'), true)
    assert.equal(paintDirection(new Set(['a']), 'a'), false)
})

test("applyPaint: aggiunge o toglie senza mutare l'originale", () => {
    const src = new Set(['a'])
    const on = applyPaint(src, 'b', true)
    const off = applyPaint(src, 'a', false)
    assert.deepEqual([...src], ['a'])
    assert.deepEqual([...on].sort(), ['a', 'b'])
    assert.deepEqual([...off], [])
})
