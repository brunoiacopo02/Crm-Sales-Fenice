import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    CALENDAR_PENALTY_EUR,
    selectMissingCalendarPenalties,
    manualBlockCheck,
    absenceReportCheck,
    calendarRuleState,
    type CalendarUserRow,
} from './calendarRules'

const LUNEDI = new Date('2026-09-14T00:00:00+02:00')
const SCADENZA = new Date('2026-09-14T14:00:00+02:00')
const ATTIVAZIONE = new Date('2026-09-01T00:00:00+02:00')

function utente(over: Partial<CalendarUserRow> = {}): CalendarUserRow {
    return { id: 'sales-2', companyId: 'fenice', isActive: true, calendarExempt: false, ...over }
}

test('dopo le 14 di lunedi chi non ha compilato prende 50 euro', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T14:05:00+02:00'), ATTIVAZIONE,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].amountEur, CALENDAR_PENALTY_EUR)
    assert.equal(out[0].kind, 'CALENDAR_MISSING')
    assert.equal(out[0].monthKey, '2026-09')
    assert.equal(out[0].dueAt.toISOString(), SCADENZA.toISOString())
})

test('prima delle 14 non scatta nulla', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T13:59:00+02:00'), ATTIVAZIONE,
    )
    assert.deepEqual(out, [])
})

test('chi ha compilato, chi e esente e chi e disattivato non prendono multe', () => {
    const users = [
        utente({ id: 'ha-compilato' }),
        utente({ id: 'esente', calendarExempt: true }),
        utente({ id: 'spento', isActive: false }),
        utente({ id: 'colpevole' }),
    ]
    const out = selectMissingCalendarPenalties(
        users, new Set(['ha-compilato']), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'), ATTIVAZIONE,
    )
    assert.deepEqual(out.map(p => p.salesUserId), ['colpevole'])
})

test('senza data di attivazione non si registra nulla', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'), null,
    )
    assert.deepEqual(out, [])
})

test('una scadenza anteriore all attivazione non genera multe retroattive', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'),
        new Date('2026-09-20T00:00:00+02:00'),
    )
    assert.deepEqual(out, [])
})

test('la multa e datata lunedi 14 anche se il cron la trova martedi', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-15T09:00:00+02:00'), ATTIVAZIONE,
    )
    assert.equal(out[0].dueAt.toISOString(), SCADENZA.toISOString())
})

// --- blocco manuale ---

const SLOT = new Date('2026-09-16T18:00:00+02:00')

test('blocco consentito a 61 minuti, negato a 59', () => {
    const base = { slotStart: SLOT, declared: true, hasAppointment: false, alreadyBlocked: false }
    assert.equal(manualBlockCheck({ ...base, now: new Date('2026-09-16T16:59:00+02:00') }).ok, true)
    const tardi = manualBlockCheck({ ...base, now: new Date('2026-09-16T17:01:00+02:00') })
    assert.equal(tardi.ok, false)
    assert.equal(tardi.ok === false && tardi.reason, 'preavviso_insufficiente')
})

test('a 60 minuti esatti il blocco e gia tardi: il confine e chiuso', () => {
    const d = manualBlockCheck({
        slotStart: SLOT,
        now: new Date('2026-09-16T17:00:00+02:00'),
        declared: true, hasAppointment: false, alreadyBlocked: false,
    })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'preavviso_insufficiente')
})

test('non si blocca uno slot che ha gia un appuntamento', () => {
    const d = manualBlockCheck({
        slotStart: SLOT, now: new Date('2026-09-16T10:00:00+02:00'),
        declared: true, hasAppointment: true, alreadyBlocked: false,
    })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'appuntamento_presente')
})

test('non si blocca uno slot mai dichiarato, ne si blocca due volte', () => {
    const now = new Date('2026-09-16T10:00:00+02:00')
    const nonDichiarato = manualBlockCheck({ slotStart: SLOT, now, declared: false, hasAppointment: false, alreadyBlocked: false })
    assert.equal(nonDichiarato.ok === false && nonDichiarato.reason, 'slot_non_dichiarato')
    const doppio = manualBlockCheck({ slotStart: SLOT, now, declared: true, hasAppointment: false, alreadyBlocked: true })
    assert.equal(doppio.ok === false && doppio.reason, 'gia_bloccato')
})

// --- segnalazione assenza ---

function ctx(over: Partial<Parameters<typeof absenceReportCheck>[0]> = {}) {
    return {
        slotStart: SLOT,
        now: new Date('2026-09-16T19:00:00+02:00'),
        declared: true,
        blocked: false,
        exempt: false,
        alreadyReported: false,
        ...over,
    }
}

test('segnalazione ammessa su uno slot passato, dichiarato e non bloccato', () => {
    assert.equal(absenceReportCheck(ctx()).ok, true)
})

test('niente segnalazione sul futuro, oltre 48 ore, su esenti, fuori disponibilita, su bloccati o gia segnalati', () => {
    const casi: Array<[Parameters<typeof absenceReportCheck>[0], string]> = [
        [ctx({ now: new Date('2026-09-16T17:30:00+02:00') }), 'slot_futuro'],
        [ctx({ now: new Date('2026-09-19T10:00:00+02:00') }), 'finestra_scaduta'],
        [ctx({ exempt: true }), 'venditore_esente'],
        [ctx({ declared: false }), 'non_dichiarato'],
        [ctx({ blocked: true }), 'slot_bloccato'],
        [ctx({ alreadyReported: true }), 'gia_segnalato'],
    ]
    for (const [input, atteso] of casi) {
        const d = absenceReportCheck(input)
        assert.equal(d.ok, false, `atteso rifiuto ${atteso}`)
        assert.equal(d.ok === false && d.reason, atteso)
    }
})

// --- stato della regola ---

test('calendarRuleState: senza data di attivazione la regola non e in vigore', () => {
    const s = calendarRuleState({})
    assert.equal(s.active, false)
    assert.equal(s.active === false && s.reason, 'not_activated')
    assert.equal(s.active === false && s.from, null)
})

test('calendarRuleState: con la data la regola e in vigore da quella data', () => {
    const s = calendarRuleState({ SALES_CALENDAR_PENALTIES_FROM: '2026-09-21T00:00:00+02:00' })
    assert.equal(s.active, true)
    assert.equal(s.active === true && s.from.toISOString(), '2026-09-20T22:00:00.000Z')
})

test('calendarRuleState: il kill-switch vince sulla data, ma la data resta leggibile', () => {
    const s = calendarRuleState({
        SALES_CALENDAR_PENALTIES: 'off',
        SALES_CALENDAR_PENALTIES_FROM: '2026-09-21T00:00:00+02:00',
    })
    assert.equal(s.active, false)
    assert.equal(s.active === false && s.reason, 'kill_switch')
    assert.ok(s.active === false && s.from instanceof Date)
})

test('calendarRuleState: una data illeggibile vale come data assente', () => {
    const s = calendarRuleState({ SALES_CALENDAR_PENALTIES_FROM: 'non-una-data' })
    assert.equal(s.active, false)
    assert.equal(s.active === false && s.reason, 'not_activated')
})
