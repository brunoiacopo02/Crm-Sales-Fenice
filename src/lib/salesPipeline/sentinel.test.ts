import test from 'node:test'
import assert from 'node:assert/strict'
import { SELF_BOOKED_OUTCOME, isSelfBooked } from './sentinel'

test('la sentinella e la stringa esatta attesa dal DB', () => {
    assert.equal(SELF_BOOKED_OUTCOME, 'autofissato')
})

test('riconosce solo la sentinella', () => {
    assert.equal(isSelfBooked('autofissato'), true)
    assert.equal(isSelfBooked('confermato'), false)
    assert.equal(isSelfBooked('scartato'), false)
    assert.equal(isSelfBooked(null), false)
    assert.equal(isSelfBooked(undefined), false)
    assert.equal(isSelfBooked(''), false)
})
