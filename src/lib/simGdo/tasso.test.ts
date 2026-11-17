import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coloreCella, contaChiamate, contaGruppi, eGdoDellaMedia, sogliaRossa, tasso, MIN_CHIAMATE } from './tasso'

const ora = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00+01:00`)
const log = (outcome: string, hhmm = '10:00', discardReason: string | null = null) => ({ outcome, discardReason, createdAt: ora(hhmm) })

test('conteggio: risposta = esito diverso da NON_RISPOSTO', () => {
    const c = contaChiamate([log('NON_RISPOSTO'), log('RICHIAMO'), log('APPUNTAMENTO'), log('DA_SCARTARE', '10:00', 'non interessato')])
    assert.deepEqual(c, { chiamate: 4, risposte: 3 })
})

test('conteggio: il numero inesistente sta fuori da numeratore e denominatore', () => {
    const c = contaChiamate([log('NON_RISPOSTO'), log('DA_SCARTARE', '10:00', ' Numero inesistente '), log('RICHIAMO')])
    assert.deepEqual(c, { chiamate: 2, risposte: 1 })
})

test('conteggio: altri esiti non contano (non sono chiamate esitate)', () => {
    const c = contaChiamate([log('NON_RISPOSTO'), log('NOTA'), log('')])
    assert.deepEqual(c, { chiamate: 1, risposte: 0 })
})

test('conteggio: dopo il cambio della SIM contano solo le chiamate da quel momento', () => {
    const logs = [log('RICHIAMO', '09:00'), log('NON_RISPOSTO', '11:59'), log('NON_RISPOSTO', '12:00'), log('APPUNTAMENTO', '15:00')]
    assert.deepEqual(contaChiamate(logs, ora('12:00')), { chiamate: 2, risposte: 1 })
    assert.deepEqual(contaChiamate(logs, null), { chiamate: 4, risposte: 2 })
})

test('media di squadra pesata dai gruppi della query (esito, motivo, quante)', () => {
    const c = contaGruppi([
        { outcome: 'NON_RISPOSTO', discardReason: null, n: 70 },
        { outcome: 'RICHIAMO', discardReason: null, n: 20 },
        { outcome: 'DA_SCARTARE', discardReason: 'numero inesistente', n: 5 },
        { outcome: 'DA_SCARTARE', discardReason: 'non ha soldi', n: 10 },
    ])
    assert.deepEqual(c, { chiamate: 100, risposte: 30 })
    assert.equal(tasso(c), 0.3)
    assert.ok(Math.abs(sogliaRossa(0.3) - 0.27) < 1e-12)
    assert.equal(tasso({ chiamate: 0, risposte: 0 }), null)
})

test('colori: vuota senza chiamate, grigia sotto 50, rossa sotto il 90% della media, verde altrimenti', () => {
    const soglia = 0.269
    assert.equal(MIN_CHIAMATE, 50)
    assert.equal(coloreCella({ chiamate: 0, risposte: 0 }, soglia), null)
    assert.equal(coloreCella({ chiamate: 49, risposte: 1 }, soglia), 'grigio')
    assert.equal(coloreCella({ chiamate: 49, risposte: 40 }, soglia), 'grigio')
    assert.equal(coloreCella({ chiamate: 50, risposte: 13 }, soglia), 'rosso') // 26%
    assert.equal(coloreCella({ chiamate: 1000, risposte: 269 }, soglia), 'verde') // esattamente la soglia: non è sotto
    assert.equal(coloreCella({ chiamate: 100, risposte: 40 }, soglia), 'verde')
    // senza media (nessuna chiamata da giugno) non si colora di rosso
    assert.equal(coloreCella({ chiamate: 100, risposte: 1 }, null), 'verde')
})

test('GDO della media: ruolo GDO, niente bot, prova e 108; contano anche gli account spenti', () => {
    const base = { role: 'GDO', isBot: false, isTest: false, gdoCode: 105 as number | null }
    assert.equal(eGdoDellaMedia(base), true)
    assert.equal(eGdoDellaMedia({ ...base, gdoCode: null }), true) // es. "GDO 109 storico"
    assert.equal(eGdoDellaMedia({ ...base, isBot: true, gdoCode: 201 }), false)
    assert.equal(eGdoDellaMedia({ ...base, isTest: true, gdoCode: 990 }), false)
    assert.equal(eGdoDellaMedia({ ...base, gdoCode: 108 }), false)
    assert.equal(eGdoDellaMedia({ ...base, role: 'CONFERME' }), false)
})
