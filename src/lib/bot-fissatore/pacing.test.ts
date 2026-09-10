import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prossimoInvio } from './pacing'

const INTERVALLO = 2_000
const BUDGET = 240_000
const p = (indice: number, elapsedMs: number, budgetMs = BUDGET) =>
    prossimoInvio({ indice, elapsedMs, intervalloMs: INTERVALLO, budgetMs })

test('il primo invio parte subito', () => {
    assert.deepEqual(p(0, 0), { attesaMs: 0, fuoriBudget: false })
})

test('la cadenza e ancorata alla partenza, non all ultimo invio', () => {
    // 3o lead (indice 2) con 1s trascorso: deve partire a 4s, quindi attende 3s.
    assert.equal(p(2, 1_000).attesaMs, 3_000)
})

test('un push lento non somma la sua attesa al ritardo gia accumulato', () => {
    // Il lead precedente ha impiegato 15s: siamo gia' oltre la nostra cadenza,
    // il successivo parte subito invece di aspettare altri 2s.
    assert.equal(p(3, 15_000).attesaMs, 0)
})

test('recuperare il ritardo non fa mai partire due invii insieme', () => {
    // Anche molto in ritardo, ogni chiamata resta una: l attesa non va negativa.
    for (const elapsed of [10_000, 60_000, 500_000]) {
        assert.ok(p(1, elapsed).attesaMs >= 0, `elapsed ${elapsed}`)
    }
})

test('il lotto si ferma quando l attesa sforerebbe il budget', () => {
    // indice 120 => partenza prevista a 240s, esattamente il budget: dentro.
    assert.deepEqual(p(120, 0), { attesaMs: 240_000, fuoriBudget: false })
    // indice 121 => 242s: fuori, il resto torna al chiamante.
    assert.equal(p(121, 0).fuoriBudget, true)
})

test('sfora anche quando e il tempo gia speso a mangiare il budget', () => {
    // Nessuna attesa da fare, ma siamo gia' oltre: non si parte.
    assert.equal(p(0, 240_001).fuoriBudget, true)
    assert.equal(p(0, 239_000).fuoriBudget, false)
})

test('un budget a zero non manda niente invece di mandare un lead solo', () => {
    assert.equal(p(0, 1, 0).fuoriBudget, true)
})
