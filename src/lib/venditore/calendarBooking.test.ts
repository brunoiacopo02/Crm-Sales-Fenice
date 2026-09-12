import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookingCheck, bookingRefusalMessage, forceReasonProblem } from './calendarBooking'
import { slotStartFor } from './calendarSlots'

const SLOT = slotStartFor(new Date('2026-09-16T15:00:00+02:00'))

test('si fissa su uno slot dichiarato e non bloccato', () => {
    assert.deepEqual(bookingCheck({ slot: SLOT, declared: true, blocked: false, occupied: false }), { ok: true })
})

test('non si fissa su uno slot mai dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: false, blocked: false, occupied: false })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'non_dichiarato')
})

test('non si fissa su uno slot bloccato, nemmeno se dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: true, blocked: true, occupied: false })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'bloccato')
})

test('un orario fuori griglia non e mai disponibile', () => {
    // slotStartFor torna null per le 22, per le 8 e per la domenica.
    for (const fuori of ['2026-09-16T22:00:00+02:00', '2026-09-16T08:00:00+02:00', '2026-09-20T15:00:00+02:00']) {
        const d = bookingCheck({ slot: slotStartFor(new Date(fuori)), declared: true, blocked: false, occupied: false })
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

test('non si fissa dove il venditore ha gia un appuntamento', () => {
    const slot = new Date('2026-09-15T14:00:00.000Z')
    const out = bookingCheck({ slot, declared: true, blocked: false, occupied: true })
    assert.deepEqual(out, { ok: false, reason: 'gia_occupato' })
})

test('il blocco vince sull occupato nel messaggio (ordine: griglia, dichiarato, bloccato, occupato)', () => {
    const slot = new Date('2026-09-15T14:00:00.000Z')
    assert.deepEqual(bookingCheck({ slot, declared: false, blocked: true, occupied: true }), { ok: false, reason: 'non_dichiarato' })
    assert.deepEqual(bookingCheck({ slot, declared: true, blocked: true, occupied: true }), { ok: false, reason: 'bloccato' })
})

test('il messaggio dell ora gia occupata lo dice a chiare lettere', () => {
    const at = new Date('2026-09-16T15:00:00+02:00')
    assert.match(bookingRefusalMessage('gia_occupato', at), /già un appuntamento/)
    assert.match(bookingRefusalMessage('gia_occupato', at), /15:00/)
})

test('il rifiuto elenca le ore libere di quel giorno, o dice che non ce ne sono', () => {
    const at = new Date('2026-09-16T15:00:00+02:00')
    const conOre = bookingRefusalMessage('non_dichiarato', at, ['10:00', '17:00'])
    assert.match(conOre, /libero alle 10:00, 17:00/)
    const senzaOre = bookingRefusalMessage('non_dichiarato', at, [])
    assert.match(senzaOre, /un altro giorno o un altro venditore/)
    // Fuori griglia non e' un problema di ore libere: nessuna coda inutile.
    assert.doesNotMatch(bookingRefusalMessage('fuori_griglia', at, []), /un altro giorno o un altro venditore/)
})

test('un motivo di forzatura di una parola non basta', () => {
    assert.ok(forceReasonProblem('.'))
    assert.ok(forceReasonProblem('   '))
    assert.ok(forceReasonProblem(null))
    assert.ok(forceReasonProblem(undefined))
    assert.ok(forceReasonProblem('ok grazie'))          // 9 caratteri
    assert.equal(forceReasonProblem('cliente disponibile solo a quest ora'), null)
    assert.equal(forceReasonProblem('  mi serve ora  '), null)  // conta il trim, non gli spazi
})
