import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testoSerie } from './serieTesto'

const base = { giorni: 0, oggiFatto: false, oggiLavorativo: true, soglia: 8, prossima: { giorni: 3, scintille: 15, piume: 0 }, scudiInTasca: 0 }

test('serie in home: da zero, prossima tappa e premio', () => {
    const t = testoSerie(base)
    assert.equal(t.titolo, 'Serie: 0 giorni')
    assert.equal(t.oggi, 'Arriva a 8 fissati oggi per farla partire.')
    assert.equal(t.prossima, 'Prossima tappa a 3 giorni: 15 Scintille. Mancano 3 giorni.')
    assert.equal(t.scudo, null)
})

test('serie in home: oggi fatto, un giorno alla tappa, Piume all\'ultima, scudo', () => {
    const t = testoSerie({ ...base, giorni: 59, oggiFatto: true, prossima: { giorni: 60, scintille: 250, piume: 20 }, scudiInTasca: 1 })
    assert.equal(t.titolo, 'Serie: 59 giorni')
    assert.equal(t.oggi, 'Oggi è fatto.')
    assert.equal(t.prossima, 'Prossima tappa a 60 giorni: 250 Scintille e 20 Piume. Manca 1 giorno.')
    assert.match(t.scudo ?? '', /scudo da parte/)
})

test('serie in home: da tenere viva, domenica, tutte le tappe fatte', () => {
    assert.equal(testoSerie({ ...base, giorni: 1 }).titolo, 'Serie: 1 giorno')
    assert.equal(testoSerie({ ...base, giorni: 4 }).oggi, 'Arriva a 8 fissati oggi per tenerla viva.')
    assert.match(testoSerie({ ...base, giorni: 4, oggiLavorativo: false }).oggi, /non si conta/)
    assert.equal(testoSerie({ ...base, giorni: 61, prossima: null }).prossima, null)
})
