import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookingCheck, bookingRefusalMessage } from './calendarBooking'
import { slotStartFor } from './calendarSlots'

const SLOT = slotStartFor(new Date('2026-09-16T15:00:00+02:00'))

test('si fissa su uno slot dichiarato e non bloccato', () => {
    assert.deepEqual(bookingCheck({ slot: SLOT, declared: true, blocked: false }), { ok: true })
})

test('non si fissa su uno slot mai dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: false, blocked: false })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'non_dichiarato')
})

test('non si fissa su uno slot bloccato, nemmeno se dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: true, blocked: true })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'bloccato')
})

test('un orario fuori griglia non e mai disponibile', () => {
    // slotStartFor torna null per le 22, per le 8 e per la domenica.
    for (const fuori of ['2026-09-16T22:00:00+02:00', '2026-09-16T08:00:00+02:00', '2026-09-20T15:00:00+02:00']) {
        const d = bookingCheck({ slot: slotStartFor(new Date(fuori)), declared: true, blocked: false })
        assert.equal(d.ok, false, fuori)
        assert.equal(d.ok === false && d.reason, 'fuori_griglia', fuori)
    }
})

test('i messaggi dicono l ora e sono leggibili da una Conferma', () => {
    const at = new Date('2026-09-16T15:00:00+02:00')
    assert.match(bookingRefusalMessage('non_dichiarato', at), /15:00/)
    assert.match(bookingRefusalMessage('bloccato', at), /15:00/)
    assert.ok(bookingRefusalMessage('fuori_griglia', at).length > 20)
})
