import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_CONFERME_BONUS, parseConfermeBonus, validateConfermeBonus, progressoSquadra, periodoBonusBounds,
} from './bonus'

const ANDREA = 'u-andrea'
const ALBERTO = 'u-alberto'
const AMMESSI = new Set([ANDREA, ALBERTO])

test('default: chiusure, mese, soglia 17, 12 euro, nessun obiettivo', () => {
    assert.deepEqual(DEFAULT_CONFERME_BONUS, { unita: 'chiusure', periodo: 'mese', soglia: 17, euroPerUnita: 12, obiettivi: {} })
})

test('parseConfermeBonus: vuoto o rotto = default', () => {
    assert.deepEqual(parseConfermeBonus(null), DEFAULT_CONFERME_BONUS)
    assert.deepEqual(parseConfermeBonus(''), DEFAULT_CONFERME_BONUS)
    assert.deepEqual(parseConfermeBonus('{rotto'), DEFAULT_CONFERME_BONUS)
    assert.deepEqual(parseConfermeBonus('[1,2]'), DEFAULT_CONFERME_BONUS)
    assert.deepEqual(parseConfermeBonus('42'), DEFAULT_CONFERME_BONUS)
})

test('parseConfermeBonus: un campo rotto prende il default, gli altri restano', () => {
    const cfg = parseConfermeBonus(JSON.stringify({ unita: 'presenze', periodo: 'anno', soglia: -3, euroPerUnita: 15 }))
    assert.equal(cfg.unita, 'presenze')
    assert.equal(cfg.periodo, 'mese')
    assert.equal(cfg.soglia, 17)
    assert.equal(cfg.euroPerUnita, 15)
})

test('parseConfermeBonus: obiettivi rotti o vuoti spariscono, gli altri restano', () => {
    const cfg = parseConfermeBonus(JSON.stringify({
        obiettivi: {
            [ANDREA]: { confermeGiorno: 8, presenzeSettimana: null, chiusureMese: 'dieci' },
            [ALBERTO]: { confermeGiorno: 0, presenzeSettimana: null, chiusureMese: null },
            'u-rotto': 'niente',
        },
    }))
    assert.deepEqual(cfg.obiettivi, { [ANDREA]: { confermeGiorno: 8, presenzeSettimana: null, chiusureMese: null } })
})

test('validateConfermeBonus: configurazione completa e valida', () => {
    const r = validateConfermeBonus({
        unita: 'presenze', periodo: 'settimana', soglia: 17, euroPerUnita: 12.5,
        obiettivi: {
            [ANDREA]: { confermeGiorno: 8, presenzeSettimana: 6, chiusureMese: null },
            [ALBERTO]: { confermeGiorno: null, presenzeSettimana: null, chiusureMese: null },
        },
    }, AMMESSI)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.value, {
        unita: 'presenze', periodo: 'settimana', soglia: 17, euroPerUnita: 12.5,
        obiettivi: { [ANDREA]: { confermeGiorno: 8, presenzeSettimana: 6, chiusureMese: null } },
    })
})

test('validateConfermeBonus: rifiuta i valori sbagliati invece di correggerli', () => {
    const base = { unita: 'chiusure', periodo: 'mese', soglia: 17, euroPerUnita: 12, obiettivi: {} }
    assert.equal(validateConfermeBonus({ ...base, unita: 'conferme' }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, periodo: 'anno' }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, soglia: 17.5 }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, soglia: -1 }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, soglia: '17' }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, euroPerUnita: 12.345 }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, euroPerUnita: -12 }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus(null, AMMESSI).ok, false)
})

test('validateConfermeBonus: obiettivi solo sugli account Conferme e solo interi positivi', () => {
    const base = { unita: 'chiusure', periodo: 'mese', soglia: 17, euroPerUnita: 12 }
    assert.equal(validateConfermeBonus({ ...base, obiettivi: { 'u-gdo': { confermeGiorno: 5 } } }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, obiettivi: { [ANDREA]: { confermeGiorno: 0 } } }, AMMESSI).ok, false)
    assert.equal(validateConfermeBonus({ ...base, obiettivi: { [ANDREA]: { chiusureMese: 2.5 } } }, AMMESSI).ok, false)
    const ok = validateConfermeBonus({ ...base, obiettivi: { [ANDREA]: { chiusureMese: 10 } } }, AMMESSI)
    assert.equal(ok.ok, true)
    if (ok.ok) assert.deepEqual(ok.value.obiettivi[ANDREA], { confermeGiorno: null, presenzeSettimana: null, chiusureMese: 10 })
})

test('progressoSquadra: si guadagna dalla 18ª con soglia 17', () => {
    const cfg = { soglia: 17, euroPerUnita: 12 }
    assert.deepEqual(progressoSquadra(0, cfg), { conteggio: 0, soglia: 17, oltre: 0, mancano: 18, euro: 0 })
    assert.deepEqual(progressoSquadra(17, cfg), { conteggio: 17, soglia: 17, oltre: 0, mancano: 1, euro: 0 })
    assert.deepEqual(progressoSquadra(18, cfg), { conteggio: 18, soglia: 17, oltre: 1, mancano: 0, euro: 12 })
    assert.equal(progressoSquadra(48, cfg).euro, 372)
})

test('progressoSquadra: importi con decimali e soglia zero', () => {
    assert.equal(progressoSquadra(3, { soglia: 0, euroPerUnita: 12.5 }).euro, 37.5)
    assert.equal(progressoSquadra(-4, { soglia: 0, euroPerUnita: 12 }).euro, 0)
})

test('periodoBonusBounds: settimana di lunedì 26/10/2026, primo giorno di ora solare', () => {
    const w = periodoBonusBounds(new Date('2026-10-26T15:00:00Z'), 'settimana')
    assert.equal(w.start.toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(w.end.toISOString(), '2026-11-01T23:00:00.000Z')
})

test('periodoBonusBounds: mese di ottobre 2026 (cambio ora dentro il mese)', () => {
    const m = periodoBonusBounds(new Date('2026-10-25T12:00:00Z'), 'mese')
    assert.equal(m.start.toISOString(), '2026-09-30T22:00:00.000Z')
    assert.equal(m.end.toISOString(), '2026-10-31T23:00:00.000Z')
})
