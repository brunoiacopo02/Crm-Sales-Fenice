import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ignoraEsitoSuScartato } from './esitoSuScartato'

test('su un lead scartato si ignorano solo gli esiti di stato', () => {
    for (const o of ['NON_RISPOSTO', 'INTERROTTO', 'RICHIAMO', 'DA_SCARTARE']) assert.equal(ignoraEsitoSuScartato('REJECTED', o), true, o)
    for (const o of ['APPUNTAMENTO', 'NOTA', 'CONTATTO_UMANO', 'SPOSTAMENTO', 'DISDETTA_VERIFICATA']) assert.equal(ignoraEsitoSuScartato('REJECTED', o), false, o)
})

test('su un lead aperto o in appuntamento non cambia niente', () => {
    for (const s of ['NEW', 'IN_PROGRESS', 'APPOINTMENT', null, undefined]) assert.equal(ignoraEsitoSuScartato(s, 'NON_RISPOSTO'), false, String(s))
})
