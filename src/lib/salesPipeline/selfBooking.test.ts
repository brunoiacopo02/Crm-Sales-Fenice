import test from 'node:test'
import assert from 'node:assert/strict'
import { selfBookingCheck } from './selfBooking'

// Mercoledi 23 settembre 2026, ore 16 italiane.
const at = new Date('2026-09-23T16:00:00+02:00')
const slot = new Date('2026-09-23T16:00:00+02:00')

test('ora libera: si fissa', () => {
    assert.deepEqual(selfBookingCheck({ slot, blocked: false, occupied: false, at }), { ok: true })
})

test("un'ora NON dichiarata si puo comunque fissare: e il suo calendario", () => {
    // La differenza voluta rispetto al muro delle Conferme: qui 'non_dichiarato'
    // non esiste come rifiuto, perche' il venditore non deve andare a compilare
    // la griglia mentre ha il cliente al telefono.
    assert.deepEqual(selfBookingCheck({ slot, blocked: false, occupied: false, at }), { ok: true })
})

test('ora gia occupata: blocco secco', () => {
    const d = selfBookingCheck({ slot, blocked: false, occupied: true, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'gia_occupato')
    assert.match(d.ok === false ? d.message : '', /16:00/)
})

test('ora bloccata dal venditore: blocco secco', () => {
    const d = selfBookingCheck({ slot, blocked: true, occupied: false, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'bloccato')
})

test('fuori dalla griglia (domenica o notte): blocco secco', () => {
    const d = selfBookingCheck({ slot: null, blocked: false, occupied: false, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'fuori_griglia')
})

test('bloccata E occupata: vince "bloccato", la causa piu a monte', () => {
    // L'ordine dei controlli e' quello di bookingCheck e va conservato: chi
    // legge deve vedere il problema vero (ha bloccato l'ora) e non il suo
    // effetto collaterale.
    const d = selfBookingCheck({ slot, blocked: true, occupied: true, at })
    assert.equal(d.ok === false && d.reason, 'bloccato')
})
