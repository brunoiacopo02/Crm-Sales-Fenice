import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNotaBotRipreso, ripresaSuLeadDiUnaPersona, ripresaVaAlGdo } from './ripresaChat'

// Testo reale del bot (lib/bot-outcome-rules.ts, buildBotRipresoNote).
const NOTA = 'IL BOT HA RIPRESO LA CHAT — il lead ha riscritto dopo che ve lo avevamo restituito come NON_RISPOSTO. Ha riscritto 29/10 alle 11:02. Non chiamatelo a mano finché non vi arriva un nuovo esito dal bot.'

const base = {
    assignedToId: null as string | null, status: 'NEW', appointmentDate: null as Date | null, presentedAt: null as Date | null,
    launchBucket: null as string | null, funnel: 'CORSO 10 ORE' as string | null, lancioPool: null as string | null,
    humanTestCohort: null as string | null, isTest: false, intakeBatch: null as string | null,
}

test('riconosce la nota "il bot ha ripreso la chat"', () => {
    assert.equal(isNotaBotRipreso(NOTA), true)
    assert.equal(isNotaBotRipreso('  il bot ha ripreso la chat - ...'), true)
    assert.equal(isNotaBotRipreso('VOLEVA ESSERE RISENTITO: ...'), false)
    assert.equal(isNotaBotRipreso(null), false)
    assert.equal(isNotaBotRipreso('Il lead dice: il bot ha ripreso la chat'), false)
})

test('lead parcheggiato che riscrive -> a un GDO', () => {
    assert.equal(ripresaVaAlGdo(base), true)
    assert.equal(ripresaVaAlGdo({ ...base, status: 'IN_PROGRESS' }), true)
})

test('lead già di qualcuno, chiuso, fissato, del lancio o di prova -> resta dov\'è', () => {
    assert.equal(ripresaVaAlGdo({ ...base, assignedToId: 'gdo' }), false)
    assert.equal(ripresaVaAlGdo({ ...base, status: 'REJECTED' }), false)
    assert.equal(ripresaVaAlGdo({ ...base, status: 'APPOINTMENT' }), false)
    assert.equal(ripresaVaAlGdo({ ...base, appointmentDate: new Date() }), false)
    assert.equal(ripresaVaAlGdo({ ...base, presentedAt: new Date() }), false)
    assert.equal(ripresaVaAlGdo({ ...base, launchBucket: 'LANCIO_WEBDEV_2026' }), false)
    assert.equal(ripresaVaAlGdo({ ...base, lancioPool: 'VERGINI' }), false)
    assert.equal(ripresaVaAlGdo({ ...base, isTest: true }), false)
    assert.equal(ripresaVaAlGdo({ ...base, intakeBatch: 'DB_LISTA133_20260915' }), false)
})

test('nota "ripreso" su un lead di una persona -> ignorata (PO 31/10)', () => {
    const NUOVA = 'IL BOT HA RIPRESO LA CHAT — IL LEAD HA RISCRITTO SU WHATSAPP: «ci sono». Il lead è vostro: richiamatelo.'
    assert.equal(ripresaSuLeadDiUnaPersona(NOTA, 'gdo-105', false), true)
    assert.equal(ripresaSuLeadDiUnaPersona(NUOVA, 'gdo-105', false), true)
    // senza assegnatario: resta il salvataggio ai ridati con stella
    assert.equal(ripresaSuLeadDiUnaPersona(NOTA, null, false), false)
    // sull'account bot: come prima
    assert.equal(ripresaSuLeadDiUnaPersona(NOTA, 'bot-201', true), false)
    // le altre note sui lead dei GDO restano
    assert.equal(ripresaSuLeadDiUnaPersona('SPOSTAMENTO CHIESTO — il lead ha chiesto di spostare', 'gdo-105', false), false)
    assert.equal(ripresaSuLeadDiUnaPersona('DISDETTA — non viene', 'gdo-105', false), false)
})
