import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daRifissareDalleConferme, dividiRifissaggi, notaConfermePerGdo } from './daRifissare'

const base = { status: 'APPOINTMENT', appointmentDate: null, confNeedsReschedule: true, confirmationsOutcome: null }

test('da rifissare: senza data, messo da rifissare dalle Conferme e senza esito', () => {
    assert.equal(daRifissareDalleConferme(base), true)
    // caso Eleonora (29/10/2026): appointmentDate azzerata, stato APPOINTMENT
    assert.equal(daRifissareDalleConferme({ ...base, confirmationsOutcome: '' }), true)
})

test('non è da rifissare: già scartato, confermato, con data o non messo dalle Conferme', () => {
    assert.equal(daRifissareDalleConferme({ ...base, confirmationsOutcome: 'scartato' }), false)
    assert.equal(daRifissareDalleConferme({ ...base, confirmationsOutcome: 'confermato' }), false)
    assert.equal(daRifissareDalleConferme({ ...base, appointmentDate: new Date() }), false)
    assert.equal(daRifissareDalleConferme({ ...base, confNeedsReschedule: false }), false)
    assert.equal(daRifissareDalleConferme({ ...base, confNeedsReschedule: null }), false)
    assert.equal(daRifissareDalleConferme({ ...base, status: 'REJECTED' }), false)
})

test('dividiRifissaggi: prima i richiami delle Conferme per data, poi il resto nel suo ordine', () => {
    const lista = [
        { id: 's1', ...base, confirmationsOutcome: 'scartato', recallDate: null },
        { id: 'a2', ...base, recallDate: '2026-11-02T18:00:00Z' },
        { id: 'a0', ...base, recallDate: null },
        { id: 'a1', ...base, recallDate: new Date('2026-10-30T10:00:00Z') },
        { id: 's2', ...base, confirmationsOutcome: 'scartato', recallDate: '2026-10-01T10:00:00Z' },
    ]
    const { attivi, altri } = dividiRifissaggi(lista)
    assert.deepEqual(attivi.map(l => l.id), ['a1', 'a2', 'a0'])
    assert.deepEqual(altri.map(l => l.id), ['s1', 's2'])
})

test('nota delle Conferme per il GDO: vuota o che nomina il bot non si mostra', () => {
    assert.equal(notaConfermePerGdo('  Richiamare lunedì, era fuori casa '), 'Richiamare lunedì, era fuori casa')
    assert.equal(notaConfermePerGdo(''), null)
    assert.equal(notaConfermePerGdo(null), null)
    assert.equal(notaConfermePerGdo('ha scritto in chat che è impegnata'), null)
    assert.equal(notaConfermePerGdo('il bot ha già mandato il video'), null)
})
