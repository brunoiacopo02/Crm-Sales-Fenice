import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDemand, buildCoverage, coverageStatus } from './calendarCoverage'
import { weekSlots } from './calendarSlots'

const LUNEDI = new Date('2026-09-14T00:00:00+02:00')

test('coverageStatus: rosso senza nessuno, ambra se scarsi, verde se coperti, neutro se non arriva nessuno', () => {
    assert.equal(coverageStatus(0, 2.4), 'rosso')
    assert.equal(coverageStatus(1, 2.4), 'ambra')
    assert.equal(coverageStatus(3, 2.4), 'verde')
    assert.equal(coverageStatus(0, 0), 'neutro')
})

test('buildDemand media sugli slot e calcola la percentuale di presenza', () => {
    // 4 appuntamenti di mercoledi alle 15 su 8 settimane, 3 presentati.
    const samples = [
        { appointmentAt: new Date('2026-08-19T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-08-26T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-09-02T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-09-09T15:00:00+02:00'), presented: false },
    ]
    const stats = buildDemand(samples, 8)
    const mer15 = stats.find(s => s.dow === 3 && s.hour === 15)
    assert.ok(mer15)
    assert.equal(mer15!.expected, 0.5)          // 4 appuntamenti / 8 settimane
    assert.equal(mer15!.showRate, 0.75)         // 3 su 4
    assert.equal(mer15!.expectedPeople, 0.375)
})

test('buildDemand ignora gli appuntamenti fuori griglia', () => {
    const stats = buildDemand([
        { appointmentAt: new Date('2026-09-13T15:00:00+02:00'), presented: true }, // domenica
        { appointmentAt: new Date('2026-09-14T23:00:00+02:00'), presented: true }, // fuori orario
    ], 8)
    assert.deepEqual(stats, [])
})

test('buildCoverage incrocia disponibili, bloccati, appuntamenti e attesi', () => {
    const slots = weekSlots(LUNEDI)
    const cells = buildCoverage({
        slots,
        availability: [
            { salesUserId: 's2', slotKey: '2026-09-14@15' },
            { salesUserId: 's3', slotKey: '2026-09-14@15' },
            { salesUserId: 's4', slotKey: '2026-09-14@15' },
        ],
        blocks: [{ salesUserId: 's4', slotKey: '2026-09-14@15' }],
        appointments: [{ salesUserId: 's2', slotKey: '2026-09-14@15', leadId: 'l1', leadName: 'Mario Rossi' }],
        demand: [{ dow: 1, hour: 15, expected: 3, showRate: 0.8, expectedPeople: 2.4 }],
    })
    const cell = cells.find(c => c.slotKey === '2026-09-14@15')!
    assert.deepEqual(cell.available.sort(), ['s2', 's3'])  // s4 e' bloccato
    assert.deepEqual(cell.blocked, ['s4'])
    assert.equal(cell.busy.length, 1)
    assert.equal(cell.busy[0].leadName, 'Mario Rossi')
    assert.equal(cell.expectedPeople, 2.4)
    assert.equal(cell.status, 'ambra')                     // 2 disponibili < 2.4 attesi
})

test('buildCoverage restituisce una cella per ogni slot della settimana', () => {
    const cells = buildCoverage({
        slots: weekSlots(LUNEDI), availability: [], blocks: [], appointments: [], demand: [],
    })
    assert.equal(cells.length, 78)
    assert.ok(cells.every(c => c.status === 'neutro'))
})

test('coverageStatus: un valore non finito e neutro, mai verde', () => {
    assert.equal(coverageStatus(0, NaN), 'neutro')
    assert.equal(coverageStatus(3, NaN), 'neutro')
    assert.equal(coverageStatus(0, Infinity), 'neutro')
})

test('buildDemand: una finestra di zero settimane non produce medie infinite', () => {
    const stats = buildDemand([
        { appointmentAt: new Date('2026-09-09T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-09-02T15:00:00+02:00'), presented: false },
    ], 0)
    const mer15 = stats.find(s => s.dow === 3 && s.hour === 15)
    assert.ok(mer15)
    assert.ok(Number.isFinite(mer15!.expected), 'expected deve restare finito')
    assert.ok(Number.isFinite(mer15!.expectedPeople), 'expectedPeople deve restare finito')
    assert.equal(mer15!.expected, 2)   // clampata a una settimana
})
