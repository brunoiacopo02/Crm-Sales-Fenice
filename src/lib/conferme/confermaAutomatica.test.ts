import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isConfermaAutomatica } from './confermaAutomatica'

const bot = new Set(['bot-201'])

test('conferma firmata dal bot del lancio: automatica', () => {
    assert.equal(isConfermaAutomatica({ confirmationsOutcome: 'confermato', confirmationsUserId: 'bot-201' }, bot), true)
})

test('conferma firmata da un operatore delle Conferme: non automatica', () => {
    assert.equal(isConfermaAutomatica({ confirmationsOutcome: 'confermato', confirmationsUserId: 'alberto' }, bot), false)
})

test('scarto del bot (disdetta verificata): non e\' una conferma', () => {
    assert.equal(isConfermaAutomatica({ confirmationsOutcome: 'scartato', confirmationsUserId: 'bot-201' }, bot), false)
})

test('conferma senza firmatario: non automatica', () => {
    assert.equal(isConfermaAutomatica({ confirmationsOutcome: 'confermato', confirmationsUserId: null }, bot), false)
})
