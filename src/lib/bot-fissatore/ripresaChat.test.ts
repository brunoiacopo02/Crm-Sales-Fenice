import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNotaBotRipreso, ripresaVaAlGdo } from './ripresaChat'

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
