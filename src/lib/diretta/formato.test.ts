import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    numeroIt, numeroItFino, numeroConSegno, euroIt, partiRoma, oraRoma, giornoMeseRoma, dataOraRoma,
    dataBreveRoma, dataOraBreveRoma, giornoMeseLungo, meseLungo,
} from './formato'

test('numeri: punto delle migliaia anche a quattro cifre (Node scriveva 3030, il browser 3.030)', () => {
    assert.equal(numeroIt(0), '0')
    assert.equal(numeroIt(999), '999')
    assert.equal(numeroIt(3030), '3.030')
    assert.equal(numeroIt(6400), '6.400')
    assert.equal(numeroIt(1234567), '1.234.567')
    assert.equal(numeroIt(-2600), '-2.600')
    assert.equal(numeroIt(12.5, 1), '12,5')
    assert.equal(numeroIt(1234.567, 2), '1.234,57')
    assert.equal(numeroIt(4.4, 0), '4')
    assert.equal(numeroIt(-0.2), '0')
    assert.equal(numeroIt(Number.NaN), '0')
    assert.equal(numeroIt(Number.POSITIVE_INFINITY), '0')
})

test('numeri coi decimali solo se servono (maximumFractionDigits)', () => {
    assert.equal(numeroItFino(12, 1), '12')
    assert.equal(numeroItFino(12.5, 1), '12,5')
    assert.equal(numeroItFino(12.54, 1), '12,5')
    assert.equal(numeroItFino(1234.5, 2), '1.234,5')
    assert.equal(numeroItFino(0.126, 2), '0,13')
    assert.equal(numeroItFino(-3.04, 1), '-3')
    assert.equal(numeroItFino(Number.NaN, 2), '0')
})

test('numeri col segno ed euro', () => {
    assert.equal(numeroConSegno(10), '+10')
    assert.equal(numeroConSegno(-2), '-2')
    assert.equal(numeroConSegno(0), '0')
    assert.equal(numeroConSegno(1500), '+1.500')
    assert.equal(euroIt(12), '12 €')
    assert.equal(euroIt(1234), '1.234 €')
    assert.equal(euroIt(12.5), '12,50 €')
    assert.equal(euroIt(0), '0 €')
})

test('date in ora di Roma: ora solare e legale', () => {
    // Lunedì 26/10/2026, primo giorno di ora solare: 14:30 UTC = 15:30 di Roma.
    const solare = new Date('2026-10-26T14:30:00Z')
    assert.deepEqual(partiRoma(solare), { anno: 2026, mese: 10, giorno: 26, ora: 15, minuto: 30 })
    assert.equal(oraRoma(solare), '15:30')
    assert.equal(giornoMeseRoma(solare), '26/10')
    assert.equal(dataOraRoma(solare), '26/10, 15:30')
    assert.equal(dataBreveRoma(solare), '26 ott')
    assert.equal(dataOraBreveRoma(solare), '26 ott, 15:30')
    // Sabato 24/10/2026, ancora ora legale: 16:10 UTC = 18:10 di Roma.
    assert.equal(dataOraRoma(new Date('2026-10-24T16:10:00Z')), '24/10, 18:10')
    // Mezzanotte di Roma: il giorno è quello di Roma, non quello UTC.
    assert.equal(dataOraRoma(new Date('2026-10-25T23:05:00Z')), '26/10, 00:05')
})

test('giorni e mesi in lettere', () => {
    assert.equal(giornoMeseLungo('2026-10-12'), '12 ottobre')
    assert.equal(giornoMeseLungo('2027-01-01'), '1 gennaio')
    assert.equal(meseLungo(12), 'dicembre')
})
