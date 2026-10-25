import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaSoglieBonus, ANCORA_FATTURATO_EUR, BONUS_GDO, GDO_SOGLIA_FISSA } from './soglie'
import { DEFAULT_TARGETS, euroFromPresences } from '@/lib/diretta/config'

test("GDO: soglia fissa a 4 dal 25/10/2026, €12 dalla 5ª presenza", () => {
    assert.equal(GDO_SOGLIA_FISSA, 4)
    assert.deepEqual(BONUS_GDO, { soglia: 4, euro: 12 })
    // Stessi valori della configurazione della Diretta, che calcola gli euro della settimana.
    assert.equal(DEFAULT_TARGETS.presenzeSogliaEuro, BONUS_GDO.soglia)
    assert.equal(DEFAULT_TARGETS.euroPerPresenza, BONUS_GDO.euro)
    assert.equal(euroFromPresences(4, DEFAULT_TARGETS), 0)
    assert.equal(euroFromPresences(5, DEFAULT_TARGETS), 12)
})

test("all'ancora (ottobre 2026, €310.000): GDO 4 fissa, Conferme 20", () => {
    const s = calcolaSoglieBonus(ANCORA_FATTURATO_EUR)!
    assert.equal(s.gdo.soglia, 4)
    assert.equal(s.conferme.soglia, 20)
    assert.equal(s.gdo.euro, 12)
    assert.equal(s.conferme.euro, 15)
})

test("solo la soglia Conferme scala con l'obiettivo di fatturato; quella GDO resta 4", () => {
    // Settembre 2026: 249.600 → Conferme 16,1
    const set = calcolaSoglieBonus(249_600)!
    assert.equal(set.gdo.soglia, 4)
    assert.equal(set.conferme.soglia, 16)
    // Obiettivo doppio → Conferme doppia, GDO uguale
    const doppio = calcolaSoglieBonus(620_000)!
    assert.equal(doppio.gdo.soglia, 4)
    assert.equal(doppio.conferme.soglia, 40)
})

test('arrotonda al più vicino', () => {
    // 20 × 341.000/310.000 = 22
    const s = calcolaSoglieBonus(341_000)!
    assert.equal(s.gdo.soglia, 4)
    assert.equal(s.conferme.soglia, 22)
})

test('la soglia Conferme non scende mai sotto 1', () => {
    const s = calcolaSoglieBonus(10_000)!
    assert.equal(s.gdo.soglia, 4)
    assert.equal(s.conferme.soglia, 1)
})

test('senza obiettivo impostato non calcola le Conferme (il GDO usa BONUS_GDO)', () => {
    assert.equal(calcolaSoglieBonus(0), null)
    assert.equal(calcolaSoglieBonus(null), null)
    assert.equal(calcolaSoglieBonus(-5), null)
})
