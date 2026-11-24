import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    giorniAmmessiAppuntamento, appuntamentoAmmesso, controllaAppuntamentoGdo, messaggioFinestraAppuntamento,
} from './appointmentWindow'

// Settimana del 23/11/2026: lun 23, mar 24, mer 25, gio 26, ven 27, sab 28, dom 29, lun 30, mar 1/12.
const A = (iso: string) => new Date(iso)

test('i sette giorni della settimana', () => {
    const casi: [string, [string, string]][] = [
        ['2026-11-23T10:00:00Z', ['2026-11-24', '2026-11-25']], // lun -> mar, mer
        ['2026-11-24T10:00:00Z', ['2026-11-25', '2026-11-26']], // mar -> mer, gio
        ['2026-11-25T10:00:00Z', ['2026-11-26', '2026-11-27']], // mer -> gio, ven
        ['2026-11-26T10:00:00Z', ['2026-11-27', '2026-11-28']], // gio -> ven, sab
        ['2026-11-27T10:00:00Z', ['2026-11-28', '2026-11-30']], // ven -> sab, lun
        ['2026-11-28T10:00:00Z', ['2026-11-30', '2026-12-01']], // sab -> lun, mar
        ['2026-11-29T10:00:00Z', ['2026-11-30', '2026-12-01']], // dom -> lun, mar
    ]
    for (const [now, atteso] of casi) assert.deepEqual(giorniAmmessiAppuntamento(A(now)), atteso, now)
})

test('mezzanotte: conta il giorno di Roma, non quello UTC', () => {
    // 23:30 a Roma di mar 24/11 (CET, +1) = 22:30Z: oggi e' ancora il 24.
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-11-24T22:30:00Z')), ['2026-11-25', '2026-11-26'])
    // 00:30 a Roma di mer 25/11 = 23:30Z del 24: oggi e' gia' il 25.
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-11-24T23:30:00Z')), ['2026-11-26', '2026-11-27'])
    // Estate (+2): 23:30 Roma di sab 18/07/2026 = 21:30Z; 00:30 Roma di dom 19 = 22:30Z del 18.
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-07-18T21:30:00Z')), ['2026-07-20', '2026-07-21'])
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-07-18T22:30:00Z')), ['2026-07-20', '2026-07-21'])
})

test('cambio ora solare (25/10/2026) e legale (29/03/2026)', () => {
    // sab 24/10 -> lun 26, mar 27 (il 25 e' domenica e giorno da 25 ore)
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-10-24T12:00:00Z')), ['2026-10-26', '2026-10-27'])
    // ven 27/03 -> sab 28, lun 30 (salta dom 29, giorno da 23 ore)
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-03-27T12:00:00Z')), ['2026-03-28', '2026-03-30'])
    // sab 28/03 alle 23:30 Roma (22:30Z) -> lun 30, mar 31
    assert.deepEqual(giorniAmmessiAppuntamento(A('2026-03-28T22:30:00Z')), ['2026-03-30', '2026-03-31'])
})

test('oggi, domani, dopodomani, terzo giorno, passato, domenica', () => {
    const now = A('2026-11-24T10:00:00Z') // martedi
    assert.equal(appuntamentoAmmesso('2026-11-24T15:00', now), false) // oggi
    assert.equal(appuntamentoAmmesso('2026-11-23T15:00', now), false) // passato
    assert.equal(appuntamentoAmmesso('2026-11-25T15:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-11-26T15:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-11-27T15:00', now), false) // terzo giorno
    assert.equal(appuntamentoAmmesso('2026-11-29T15:00', now), false) // domenica
})

test('sabato: lunedi e martedi, non domenica', () => {
    const now = A('2026-11-28T09:00:00Z')
    assert.equal(appuntamentoAmmesso('2026-11-29T11:00', now), false)
    assert.equal(appuntamentoAmmesso('2026-11-30T11:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-12-01T11:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-12-02T11:00', now), false)
})

test('venerdi: sabato e lunedi', () => {
    const now = A('2026-11-27T09:00:00Z')
    assert.equal(appuntamentoAmmesso('2026-11-28T11:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-11-29T11:00', now), false)
    assert.equal(appuntamentoAmmesso('2026-11-30T11:00', now), true)
    assert.equal(appuntamentoAmmesso('2026-12-01T11:00', now), false)
})

test('un istante (Date) si legge nel giorno di Roma', () => {
    const now = A('2026-11-24T10:00:00Z')
    // 25/11 00:30 Roma = 24/11 23:30Z: e' il 25, ammesso (in UTC sarebbe oggi).
    assert.equal(appuntamentoAmmesso(A('2026-11-24T23:30:00Z'), now), true)
    // 24/11 23:30 Roma = 22:30Z: e' oggi, rifiutato.
    assert.equal(appuntamentoAmmesso(A('2026-11-24T22:30:00Z'), now), false)
    // 27/11 00:30 Roma = 26/11 23:30Z: terzo giorno, rifiutato (in UTC sarebbe il 26).
    assert.equal(appuntamentoAmmesso(A('2026-11-26T23:30:00Z'), now), false)
})

test('messaggio di errore in italiano con i due giorni', () => {
    assert.equal(messaggioFinestraAppuntamento(A('2026-11-24T10:00:00Z')), "L'appuntamento si può fissare solo per mercoledì 25/11 o giovedì 26/11.")
    assert.equal(messaggioFinestraAppuntamento(A('2026-11-28T10:00:00Z')), "L'appuntamento si può fissare solo per lunedì 30/11 o martedì 01/12.")
})

test('controllaAppuntamentoGdo: errore solo se fuori finestra, data non valida rifiutata', () => {
    const now = A('2026-11-24T10:00:00Z')
    assert.deepEqual(controllaAppuntamentoGdo('2026-11-25T10:00', now), { ok: true })
    assert.equal(controllaAppuntamentoGdo('2026-11-24T10:00', now).ok, false)
    assert.equal(controllaAppuntamentoGdo('', now).ok, false)
    assert.equal(controllaAppuntamentoGdo(new Date('x'), now).ok, false)
})
