import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayBoundsRome, monthBoundsRome, toRomeDateStr, weekBoundsRome } from './dateUtils'

/**
 * I due weekend di cambio ora del 2026 (ultima domenica di marzo e di ottobre)
 * sono gli unici giorni in cui `dayBoundsRome` sbagliava: prendeva l'offset
 * dall'istante ricevuto e chiudeva la finestra a `start + 24h`.
 *
 * Verità di riferimento:
 *  - dom 29/03/2026, giorno da 23h: mezzanotte a +01:00 (28/03 23:00Z),
 *    mezzanotte del 30/03 a +02:00 (29/03 22:00Z);
 *  - dom 25/10/2026, giorno da 25h: mezzanotte a +02:00 (24/10 22:00Z),
 *    mezzanotte del 26/10 a +01:00 (25/10 23:00Z).
 */

const ORE = (ms: number) => ms / 3_600_000

test('giorno normale: 24 ore esatte e mezzanotte di Roma', () => {
    const { start, end } = dayBoundsRome(new Date('2026-10-06T09:30:00Z'))
    assert.equal(start.toISOString(), '2026-10-05T22:00:00.000Z')
    assert.equal(end.toISOString(), '2026-10-06T22:00:00.000Z')
    assert.equal(ORE(end.getTime() - start.getTime()), 24)
})

test('cambio ora di primavera: il 29/03/2026 dura 23 ore', () => {
    for (const istante of ['2026-03-29T00:30:00Z', '2026-03-29T10:00:00Z', '2026-03-29T21:30:00Z']) {
        const { start, end } = dayBoundsRome(new Date(istante))
        assert.equal(start.toISOString(), '2026-03-28T23:00:00.000Z', istante)
        assert.equal(end.toISOString(), '2026-03-29T22:00:00.000Z', istante)
        assert.equal(ORE(end.getTime() - start.getTime()), 23, istante)
    }
})

test('cambio ora di autunno: il 25/10/2026 dura 25 ore', () => {
    for (const istante of ['2026-10-24T22:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T15:00:00Z']) {
        const { start, end } = dayBoundsRome(new Date(istante))
        assert.equal(start.toISOString(), '2026-10-24T22:00:00.000Z', istante)
        assert.equal(end.toISOString(), '2026-10-25T23:00:00.000Z', istante)
        assert.equal(ORE(end.getTime() - start.getTime()), 25, istante)
    }
})

test('il giorno prima e il giorno dopo il cambio ora si incastrano senza buchi', () => {
    const sabato = dayBoundsRome(new Date('2026-10-24T12:00:00Z'))
    const domenica = dayBoundsRome(new Date('2026-10-25T12:00:00Z'))
    const lunedi = dayBoundsRome(new Date('2026-10-26T12:00:00Z'))
    assert.equal(sabato.end.toISOString(), domenica.start.toISOString())
    assert.equal(domenica.end.toISOString(), lunedi.start.toISOString())
})

test('gli estremi cadono nel giorno giusto letto a Roma', () => {
    const { start, end } = dayBoundsRome(new Date('2026-10-25T15:00:00Z'))
    assert.equal(toRomeDateStr(start), '2026-10-25')
    assert.equal(toRomeDateStr(new Date(end.getTime() - 1)), '2026-10-25')
    assert.equal(toRomeDateStr(end), '2026-10-26')
})

test('un appuntamento notturno del giorno di lancio sta dentro la giornata', () => {
    // 6 ottobre 2026, 00:40 ora di Roma: il bot prenota anche di notte.
    const notturno = new Date('2026-10-05T22:40:00Z')
    const { start, end } = dayBoundsRome(notturno)
    assert.ok(notturno >= start && notturno < end)
    assert.equal(toRomeDateStr(start), '2026-10-06')
})

test('a fine mese il bound di fine passa al mese successivo', () => {
    const { start, end } = dayBoundsRome(new Date('2026-10-31T12:00:00Z'))
    assert.equal(toRomeDateStr(start), '2026-10-31')
    assert.equal(toRomeDateStr(end), '2026-11-01')
    // Lo stesso istante che chiude ottobre apre novembre.
    assert.equal(end.toISOString(), monthBoundsRome('2026-11').start.toISOString())
})

test('il primo giorno del mese apre esattamente dove apre il mese', () => {
    const { start } = dayBoundsRome(new Date('2026-10-01T12:00:00Z'))
    assert.equal(start.toISOString(), monthBoundsRome('2026-10').start.toISOString())
})

test('la settimana del cambio ora va da lunedi a lunedi, non "start + 7 giorni"', () => {
    // Settimana 19-25/10/2026: la domenica 25 dura 25 ore, quindi la settimana
    // ne dura 169. Stesso risultato da qualunque giorno della settimana.
    for (const istante of ['2026-10-19T08:00:00Z', '2026-10-22T14:00:00Z', '2026-10-25T15:00:00Z']) {
        const { start, end } = weekBoundsRome(new Date(istante))
        assert.equal(start.toISOString(), '2026-10-18T22:00:00.000Z', istante)
        assert.equal(end.toISOString(), '2026-10-25T23:00:00.000Z', istante)
        assert.equal(ORE(end.getTime() - start.getTime()), 169, istante)
    }
})

test('la settimana del cambio ora di primavera dura 167 ore', () => {
    const { start, end } = weekBoundsRome(new Date('2026-03-29T15:00:00Z'))
    assert.equal(start.toISOString(), '2026-03-22T23:00:00.000Z')
    assert.equal(end.toISOString(), '2026-03-29T22:00:00.000Z')
    assert.equal(ORE(end.getTime() - start.getTime()), 167)
})

test('la fine di una settimana e l inizio della successiva', () => {
    const questa = weekBoundsRome(new Date('2026-10-22T14:00:00Z'))
    const prossima = weekBoundsRome(new Date('2026-10-28T14:00:00Z'))
    assert.equal(questa.end.toISOString(), prossima.start.toISOString())
    assert.equal(questa.end.toISOString(), dayBoundsRome(new Date('2026-10-26T12:00:00Z')).start.toISOString())
})
