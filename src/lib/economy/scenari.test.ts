import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaleCdf, probAlmeno, poissonAlmeno, poissonOltre, guadagnoGdo, guadagnoConferme, PATTO, CHIUSURA_SCENARI } from './scenari'
import { DEFAULT_ECONOMY_RULES } from './rules'
import { DEFAULT_TARGETS } from '@/lib/diretta/config'

const vicino = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('normale: valori noti', () => {
    vicino(normaleCdf(0), 0.5)
    vicino(normaleCdf(1.96), 0.975)
    vicino(normaleCdf(-1), 0.1587)
})

test('scalini: con 7,9 fissati di media l\'8 arriva circa un giorno su due (ottobre: 55%)', () => {
    vicino(probAlmeno(7.9, 2, 8), 0.579, 0.01)
    vicino(probAlmeno(7.9, 2, 10), 0.212, 0.01)
})

test('Poisson: probabilità di superare una soglia e unità oltre la soglia', () => {
    vicino(poissonAlmeno(3, 0), 1)
    vicino(poissonAlmeno(3, 1), 1 - Math.exp(-3))
    // E[X − 4]⁺ con media 5: somma diretta
    let atteso = 0
    let p = Math.exp(-5)
    for (let k = 0; k < 60; k++) {
        if (k > 0) p *= 5 / k
        atteso += Math.max(0, k - 4) * p
    }
    vicino(poissonOltre(5, 4), atteso, 1e-9)
    vicino(poissonOltre(2, 0), 2, 1e-9)
})

test('al massimo del patto una settimana vale circa 640 Scintille e 13,5 Piume', () => {
    const g = guadagnoGdo({ nome: 'massimo', ...PATTO.massimo, chiusura: CHIUSURA_SCENARI }, DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS)
    vicino(g.fissati, 44.4, 1e-9)
    vicino(g.presenze, 44.4 * 0.127 * 0.886, 1e-9)
    // Piume a stadi: conferme + presenze + 2 × chiusure (1, 2, 4 per lead, non sommati)
    vicino(g.piume.lead, g.conferme + g.presenze + 2 * g.chiusure, 1e-9)
    assert.ok(g.scintille.totale > 620 && g.scintille.totale < 660)
    assert.ok(g.piume.totale > 13 && g.piume.totale < 14)
})

test('Conferme: le Scintille vengono soprattutto dalle presenze, non dalla sola conferma', () => {
    const g = guadagnoConferme({ nome: 'x', conferme: 20, presenze: 18, inTempo: 0.5, chiusure: 6 }, DEFAULT_ECONOMY_RULES)
    assert.equal(g.scintille.conferme, 60)
    assert.equal(g.scintille.presenze, 18 * 17)
    assert.equal(g.scintille.inTempo, 18 * 0.5 * 6)
    assert.ok(g.scintille.presenze > 4 * g.scintille.conferme)
})
