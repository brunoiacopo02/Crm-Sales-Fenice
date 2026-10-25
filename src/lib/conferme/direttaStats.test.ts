import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateConfermeDiretta, confermeOggiConOttimistiche, conteggiSquadra, direttaBounds, type ConfermeLeadRow } from './direttaStats'
import { DEFAULT_CONFERME_BONUS, type ConfermeBonusConfig } from './bonus'

const ANDREA = 'u-andrea'
const ALBERTO = 'u-alberto'
const ms = (iso: string) => new Date(iso).getTime()

// Lunedì 26/10/2026 alle 16 di Roma (ora solare, +01:00).
const NOW = new Date('2026-10-26T15:00:00Z')

function row(id: string, userId: string, p: Partial<Omit<ConfermeLeadRow, 'id' | 'userId'>>): ConfermeLeadRow {
    return { id, userId, confirmedAt: null, presentedAt: null, chiusoAt: null, ...p }
}

test('direttaBounds: giorno, settimana e mese di Roma, since copre tutto', () => {
    const b = direttaBounds(NOW, 'mese')
    assert.equal(new Date(b.giorno.start).toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(new Date(b.giorno.end).toISOString(), '2026-10-26T23:00:00.000Z')
    assert.equal(new Date(b.settimana.start).toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(new Date(b.mese.start).toISOString(), '2026-09-30T22:00:00.000Z')
    assert.equal(b.squadra.start, b.mese.start)
    assert.equal(b.since, b.mese.start)
})

test('direttaBounds: a inizio mese la settimana parte prima del mese e since la segue', () => {
    // Martedì 3/11/2026: la settimana parte lunedì 2/11, il mese domenica 1/11.
    const b = direttaBounds(new Date('2026-11-03T10:00:00Z'), 'settimana')
    assert.equal(new Date(b.settimana.start).toISOString(), '2026-11-01T23:00:00.000Z')
    assert.equal(new Date(b.mese.start).toISOString(), '2026-10-31T23:00:00.000Z')
    assert.equal(b.squadra.start, b.settimana.start)
    assert.equal(b.since, b.mese.start)
    // Domenica 1/11 la settimana è ancora quella di ottobre: since torna indietro con lei.
    const d = direttaBounds(new Date('2026-11-01T10:00:00Z'), 'settimana')
    assert.equal(new Date(d.since).toISOString(), '2026-10-25T23:00:00.000Z')
})

test('numeri personali: solo i lead confermati da chi guarda, ognuno nella finestra della sua azione', () => {
    const rows: ConfermeLeadRow[] = [
        row('a1', ANDREA, { confirmedAt: ms('2026-10-26T09:00:00Z') }),                                   // conferma di oggi
        row('a2', ANDREA, { confirmedAt: ms('2026-10-25T22:30:00Z') }),                                   // ieri sera (23:30 di Roma)
        row('a3', ANDREA, { confirmedAt: ms('2026-10-20T09:00:00Z'), presentedAt: ms('2026-10-26T10:00:00Z') }), // presenza di oggi
        row('a4', ANDREA, { presentedAt: ms('2026-10-22T10:00:00Z'), chiusoAt: ms('2026-10-26T11:00:00Z') }),   // chiusa oggi, presenza della settimana scorsa
        row('a5', ANDREA, { presentedAt: ms('2026-10-27T10:00:00Z') }),                                   // presenza di domani, stessa settimana
        row('a6', ANDREA, { chiusoAt: ms('2026-10-02T11:00:00Z') }),                                      // chiusura di inizio mese
        row('b1', ALBERTO, { confirmedAt: ms('2026-10-26T08:00:00Z'), chiusoAt: ms('2026-10-26T12:00:00Z') }),
    ]
    const n = aggregateConfermeDiretta(rows, { userId: ANDREA, bounds: direttaBounds(NOW, 'mese'), cfg: DEFAULT_CONFERME_BONUS })
    assert.deepEqual(n.personali, {
        confermeOggi: 1,
        confermeOggiIds: ['a1'],
        presenzeOggi: 1,
        chiusureOggi: 1,
        presenzeSettimana: 2,
        chiusureMese: 2,
    })
})

test('squadra a chiusure del mese: conta tutti gli account e applica soglia ed euro', () => {
    const rows: ConfermeLeadRow[] = []
    for (let i = 0; i < 20; i++) rows.push(row(`c${i}`, i % 2 ? ANDREA : ALBERTO, { chiusoAt: ms('2026-10-10T10:00:00Z') }))
    rows.push(row('fuori', ANDREA, { chiusoAt: ms('2026-09-30T21:59:00Z') }))     // 30/9 alle 23:59 di Roma: settembre
    rows.push(row('pres', ANDREA, { presentedAt: ms('2026-10-10T10:00:00Z') }))   // presenza: non è una chiusura
    // Regola esplicita (a mese, soglia 17): il default dal 25/10 è a settimana con soglia 16.
    const cfg: ConfermeBonusConfig = { ...DEFAULT_CONFERME_BONUS, periodo: 'mese', soglia: 17 }
    const n = aggregateConfermeDiretta(rows, { userId: ANDREA, bounds: direttaBounds(NOW, 'mese'), cfg })
    assert.equal(n.squadra.conteggio, 20)
    assert.equal(n.squadra.oltre, 3)
    assert.equal(n.squadra.euro, 36)
    assert.equal(n.squadra.unita, 'chiusure')
    assert.equal(n.squadra.periodo, 'mese')
    assert.equal(new Date(n.squadra.periodoInizio).toISOString(), '2026-09-30T22:00:00.000Z')
})

test('squadra a presenze della settimana', () => {
    const cfg: ConfermeBonusConfig = { ...DEFAULT_CONFERME_BONUS, unita: 'presenze', periodo: 'settimana', soglia: 2 }
    const rows: ConfermeLeadRow[] = [
        row('p1', ANDREA, { presentedAt: ms('2026-10-26T10:00:00Z') }),
        row('p2', ALBERTO, { presentedAt: ms('2026-10-27T10:00:00Z') }),
        row('p3', ALBERTO, { presentedAt: ms('2026-10-28T10:00:00Z') }),
        row('p4', ALBERTO, { presentedAt: ms('2026-10-25T10:00:00Z') }),              // domenica: settimana prima
        row('c1', ALBERTO, { chiusoAt: ms('2026-10-26T10:00:00Z') }),                 // chiusura: non conta
    ]
    const n = aggregateConfermeDiretta(rows, { userId: ANDREA, bounds: direttaBounds(NOW, 'settimana'), cfg })
    assert.equal(n.squadra.conteggio, 3)
    assert.equal(n.squadra.oltre, 1)
    assert.equal(n.squadra.euro, 12)
    assert.equal(n.squadra.mancano, 0)
})

test('obiettivi: quelli di chi guarda, null se non impostati', () => {
    const cfg: ConfermeBonusConfig = {
        ...DEFAULT_CONFERME_BONUS,
        obiettivi: { [ANDREA]: { confermeGiorno: 8, presenzeSettimana: null, chiusureMese: 10 } },
    }
    const b = direttaBounds(NOW, 'mese')
    assert.deepEqual(aggregateConfermeDiretta([], { userId: ANDREA, bounds: b, cfg }).obiettivi,
        { confermeGiorno: 8, presenzeSettimana: null, chiusureMese: 10 })
    assert.equal(aggregateConfermeDiretta([], { userId: ALBERTO, bounds: b, cfg }).obiettivi, null)
})

test('conteggiSquadra: presenze e chiusure, settimana e mese', () => {
    const rows: ConfermeLeadRow[] = [
        row('a', ANDREA, { presentedAt: ms('2026-10-26T10:00:00Z'), chiusoAt: ms('2026-10-26T12:00:00Z') }),
        row('b', ALBERTO, { presentedAt: ms('2026-10-12T10:00:00Z') }),
        row('c', ALBERTO, { chiusoAt: ms('2026-10-13T10:00:00Z') }),
        row('d', ALBERTO, { confirmedAt: ms('2026-10-26T10:00:00Z') }),
    ]
    assert.deepEqual(conteggiSquadra(rows, direttaBounds(NOW, 'mese')), {
        presenze: { settimana: 1, mese: 2 },
        chiusure: { settimana: 1, mese: 2 },
    })
})

test('conferme ottimistiche: un lead già visto dal server non si conta due volte', () => {
    assert.equal(confermeOggiConOttimistiche(['a', 'b'], []), 2)
    assert.equal(confermeOggiConOttimistiche(['a', 'b'], ['c']), 3)
    assert.equal(confermeOggiConOttimistiche(['a', 'b'], ['b', 'c']), 3)
})
