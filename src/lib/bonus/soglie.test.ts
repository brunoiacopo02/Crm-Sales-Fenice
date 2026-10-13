import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaSoglieBonus, ANCORA_FATTURATO_EUR } from './soglie'

test("all'ancora (ottobre 2026, €310.000) le soglie sono quelle decise: GDO 5, Conferme 20", () => {
    const s = calcolaSoglieBonus(ANCORA_FATTURATO_EUR)!
    assert.equal(s.gdo.soglia, 5)
    assert.equal(s.conferme.soglia, 20)
    assert.equal(s.gdo.euro, 12)
    assert.equal(s.conferme.euro, 15)
})

test("le soglie scalano in proporzione all'obiettivo di fatturato", () => {
    // Settembre 2026: 249.600 → 4,03 e 16,1
    const set = calcolaSoglieBonus(249_600)!
    assert.equal(set.gdo.soglia, 4)
    assert.equal(set.conferme.soglia, 16)
    // Obiettivo doppio → soglie doppie
    const doppio = calcolaSoglieBonus(620_000)!
    assert.equal(doppio.gdo.soglia, 10)
    assert.equal(doppio.conferme.soglia, 40)
})

test('arrotonda al più vicino', () => {
    // 5 × 341.000/310.000 = 5,5 → 6 ; 20 × 1,1 = 22
    const s = calcolaSoglieBonus(341_000)!
    assert.equal(s.gdo.soglia, 6)
    assert.equal(s.conferme.soglia, 22)
})

test('la soglia non scende mai sotto 1', () => {
    const s = calcolaSoglieBonus(10_000)!
    assert.equal(s.gdo.soglia, 1)
    assert.equal(s.conferme.soglia, 1)
})

test('senza obiettivo impostato non calcola niente', () => {
    assert.equal(calcolaSoglieBonus(0), null)
    assert.equal(calcolaSoglieBonus(null), null)
    assert.equal(calcolaSoglieBonus(-5), null)
})
