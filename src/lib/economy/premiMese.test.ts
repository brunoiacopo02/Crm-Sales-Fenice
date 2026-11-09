import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaPremiMese, salvadanaioDi, settimaneDelMese, meseDelSalvadanaio, nomeMese, dateSettimana, type InputPremiMese } from './premiMese'
import { DEFAULT_ECONOMY_RULES } from './rules'
import { DEFAULT_TARGETS } from '@/lib/diretta/config'
import type { PremiSettimana } from './premiSettimana'

test('settimane del mese: contano nel mese del sabato (PO 09/11/2026)', () => {
    assert.deepEqual(settimaneDelMese('2026-11').map(s => s.lunedi), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
    // 26-31/10 chiude a ottobre, 30/11-5/12 chiude a dicembre.
    assert.deepEqual(settimaneDelMese('2026-10').map(s => s.lunedi).slice(-1), ['2026-10-26'])
    assert.deepEqual(settimaneDelMese('2026-12').map(s => s.lunedi)[0], '2026-11-30')
    assert.equal(settimaneDelMese('2026-12')[0].sabato, '2026-12-05')
    assert.deepEqual(settimaneDelMese('nonvalido'), [])
})

test('mese del salvadanaio: il mese del sabato della settimana in corso', () => {
    assert.equal(meseDelSalvadanaio(new Date('2026-11-09T15:00:00Z')), '2026-11')
    assert.equal(meseDelSalvadanaio(new Date('2026-12-01T15:00:00Z')), '2026-12')
    assert.equal(meseDelSalvadanaio(new Date('2026-11-30T15:00:00Z')), '2026-12')
    // Domenica 1/11: la settimana appena chiusa è del 31/10, quindi ottobre.
    assert.equal(meseDelSalvadanaio(new Date('2026-11-01T10:00:00Z')), '2026-10')
})

const regole = { economia: DEFAULT_ECONOMY_RULES, obiettivi: DEFAULT_TARGETS }
const gdo = [
    { userId: '105', nome: 'Antony', squadra: true },
    { userId: '116', nome: 'Sara', squadra: true },
    { userId: '106', nome: 'Zora', squadra: true },
    { userId: '110', nome: 'Alessandro', squadra: true },
    { userId: '112', nome: 'Beatrice', squadra: true },
    { userId: '999', nome: 'Vecchio', squadra: false },
]
/** n presenze nella settimana 2-7/11 (mercoledì pomeriggio di Roma). */
const presenze = (userId: string, n: number, at = '2026-11-04T15:00:00Z') => Array.from({ length: n }, () => ({ userId, at, n: 1 }))

const base = (p: Partial<InputPremiMese> = {}): InputPremiMese => ({
    mese: '2026-11',
    now: new Date('2026-11-09T15:00:00Z'),
    gdo,
    presenze: [...presenze('105', 8), ...presenze('116', 6), ...presenze('106', 5), ...presenze('110', 4), { userId: '110', at: '2026-11-07T10:00:00Z', n: 1 }],
    registrate: {},
    inizioEconomia: new Date('2026-10-25T23:00:00Z'),
    regole,
    ...p,
})

test('novembre fino al 7/11: i numeri di controllo, con il terzo posto a pari merito', () => {
    const m = calcolaPremiMese(base())
    assert.deepEqual(m.chiuse.map(s => s.lunedi), ['2026-11-02'])
    const euro = Object.fromEntries(m.righe.map(r => [r.userId, r.euroMese]))
    assert.deepEqual(euro, { '105': 98, '116': 49, '106': 17, '110': 17, '112': 0 })
    assert.equal(m.totaleMese, 181)
    const v = m.chiuse[0].voci
    assert.deepEqual(v['105'], { presenze: 8, euroPresenze: 48, posizione: 1, euroClassifica: 50, euro: 98 })
    assert.deepEqual(v['106'], { presenze: 5, euroPresenze: 12, posizione: 3, euroClassifica: 5, euro: 17 })
    assert.deepEqual(v['110'], { presenze: 5, euroPresenze: 12, posizione: 3, euroClassifica: 5, euro: 17 })
    // Chi non è più in squadra e non ha presenze non compare.
    assert.equal(m.righe.some(r => r.userId === '999'), false)
})

test('la domenica non conta e la settimana in corso è a parte, provvisoria', () => {
    const m = calcolaPremiMese(base({
        presenze: [
            ...presenze('105', 8),
            { userId: '116', at: '2026-11-08T10:00:00Z', n: 3 },   // domenica 8/11: fuori
            ...presenze('112', 6, '2026-11-10T15:00:00Z'),          // martedì 10/11: in corso
            ...presenze('105', 1, '2026-11-10T16:00:00Z'),
        ],
    }))
    assert.equal(m.chiuse[0].voci['116'], undefined)
    assert.equal(m.inCorso?.lunedi, '2026-11-09')
    assert.deepEqual(m.inCorso?.voci['112'], { presenze: 6, euroPresenze: 24, posizione: 1, euroClassifica: 50, euro: 74 })
    // 105 è secondo per presenze ma ne ha una sola: sotto le 5 non sta sul podio.
    assert.deepEqual(m.inCorso?.voci['105'], { presenze: 1, euroPresenze: 0, posizione: null, euroClassifica: 0, euro: 0 })
    assert.equal(m.righe.find(r => r.userId === '112')?.euroMese, 0)
    assert.equal(m.righe.find(r => r.userId === '112')?.euroInMaturazione, 74)
    assert.equal(m.totaleMese, 98)          // la settimana in corso non entra nel totale del mese
    assert.equal(m.totaleInMaturazione, 74)
})

test('pari merito al primo posto: (50 + 25) / 2 a testa, poi terzo', () => {
    const m = calcolaPremiMese(base({ presenze: [...presenze('105', 6), ...presenze('116', 6), ...presenze('106', 5)] }))
    const v = m.chiuse[0].voci
    assert.equal(v['105'].euroClassifica, 37.5)
    assert.equal(v['116'].euroClassifica, 37.5)
    assert.deepEqual(v['106'], { presenze: 5, euroPresenze: 12, posizione: 3, euroClassifica: 10, euro: 22 })
    assert.equal(m.totaleMese, 37.5 * 2 + 24 * 2 + 22)
})

test('4 presenze = fuori dal podio anche se terzo (PO 09/11/2026: sul podio da 5)', () => {
    const m = calcolaPremiMese(base({
        presenze: [
            ...presenze('105', 8), ...presenze('116', 6), ...presenze('106', 4),
            ...presenze('112', 6, '2026-11-10T15:00:00Z'), ...presenze('110', 4, '2026-11-10T15:00:00Z'),
        ],
    }))
    const v = m.chiuse[0].voci
    assert.deepEqual(v['105'], { presenze: 8, euroPresenze: 48, posizione: 1, euroClassifica: 50, euro: 98 })
    assert.deepEqual(v['116'], { presenze: 6, euroPresenze: 24, posizione: 2, euroClassifica: 25, euro: 49 })
    // Terzo per presenze, ma 4 non bastano: niente posizione e niente 10 euro (non passano a nessuno).
    assert.deepEqual(v['106'], { presenze: 4, euroPresenze: 0, posizione: null, euroClassifica: 0, euro: 0 })
    assert.equal(m.totaleMese, 98 + 49)
    // Settimana in corso: 110 è secondo con 4, il salvadanaio non gli promette il podio.
    const s = salvadanaioDi(m, '110')
    assert.deepEqual(s.inCorso, { lunedi: '2026-11-09', sabato: '2026-11-14', registrata: false, presenze: 4, euroPresenze: 0, posizione: null, euroClassifica: 0, euro: 0 })
    assert.equal(salvadanaioDi(m, '112').inCorso?.posizione, 1)
})

test('settimana a cavallo: 30/11-5/12 conta a dicembre, non a novembre', () => {
    const p = [...presenze('105', 6, '2026-12-02T15:00:00Z')]
    const nov = calcolaPremiMese(base({ presenze: p, now: new Date('2026-12-07T10:00:00Z') }))
    assert.equal(nov.totaleMese, 0)
    assert.equal(nov.inCorso, null)
    const dic = calcolaPremiMese(base({ mese: '2026-12', presenze: p, now: new Date('2026-12-07T10:00:00Z') }))
    assert.equal(dic.chiuse[0].lunedi, '2026-11-30')
    assert.equal(dic.righe.find(r => r.userId === '105')?.euroMese, 24 + 50)
})

test('settimana registrata: valgono i numeri dello snapshot', () => {
    const snap: PremiSettimana = {
        lunedi: '2026-11-02',
        classifica: [{ userId: '116', nome: 'Sara', posizione: 1, presenze: 9, fissati: 0, euro: 50 }],
        presenzeGdo: [{ userId: '116', nome: 'Sara', presenze: 9, pagate: 5, euro: 60 }],
        conferme: null,
        totaleEuro: 110,
    }
    const m = calcolaPremiMese(base({ registrate: { '2026-11-02': snap } }))
    assert.equal(m.chiuse[0].registrata, true)
    assert.deepEqual(m.chiuse[0].voci['116'], { presenze: 9, euroPresenze: 60, posizione: 1, euroClassifica: 50, euro: 110 })
    // 105 non è nello snapshot: presenze dal DB, zero euro.
    assert.deepEqual(m.chiuse[0].voci['105'], { presenze: 8, euroPresenze: 0, posizione: null, euroClassifica: 0, euro: 0 })
    assert.equal(m.totaleMese, 110)
})

test('prima dei premi nuovi non si conta niente', () => {
    const m = calcolaPremiMese(base({ mese: '2026-10', presenze: presenze('105', 8, '2026-10-21T15:00:00Z') }))
    assert.deepEqual(m.chiuse.map(s => s.lunedi), ['2026-10-26'])
    assert.equal(m.totaleMese, 0)
})

test('salvadanaio del GDO: le sue settimane e quella in corso', () => {
    const m = calcolaPremiMese(base({ presenze: [...presenze('105', 8), ...presenze('105', 5, '2026-11-10T15:00:00Z')] }))
    const s = salvadanaioDi(m, '105')
    assert.equal(s.mese, '2026-11')
    assert.equal(s.euroMese, 98)
    assert.deepEqual(s.settimane, [{ lunedi: '2026-11-02', sabato: '2026-11-07', registrata: false, presenze: 8, euroPresenze: 48, posizione: 1, euroClassifica: 50, euro: 98 }])
    assert.deepEqual(s.inCorso, { lunedi: '2026-11-09', sabato: '2026-11-14', registrata: false, presenze: 5, euroPresenze: 12, posizione: 1, euroClassifica: 50, euro: 62 })
    const vuoto = salvadanaioDi(m, 'nessuno')
    assert.equal(vuoto.euroMese, 0)
    assert.equal(vuoto.settimane[0].euro, 0)
})

test('testi: nome del mese e date della settimana', () => {
    assert.equal(nomeMese('2026-11'), 'novembre')
    assert.equal(nomeMese('2027-01'), 'gennaio')
    assert.equal(dateSettimana('2026-11-02', '2026-11-07'), '2-7 novembre')
    assert.equal(dateSettimana('2026-11-30', '2026-12-05'), '30 novembre - 5 dicembre')
})
