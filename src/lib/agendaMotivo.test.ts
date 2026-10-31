import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoAgenda, MESSAGGIO_NUMERO_SENZA_WHATSAPP } from './agendaMotivo'

test('motivoAgenda: riconosce il numero senza WhatsApp', () => {
    assert.equal(motivoAgenda('numero_senza_whatsapp'), 'numero_senza_whatsapp')
})

test('motivoAgenda: assente, sconosciuto o non stringa → nessun motivo (risposte vecchie invariate)', () => {
    assert.equal(motivoAgenda(undefined), undefined)
    assert.equal(motivoAgenda(null), undefined)
    assert.equal(motivoAgenda('template_bloccato'), undefined)
    assert.equal(motivoAgenda(63024), undefined)
})

test('il messaggio al GDO non cita bot né codici tecnici', () => {
    assert.doesNotMatch(MESSAGGIO_NUMERO_SENZA_WHATSAPP, /bot|63024|twilio/i)
    assert.match(MESSAGGIO_NUMERO_SENZA_WHATSAPP, /non ha WhatsApp/)
})
