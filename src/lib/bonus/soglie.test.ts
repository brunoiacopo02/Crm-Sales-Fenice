import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BONUS_GDO, GDO_SOGLIA_FISSA } from './soglie'
import { DEFAULT_TARGETS, euroFromPresences } from '@/lib/diretta/config'
import { DEFAULT_CONFERME_BONUS } from '@/lib/conferme/bonus'

test("GDO: soglia fissa a 4 dal 25/10/2026, €12 dalla 5ª presenza", () => {
    assert.equal(GDO_SOGLIA_FISSA, 4)
    assert.deepEqual(BONUS_GDO, { soglia: 4, euro: 12 })
    // Stessi valori della configurazione della Diretta, che calcola gli euro della settimana.
    assert.equal(DEFAULT_TARGETS.presenzeSogliaEuro, BONUS_GDO.soglia)
    assert.equal(DEFAULT_TARGETS.euroPerPresenza, BONUS_GDO.euro)
    assert.equal(euroFromPresences(4, DEFAULT_TARGETS), 0)
    assert.equal(euroFromPresences(5, DEFAULT_TARGETS), 12)
})

test('Conferme: soglia fissa anche per loro, 16 chiusure a settimana e €12 a testa', () => {
    assert.equal(DEFAULT_CONFERME_BONUS.unita, 'chiusure')
    assert.equal(DEFAULT_CONFERME_BONUS.periodo, 'settimana')
    assert.equal(DEFAULT_CONFERME_BONUS.soglia, 16)
    assert.equal(DEFAULT_CONFERME_BONUS.euroPerUnita, 12)
})
