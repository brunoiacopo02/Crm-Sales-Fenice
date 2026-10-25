import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    notificaAppenaArrivato, idNotificaAppenaArrivato, TIPO_NOTIFICA_APPENA_ARRIVATO, TITOLO_APPENA_ARRIVATO,
} from './notificaArrivo'
import { PAROLE_VIETATE } from './vistaGdo'

const arrivo = { leadId: 'lead-1', gdoId: 'gdo-105', nome: 'Mario Rossi', funnel: 'CORSO 10 ORE', companyId: 'fenice' }

test('notifica appena arrivato: al GDO, con il lead nei metadata per aprirlo', () => {
    const n = notificaAppenaArrivato(arrivo)
    assert.equal(n.recipientUserId, 'gdo-105')
    assert.equal(n.type, TIPO_NOTIFICA_APPENA_ARRIVATO)
    assert.equal(n.title, 'Appena arrivato: chiamalo subito')
    assert.equal(n.title, TITOLO_APPENA_ARRIVATO)
    assert.equal(n.body, 'Mario Rossi è in cima alla prima chiamata.')
    assert.deepEqual(n.metadata, { leadId: 'lead-1', coda: 'first', funnel: 'CORSO 10 ORE' })
    assert.equal(n.companyId, 'fenice')
})

test('notifica appena arrivato: idempotente, stesso lead e stesso GDO danno lo stesso id', () => {
    assert.equal(notificaAppenaArrivato(arrivo).id, notificaAppenaArrivato({ ...arrivo, nome: 'altro' }).id)
    assert.equal(notificaAppenaArrivato(arrivo).id, idNotificaAppenaArrivato('lead-1', 'gdo-105'))
    assert.notEqual(idNotificaAppenaArrivato('lead-1', 'gdo-105'), idNotificaAppenaArrivato('lead-1', 'gdo-106'))
    assert.notEqual(idNotificaAppenaArrivato('lead-1', 'gdo-105'), idNotificaAppenaArrivato('lead-2', 'gdo-105'))
})

test('notifica appena arrivato: sobria, niente bot, niente emoji, niente telefono', () => {
    const n = notificaAppenaArrivato({ ...arrivo, nome: '  ' })
    assert.equal(n.body, 'Un lead nuovo è in cima alla prima chiamata.')
    for (const t of [n.title, n.body]) {
        assert.equal(PAROLE_VIETATE.test(t), false, t)
        assert.equal(/\p{Extended_Pictographic}/u.test(t), false, t)
        assert.equal(/\d{6,}/.test(t), false, t)
    }
})
