import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TARGETS } from './config'
import { validaObiettivi } from './validaObiettivi'

test('i default passano invariati', () => {
    const r = validaObiettivi(DEFAULT_TARGETS)
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.value, DEFAULT_TARGETS)
})

test('numeri arrivati come stringhe dal form', () => {
    const r = validaObiettivi({ ...DEFAULT_TARGETS, personale: ['9', '11'], euroPerPresenza: '15' })
    assert.equal(r.ok, true)
    if (r.ok) {
        assert.deepEqual(r.value.personale, [9, 11])
        assert.equal(r.value.euroPerPresenza, 15)
    }
})

test('scalini rovesciati o non interi', () => {
    assert.equal(validaObiettivi({ ...DEFAULT_TARGETS, squadra: [65, 55] }).ok, false)
    assert.equal(validaObiettivi({ ...DEFAULT_TARGETS, punta: [14.5, 20] }).ok, false)
    assert.equal(validaObiettivi({ ...DEFAULT_TARGETS, personale: [8] }).ok, false)
})

test('fasce e pause: formato e ordine', () => {
    assert.equal(validaObiettivi({ ...DEFAULT_TARGETS, puntaFeriale: { start: '19:00', end: '18:00' } }).ok, false)
    assert.equal(validaObiettivi({ ...DEFAULT_TARGETS, turnoSabato: { start: '10', end: '16:30' } }).ok, false)
    const r = validaObiettivi({ ...DEFAULT_TARGETS, pauseSabato: [{ start: '13:00', end: '13:15' }, { start: '11:30', end: '11:40' }] })
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.value.pauseSabato.map(p => p.start), ['11:30', '13:00'])
})

test('chiavi sconosciute ignorate, mancanti respinte', () => {
    const r = validaObiettivi({ ...DEFAULT_TARGETS, extra: 'x' })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal('extra' in r.value, false)
    assert.equal(validaObiettivi({ personale: [8, 10] }).ok, false)
    assert.equal(validaObiettivi(null).ok, false)
})
