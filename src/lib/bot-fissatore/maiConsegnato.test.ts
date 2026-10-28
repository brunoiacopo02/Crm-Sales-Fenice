import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWhatsappMaiConsegnato, instradamentoRidato } from './maiConsegnato'

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
