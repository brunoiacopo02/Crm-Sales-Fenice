import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    romeHour, leadsInHour, nrCounts, applyNrFilter, snoozedOf, sortRichiami,
    filterStorico, storicoCounts, callsMade, gdoName, collegaName, type BoardLead,
} from './boardView'

const item = (id: string, p: Partial<BoardLead> = {}) => ({ lead: { id, ...p } })
const ids = (xs: { lead: { id: string } }[]) => xs.map(x => x.lead.id)

test('romeHour: segue il cambio dell\'ora del 25/10/2026', () => {
    assert.equal(romeHour('2026-10-24T13:30:00Z'), 15)   // ancora +02:00
    assert.equal(romeHour('2026-10-26T13:30:00Z'), 14)   // +01:00
})

test('leadsInHour: ora di Roma, senza parcheggiati e senza appuntamento', () => {
    const items = [
        item('a', { appointmentDate: '2026-10-26T14:00:00Z' }),                            // 15:00
        item('b', { appointmentDate: '2026-10-26T14:45:00Z' }),                            // 15:45
        item('c', { appointmentDate: '2026-10-26T14:10:00Z', confNeedsReschedule: true }),
        item('d', { appointmentDate: null }),
        item('e', { appointmentDate: '2026-10-26T15:00:00Z' }),                            // 16:00
    ]
    assert.deepEqual(ids(leadsInHour(items, '15:00')), ['a', 'b'])
    assert.deepEqual(ids(leadsInHour(items, '09:00')), [])
})

test('filtri NR: conteggi e filtro, "3" non filtra come sempre', () => {
    const t = '2026-10-26T10:00:00Z'
    const items = [
        item('zero'),
        item('uno', { confCall1At: t }),
        item('due', { confCall1At: t, confCall2At: t }),
        item('tre', { confCall1At: t, confCall2At: t, confCall3At: t }),
    ]
    assert.deepEqual(nrCounts(items), { tutti: 4, '0': 1, '1': 1, '2': 1, '3': 1 })
    assert.deepEqual(ids(applyNrFilter(items, '0')), ['zero'])
    assert.deepEqual(ids(applyNrFilter(items, '1')), ['uno'])
    assert.deepEqual(ids(applyNrFilter(items, '2')), ['due'])
    assert.deepEqual(ids(applyNrFilter(items, '3')), ['zero', 'uno', 'due', 'tre'])
    assert.deepEqual(ids(applyNrFilter(items, 'tutti')), ['zero', 'uno', 'due', 'tre'])
})

test('snoozedOf: solo quelli senza esito, dal più vicino', () => {
    const items = [
        item('tardi', { confSnoozeAt: '2026-10-26T17:00:00Z' }),
        item('presto', { confSnoozeAt: '2026-10-26T15:00:00Z' }),
        item('esitato', { confSnoozeAt: '2026-10-26T14:00:00Z', confirmationsOutcome: 'confermato' }),
        item('niente'),
    ]
    assert.deepEqual(ids(snoozedOf(items)), ['presto', 'tardi'])
})

test('sortRichiami: per data del richiamo, senza data in fondo', () => {
    const items = [
        item('senza'),
        item('dopo', { recallDate: '2026-10-29T10:00:00Z' }),
        item('prima', { recallDate: '2026-10-27T10:00:00Z' }),
    ]
    assert.deepEqual(ids(sortRichiami(items)), ['prima', 'dopo', 'senza'])
})

test('storico: filtro e conteggi', () => {
    const items = [
        item('c1', { confirmationsOutcome: 'confermato' }),
        item('s1', { confirmationsOutcome: 'scartato' }),
        item('c2', { confirmationsOutcome: 'confermato' }),
    ]
    assert.deepEqual(ids(filterStorico(items, 'confermati')), ['c1', 'c2'])
    assert.deepEqual(ids(filterStorico(items, 'scartati')), ['s1'])
    assert.equal(filterStorico(items, 'tutti').length, 3)
    assert.deepEqual(storicoCounts(items), { confermati: 2, scartati: 1 })
})

test('callsMade: conta le chiamate a vuoto', () => {
    assert.equal(callsMade({}), 0)
    assert.equal(callsMade({ confCall1At: 'x' }), 1)
    assert.equal(callsMade({ confCall1At: 'x', confCall2At: 'x' }), 2)
    assert.equal(callsMade({ confCall1At: 'x', confCall2At: 'x', confCall3At: 'x' }), 3)
})

test('gdoName: nome vero, Fissatore per il bot, mai vuoto', () => {
    assert.equal(gdoName({ firstName: 'Noemi', displayName: 'GDO 107', name: 'GDO 107' }), 'Noemi')
    assert.equal(gdoName({ firstName: null, displayName: 'GDO 201', name: 'GDO 201', isBot: true }), 'Fissatore')
    assert.equal(gdoName({ firstName: '  ', displayName: 'GDO 108', name: 'GDO 108' }), 'GDO 108')
    assert.equal(gdoName(null), 'Senza GDO')
    assert.equal(gdoName({ firstName: null, displayName: null, name: null }), 'Senza GDO')
})

test('collegaName: toglie il suffisso del reparto', () => {
    assert.equal(collegaName('Alberto (Conferme)'), 'Alberto')
    assert.equal(collegaName('Andrea'), 'Andrea')
    assert.equal(collegaName(null), '')
})
