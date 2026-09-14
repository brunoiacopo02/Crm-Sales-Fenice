import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estendiAncore, ultimaDisposizione, chiaveGiorno, FINESTRA_GIORNI } from './attribuzioneRegole'

const A = 'user-a', B = 'user-b'

test('un giorno agganciato resta suo, uno senza aggancio eredita dall\'ancora piu\' vicina', () => {
    const ancore = new Map([
        [chiaveGiorno('1007', '2026-08-20'), A],
        [chiaveGiorno('1007', '2026-08-28'), B],
    ])
    const mappa = estendiAncore(ancore, [
        { src: '1007', dateLocal: '2026-08-20' },
        { src: '1007', dateLocal: '2026-08-22' }, // 2 gg da A, 6 da B
        { src: '1007', dateLocal: '2026-08-27' }, // 7 gg da A, 1 da B
    ])
    assert.equal(mappa.get(chiaveGiorno('1007', '2026-08-20')), A)
    assert.equal(mappa.get(chiaveGiorno('1007', '2026-08-22')), A)
    assert.equal(mappa.get(chiaveGiorno('1007', '2026-08-27')), B)
})

test('oltre la finestra il giorno resta scoperto: meglio un buco che un\'attribuzione inventata', () => {
    const ancore = new Map([[chiaveGiorno('1007', '2026-08-01'), A]])
    const dentro = '2026-08-11' // esattamente FINESTRA_GIORNI
    const fuori = '2026-08-12'
    assert.equal(FINESTRA_GIORNI, 10)
    const mappa = estendiAncore(ancore, [
        { src: '1007', dateLocal: dentro },
        { src: '1007', dateLocal: fuori },
    ])
    assert.equal(mappa.get(chiaveGiorno('1007', dentro)), A)
    assert.equal(mappa.has(chiaveGiorno('1007', fuori)), false)
})

test('le ancore di un interno non contaminano un altro interno', () => {
    const ancore = new Map([[chiaveGiorno('1007', '2026-08-20'), A]])
    const mappa = estendiAncore(ancore, [{ src: '1010', dateLocal: '2026-08-20' }])
    assert.equal(mappa.has(chiaveGiorno('1010', '2026-08-20')), false)
})

test('a parita\' di distanza vince l\'ancora piu\' vecchia, qualunque sia l\'ordine di arrivo', () => {
    const giorni = [{ src: '1007', dateLocal: '2026-08-24' }]
    const k = chiaveGiorno('1007', '2026-08-24')
    const ordine1 = new Map([[chiaveGiorno('1007', '2026-08-22'), A], [chiaveGiorno('1007', '2026-08-26'), B]])
    const ordine2 = new Map([[chiaveGiorno('1007', '2026-08-26'), B], [chiaveGiorno('1007', '2026-08-22'), A]])
    assert.equal(estendiAncore(ordine1, giorni).get(k), A)
    assert.equal(estendiAncore(ordine2, giorni).get(k), A)
})

test('la disposizione piu\' recente prende l\'ancora diretta con la data piu\' alta, per interno', () => {
    const ancore = new Map([
        [chiaveGiorno('1009', '2026-08-26'), A],
        [chiaveGiorno('1009', '2026-08-27'), B], // dal 27/08 la scrivania e' passata a B
        [chiaveGiorno('1020', '2026-09-01'), A],
    ])
    const ultima = ultimaDisposizione(ancore)
    assert.equal(ultima.get('1009'), B)
    assert.equal(ultima.get('1020'), A)
    assert.equal(ultima.size, 2)
})
