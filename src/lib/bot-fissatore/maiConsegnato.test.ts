import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    eMaiConsegnatoDaNonRidare, etichettaInstradato, isWhatsappMaiConsegnato, instradamentoRidato, lettoDalCorpo, motivoParcheggio,
} from './maiConsegnato'

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

// Titolare 19/11/2026: il WhatsApp mai consegnato rende il 2%, non va più ai GDO.
test('mai consegnato non Black Friday -> parcheggiato', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT_SENZA_CODICE), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT, null, 'JOB SIMULATOR'), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT, false, null), 'parcheggia')
    // Anche se il bot dicesse "letto": un messaggio mai consegnato non è stato letto.
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT, true, 'TELEGRAM'), 'parcheggia')
})

test('mai consegnato Black Friday -> giro GDO come prima (PO 07/11)', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT, null, 'BLACK FRIDAY'), 'giro_gdo')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_BOT_SENZA_CODICE, false, ' black friday '), 'giro_gdo')
})

test('etichetta instradato: mai consegnato sempre riconoscibile, anche parcheggiato', () => {
    assert.equal(etichettaInstradato('mai_risposto', NOTA_BOT, null, 'parcheggia'), 'mai_consegnato')
    assert.equal(etichettaInstradato('mai_risposto', NOTA_BOT, null, 'giro_gdo'), 'mai_consegnato')
    // Gli altri come prima: etichetta solo se vanno al giro.
    assert.equal(etichettaInstradato('mai_risposto', NOTA_MAI_RISPOSTO, true, 'giro_gdo'), 'letto')
    assert.equal(etichettaInstradato('mai_risposto', NOTA_MAI_RISPOSTO, null, 'giro_gdo'), 'black_friday')
    assert.equal(etichettaInstradato('mai_risposto', NOTA_MAI_RISPOSTO, false, 'parcheggia'), null)
    assert.equal(etichettaInstradato('chat_interrotta', NOTA_BOT, null, 'giro_gdo'), null)
    assert.equal(etichettaInstradato('rifiutato_dal_bot', null, null, 'giro_gdo'), null)
})

test('motivo del parcheggio: mai consegnato distinto dal mai risposto', () => {
    assert.equal(motivoParcheggio(NOTA_BOT), 'wa_mai_consegnato')
    assert.equal(motivoParcheggio(NOTA_MAI_RISPOSTO), 'mai_risposto_al_bot')
    assert.equal(motivoParcheggio(null), 'mai_risposto_al_bot')
})

test('accantonato mai consegnato: non si ridà ai GDO, salvo Black Friday', () => {
    const l = { ultimoInstradato: null, motivoAccantonamento: null } as { ultimoInstradato: string | null; motivoAccantonamento: string | null; funnel?: string | null }
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, ultimoInstradato: 'mai_consegnato' }), true)
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, motivoAccantonamento: 'wa_mai_consegnato_19_11' }), true)
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, motivoAccantonamento: 'wa_mai_consegnato' }), true)
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, ultimoInstradato: 'mai_consegnato', funnel: 'BLACK FRIDAY' }), false)
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, ultimoInstradato: 'letto', motivoAccantonamento: 'mai_risposto_al_bot' }), false)
    assert.equal(eMaiConsegnatoDaNonRidare({ ...l, motivoAccantonamento: 'ridati_oltre_8gg_serale' }), false)
    assert.equal(eMaiConsegnatoDaNonRidare(l), false)
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
