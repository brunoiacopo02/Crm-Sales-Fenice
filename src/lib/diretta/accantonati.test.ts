import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ACCANTONATI_PER_VOLTA, etichettaMotivo, quantiDaAssegnare, raggruppaMotivi } from './accantonati'

test('accantonati: motivi in italiano semplice, sconosciuti in "Altro"', () => {
    assert.equal(etichettaMotivo('mai_risposto_al_bot'), 'Non hanno mai risposto in chat')
    assert.equal(etichettaMotivo('stella_fuori_selezione'), 'Chat interrotta, inserzioni meno buone')
    assert.equal(etichettaMotivo('lorenzo_solo_ridati_migliori'), 'Tolti a Lorenzo')
    assert.equal(etichettaMotivo('qualcosa_di_nuovo'), 'Altro')
    assert.equal(etichettaMotivo(null), 'Altro')
})

test('accantonati: quanti se ne assegnano', () => {
    assert.equal(quantiDaAssegnare(40, 1000), 40)
    assert.equal(quantiDaAssegnare(40, 12), 12)
    assert.equal(quantiDaAssegnare(-3, 100), 0)
    assert.equal(quantiDaAssegnare(7.9, 100), 7)
    assert.equal(quantiDaAssegnare(Number.NaN, 100), 0)
    assert.equal(quantiDaAssegnare(5000, 5000), MAX_ACCANTONATI_PER_VOLTA)
    assert.equal(quantiDaAssegnare(10, 0), 0)
})

test('accantonati: motivi raggruppati, dal più numeroso', () => {
    const r = raggruppaMotivi([
        { motivo: 'stella_fuori_selezione', n: 30 },
        { motivo: 'mai_risposto_al_bot', n: 100 },
        { motivo: 'x', n: 2 },
        { motivo: null, n: 1 },
        { motivo: 'lorenzo_solo_ridati_migliori', n: 0 },
    ])
    assert.deepEqual(r, [
        { etichetta: 'Non hanno mai risposto in chat', n: 100 },
        { etichetta: 'Chat interrotta, inserzioni meno buone', n: 30 },
        { etichetta: 'Altro', n: 3 },
    ])
})
