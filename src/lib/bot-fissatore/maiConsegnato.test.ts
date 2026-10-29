import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWhatsappMaiConsegnato, instradamentoRidato, lettoDalCorpo } from './maiConsegnato'

// Note reali del bot (leadEvents REASSIGNED_FROM_BOT dal 19/10/2026).
const NOTA_BOT = 'WhatsApp mai consegnato (numero senza WhatsApp, errore Twilio 63024: 1 messaggio inviati, nessuno arrivato). Il numero può essere valido: chiamare a voce.'
const NOTA_BOT_SENZA_CODICE = 'WhatsApp mai consegnato (1 messaggio inviati, nessuno arrivato). Il numero può essere valido: chiamare a voce.'
const NOTA_MAI_RISPOSTO = 'Sequenza completa: 1 messaggi consegnati, mai una risposta. Da provare a voce.'

test('nota del bot "WhatsApp mai consegnato" riconosciuta', () => {
    assert.equal(isWhatsappMaiConsegnato(NOTA_BOT), true)
    assert.equal(isWhatsappMaiConsegnato(NOTA_BOT_SENZA_CODICE), true)
    assert.equal(isWhatsappMaiConsegnato('  whatsapp mai consegnato, chiamare a voce'), true)
    assert.equal(isWhatsappMaiConsegnato('Whats App mai consegnata'), true)
    assert.equal(isWhatsappMaiConsegnato('WhatsApp: mai consegnato'), true)
})

test('note qualsiasi o vuote non sono "mai consegnato"', () => {
    assert.equal(isWhatsappMaiConsegnato(null), false)
    assert.equal(isWhatsappMaiConsegnato(undefined), false)
    assert.equal(isWhatsappMaiConsegnato(''), false)
    assert.equal(isWhatsappMaiConsegnato(NOTA_MAI_RISPOSTO), false)
    assert.equal(isWhatsappMaiConsegnato('Mai risposto dopo 3 messaggi'), false)
    assert.equal(isWhatsappMaiConsegnato('Il lead dice: WhatsApp mai consegnato?'), false)
    assert.equal(isWhatsappMaiConsegnato('WhatsApp consegnato, mai letto'), false)
})

test('mai consegnato -> giro GDO', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT), 'giro_gdo')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT_SENZA_CODICE), 'giro_gdo')
})

test('mai risposto normale -> parcheggiato', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', null), 'parcheggia')
})

test('chat interrotta -> giro GDO, qualunque nota', () => {
    assert.equal(instradamentoRidato('chat_interrotta', null), 'giro_gdo')
    assert.equal(instradamentoRidato('chat_interrotta', NOTA_BOT), 'giro_gdo')
})

// PO 29/10/2026: chi ha LETTO il messaggio del bot e non ha risposto va ai GDO.
test('mai risposto ma letto -> giro GDO', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, true), 'giro_gdo')
    assert.equal(instradamentoRidato('mai_risposto', null, true), 'giro_gdo')
})

test('mai risposto non letto o senza il dato -> parcheggiato come prima', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, false), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, null), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, undefined), 'parcheggia')
})

test('letto valido solo se booleano vero', () => {
    assert.equal(lettoDalCorpo(true), true)
    assert.equal(lettoDalCorpo(false), false)
    assert.equal(lettoDalCorpo('true'), null)
    assert.equal(lettoDalCorpo(1), null)
    assert.equal(lettoDalCorpo(undefined), null)
})
