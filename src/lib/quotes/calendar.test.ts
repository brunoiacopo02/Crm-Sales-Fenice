import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    easterDay, isWorkingDay, workingDaysInRange, occasionCalendar, seasonOf, parseClosedDays, addMonths, addDays,
} from './calendar'

test('Pasqua (Gauss/Meeus): 2024-2028', () => {
    assert.equal(easterDay(2024), '2024-03-31')
    assert.equal(easterDay(2025), '2025-04-20')
    assert.equal(easterDay(2026), '2026-04-05')
    assert.equal(easterDay(2027), '2027-03-28')
    assert.equal(easterDay(2028), '2028-04-16')
})

test('giorni lavorativi: lun-sab, feste italiane e chiusure escluse', () => {
    assert.equal(isWorkingDay('2026-10-26'), true)    // lunedì
    assert.equal(isWorkingDay('2026-10-31'), true)    // sabato
    assert.equal(isWorkingDay('2026-11-01'), false)   // domenica e Ognissanti
    assert.equal(isWorkingDay('2026-12-08'), false)   // Immacolata, martedì
    assert.equal(isWorkingDay('2026-12-26'), false)   // Santo Stefano, sabato
    assert.equal(isWorkingDay('2027-01-06'), false)   // Epifania, mercoledì
    assert.equal(isWorkingDay('2027-03-29'), false)   // Pasquetta
    assert.equal(isWorkingDay('2027-04-24'), true)    // sabato prima del 25/4
    assert.equal(isWorkingDay('2027-06-02'), false)   // Repubblica
    assert.equal(isWorkingDay('2027-08-16'), true)    // lunedì dopo Ferragosto
    assert.equal(isWorkingDay('2026-12-24', new Set(['2026-12-24'])), false)  // ufficio chiuso
})

test('intervallo di Natale 2026 senza e con chiusure', () => {
    assert.deepEqual(workingDaysInRange('2026-12-21', '2026-12-31'), [
        '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24',
        '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    ])
    assert.deepEqual(workingDaysInRange('2026-12-21', '2026-12-31', new Set(['2026-12-24', '2026-12-31'])), [
        '2026-12-21', '2026-12-22', '2026-12-23',
        '2026-12-28', '2026-12-29', '2026-12-30',
    ])
})

function occasionDays(cal: ReturnType<typeof occasionCalendar>, occasion: string): string[] {
    return [...cal.entries()].filter(([, slots]) => slots.some(s => s.occasion === occasion)).map(([d]) => d).sort()
}

test('occasioni forti 2026-2027 nel calendario reale', () => {
    const days = workingDaysInRange('2026-10-26', '2027-09-30')
    const cal = occasionCalendar(days)

    const natale = occasionDays(cal, 'natale')
    assert.equal(natale.length, 20)
    assert.equal(natale[0], '2026-12-01')
    assert.equal(natale[natale.length - 1], '2026-12-24')
    assert.ok(!natale.includes('2026-12-08'))

    assert.deepEqual(occasionDays(cal, 'fine_anno'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31'])
    // 1/1/2027 è festa: il primo giorno lavorativo è sabato 2; dopo l'Epifania (mercoledì) giovedì 7.
    assert.deepEqual(occasionDays(cal, 'inizio_anno'), ['2027-01-02', '2027-01-07'])
    // Pasqua 28/3/2027: le due settimane prima (domeniche escluse) e martedì 30 (lunedì è Pasquetta).
    assert.deepEqual(occasionDays(cal, 'rinascita'), [
        '2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19', '2027-03-20',
        '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27',
        '2027-03-30',
    ])
    assert.deepEqual(occasionDays(cal, 'liberazione'), ['2027-04-24'])   // il 25/4/2027 è domenica
    assert.deepEqual(occasionDays(cal, 'festa_lavoro'), ['2027-04-30'])
    assert.deepEqual(occasionDays(cal, 'repubblica'), ['2027-06-01'])
    assert.deepEqual(occasionDays(cal, 'ferie'), ['2027-08-09', '2027-08-10', '2027-08-11', '2027-08-12', '2027-08-13', '2027-08-14'])
    assert.deepEqual(occasionDays(cal, 'rientro'), [
        '2027-08-16',
        '2027-09-01', '2027-09-02', '2027-09-03', '2027-09-04',
        '2027-09-06', '2027-09-07', '2027-09-08', '2027-09-09', '2027-09-10', '2027-09-11',
        '2027-09-13', '2027-09-14',
    ])
})

test('natale: il peso cresce verso la vigilia; i giorni "fissi" sono obbligatori', () => {
    const cal = occasionCalendar(workingDaysInRange('2026-12-01', '2027-01-10'))
    const w = (d: string) => cal.get(d)!.find(s => s.occasion === 'natale')!.weight
    assert.ok(w('2026-12-24') > w('2026-12-14'))
    assert.ok(w('2026-12-14') > w('2026-12-01'))
    const inizio = cal.get('2027-01-02')!.find(s => s.occasion === 'inizio_anno')!
    assert.equal(inizio.must, true)
})

test('liberazione 2028: martedì 25/4, si celebra lunedì 24', () => {
    const cal = occasionCalendar(workingDaysInRange('2028-04-01', '2028-04-30'))
    assert.deepEqual(occasionDays(cal, 'liberazione'), ['2028-04-24'])
})

test('chiusure di fine anno: il primo giorno lavorativo di gennaio slitta', () => {
    const closed = new Set(['2027-01-02'])
    const cal = occasionCalendar(workingDaysInRange('2026-12-28', '2027-01-15', closed), closed)
    assert.deepEqual(occasionDays(cal, 'inizio_anno'), ['2027-01-04', '2027-01-07'])
})

test('occasioni deboli: lunedì, sabato e stagioni', () => {
    const cal = occasionCalendar(workingDaysInRange('2026-12-19', '2026-12-22'))
    const names = (d: string) => cal.get(d)!.map(s => s.occasion).sort()
    assert.deepEqual(names('2026-12-19'), ['autunno', 'natale', 'sabato'])
    assert.deepEqual(names('2026-12-21'), ['inverno', 'lunedi', 'natale'])
    assert.equal(seasonOf('2027-03-20'), 'inverno')
    assert.equal(seasonOf('2027-03-21'), 'primavera')
    assert.equal(seasonOf('2027-06-21'), 'estate')
    assert.equal(seasonOf('2027-09-22'), 'estate')
    assert.equal(seasonOf('2027-09-23'), 'autunno')
    assert.equal(seasonOf('2027-12-21'), 'inverno')
})

test('chiusure configurabili: JSON di date valide, il resto si scarta', () => {
    assert.deepEqual(parseClosedDays(null), [])
    assert.deepEqual(parseClosedDays('rotto'), [])
    assert.deepEqual(parseClosedDays('["2026-12-31","2026-12-24","x","2026-13-01","2026-12-24"]'), ['2026-12-24', '2026-12-31'])
})

test('18 mesi da lunedì 26/10/2026: ultimo giorno martedì 25/4/2028', () => {
    assert.equal(addMonths('2026-10-26', 18), '2028-04-26')
    assert.equal(addDays(addMonths('2026-10-26', 18), -1), '2028-04-25')
    assert.equal(addMonths('2027-01-31', 1), '2027-02-28')
    assert.equal(addMonths('2027-12-15', 1), '2028-01-15')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})
