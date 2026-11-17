import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    calcolaPremiMese, salvadanaioDi, salvadanaioConfermeDi, settimanaScorsa, meseDellaSettimana,
    vistaSalvadanaioConferme, chiaveSettimana, prendeQuotaConferme,
    settimaneDelMese, meseDelSalvadanaio, nomeMese, dateSettimana, type InputPremiMese,
} from './premiMese'
import { DEFAULT_ECONOMY_RULES } from './rules'
import { DEFAULT_CONFERME_BONUS } from '@/lib/conferme/bonus'
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

// ── Conferme nel salvadanaio del mese (titolare 14/11/2026) ─────────────

const ALBERTO = 'c-alberto', ANDREA = 'c-andrea', NOEMI_C = 'c-noemi', CHRISTEL = 'c-christel'
const NOEMI_GDO = '107'
const personeConferme = [
    { userId: ALBERTO, nome: 'Alberto', squadra: true },
    { userId: ANDREA, nome: 'Andre', squadra: true },
    { userId: NOEMI_C, nome: 'Noemi', squadra: true },
    // Disattivata oggi: ha lavorato solo nella settimana 2-7/11.
    { userId: CHRISTEL, nome: 'Christel', squadra: false },
]
/** n istanti nello stesso momento. */
const volte = (n: number, at: string) => Array.from({ length: n }, () => at)
const conferme = (p: Partial<NonNullable<InputPremiMese['conferme']>> = {}): NonNullable<InputPremiMese['conferme']> => ({
    persone: personeConferme,
    chiusure: [],
    presenze: [],
    confermate: [],
    regola: DEFAULT_CONFERME_BONUS,
    ...p,
})
const confermate = (userIds: string[], at: string) => userIds.map(userId => ({ userId, at }))
const NOW_14_11 = new Date('2026-11-14T15:00:00Z')   // sabato 14/11 pomeriggio: 9-14/11 in corso

test('conferme: settimana sopra soglia, gli stessi euro a testa a chi ha confermato', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        gdo: [...gdo, { userId: NOEMI_GDO, nome: 'Noemi', squadra: true }],
        conferme: conferme({
            // 2-7/11: 4 chiusure, sotto soglia. 9-14/11: 28 chiusure, 12 oltre la 16ª.
            chiusure: [...volte(4, '2026-11-05T15:00:00Z'), ...volte(28, '2026-11-11T15:00:00Z')],
            confermate: [
                ...confermate([ALBERTO, ANDREA, NOEMI_C, CHRISTEL], '2026-11-03T10:00:00Z'),
                ...confermate([ALBERTO, ANDREA, NOEMI_C], '2026-11-10T10:00:00Z'),
            ],
        }),
    }))
    const sett = m.chiuse[0].conferme
    assert.equal(sett?.conteggio, 4)
    assert.equal(sett?.euroATesta, 0)
    assert.deepEqual(sett?.persone, [])
    const c = m.inCorso?.conferme
    assert.equal(c?.conteggio, 28)
    assert.equal(c?.oltre, 12)
    assert.equal(c?.euroATesta, 144)
    assert.deepEqual(c?.persone.map(p => [p.nome, p.euro]), [['Alberto', 144], ['Andre', 144], ['Noemi', 144]])

    const righeC = m.righe.filter(r => r.ruolo === 'CONFERME')
    assert.deepEqual(righeC.map(r => [r.nome, r.euroMese, r.euroInMaturazione]).sort(), [['Alberto', 0, 144], ['Andre', 0, 144], ['Noemi', 0, 144]])
    // Il totale del mese resta quello dei GDO: niente totale di squadra delle Conferme.
    assert.equal(m.totaleInMaturazione, m.inCorso?.totaleEuro)
    assert.equal(Object.keys(m.inCorso?.voci ?? {}).some(id => id.startsWith('c-')), false)

    const s = salvadanaioConfermeDi(m, ANDREA)
    assert.equal(s.euroMese, 0)
    assert.deepEqual(s.settimane.map(w => [w.lunedi, w.conteggio, w.euro]), [['2026-11-02', 4, 0]])
    assert.equal(s.inCorso?.euro, 144)
    assert.equal(s.inCorso?.euroATesta, 144)
})

test('conferme: chi non ha confermato nella settimana non prende la quota', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        conferme: conferme({
            chiusure: volte(20, '2026-11-11T15:00:00Z'),
            confermate: confermate([ALBERTO, NOEMI_C], '2026-11-10T10:00:00Z'),
        }),
    }))
    assert.deepEqual(m.inCorso?.conferme?.persone.map(p => p.userId).sort(), [ALBERTO, NOEMI_C].sort())
    assert.equal(salvadanaioConfermeDi(m, ANDREA).inCorso?.euro, 0)
    assert.equal(salvadanaioConfermeDi(m, ANDREA).inCorso?.euroATesta, 48)
})

test('conferme: la domenica non conta, né per le chiusure né per chi ha confermato', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        conferme: conferme({
            chiusure: [...volte(17, '2026-11-05T15:00:00Z'), ...volte(5, '2026-11-08T10:00:00Z')],
            confermate: [...confermate([ALBERTO], '2026-11-03T10:00:00Z'), ...confermate([ANDREA], '2026-11-08T10:00:00Z')],
        }),
    }))
    assert.equal(m.chiuse[0].conferme?.conteggio, 17)
    assert.deepEqual(m.chiuse[0].conferme?.persone.map(p => [p.userId, p.euro]), [[ALBERTO, 12]])
    assert.equal(m.inCorso?.conferme?.conteggio, 0)
})

test('conferme: la settimana registrata vince sul ricalcolo', () => {
    const snap: PremiSettimana = {
        lunedi: '2026-11-02',
        classifica: [],
        presenzeGdo: [],
        conferme: { unita: 'chiusure', conteggio: 18, soglia: 16, oltre: 2, euroPerUnita: 12, euroATesta: 24, persone: [{ userId: ALBERTO, nome: 'Alberto', euro: 24 }] },
        totaleEuro: 24,
    }
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        presenze: [],
        registrate: { '2026-11-02': snap },
        conferme: conferme({ chiusure: volte(30, '2026-11-05T15:00:00Z'), confermate: confermate([ALBERTO, ANDREA], '2026-11-03T10:00:00Z') }),
    }))
    assert.equal(m.chiuse[0].registrata, true)
    assert.equal(m.chiuse[0].conferme?.conteggio, 18)
    assert.equal(salvadanaioConfermeDi(m, ALBERTO).euroMese, 24)
    assert.equal(salvadanaioConfermeDi(m, ANDREA).euroMese, 0)
    // Il totale dei GDO non prende gli euro delle Conferme dello snapshot.
    assert.equal(m.chiuse[0].totaleEuro, 0)
    assert.equal(m.totaleMese, 0)
})

test('conferme: 26-31/10 conta in ottobre, 30/11-5/12 in dicembre', () => {
    const c = conferme({
        chiusure: [...volte(19, '2026-10-28T15:00:00Z'), ...volte(20, '2026-12-02T15:00:00Z')],
        confermate: [...confermate([ALBERTO, ANDREA, NOEMI_C], '2026-10-27T10:00:00Z'), ...confermate([ALBERTO], '2026-12-01T10:00:00Z')],
    })
    const ott = calcolaPremiMese(base({ mese: '2026-10', now: new Date('2026-12-07T10:00:00Z'), presenze: [], conferme: c }))
    assert.deepEqual(ott.chiuse.map(s => [s.lunedi, s.conferme?.conteggio, s.conferme?.euroATesta]), [['2026-10-26', 19, 36]])
    for (const id of [ALBERTO, ANDREA, NOEMI_C]) assert.equal(salvadanaioConfermeDi(ott, id).euroMese, 36)
    const nov = calcolaPremiMese(base({ mese: '2026-11', now: new Date('2026-12-07T10:00:00Z'), presenze: [], conferme: c }))
    assert.equal(nov.chiuse.some(s => (s.conferme?.conteggio ?? 0) > 0), false)
    assert.equal(salvadanaioConfermeDi(nov, ALBERTO).euroMese, 0)
    const dic = calcolaPremiMese(base({ mese: '2026-12', now: new Date('2026-12-07T10:00:00Z'), presenze: [], conferme: c }))
    assert.equal(dic.chiuse[0].lunedi, '2026-11-30')
    assert.equal(salvadanaioConfermeDi(dic, ALBERTO).euroMese, 48)
})

test('conferme: chi oggi è disattivato ma ha lavorato una settimana passata resta', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        conferme: conferme({
            chiusure: volte(18, '2026-11-05T15:00:00Z'),
            confermate: confermate([ALBERTO, CHRISTEL], '2026-11-03T10:00:00Z'),
        }),
    }))
    assert.deepEqual(m.chiuse[0].conferme?.persone.map(p => p.nome).sort(), ['Alberto', 'Christel'])
    const r = m.righe.find(x => x.userId === CHRISTEL)
    assert.deepEqual(r, { userId: CHRISTEL, nome: 'Christel', ruolo: 'CONFERME', euroMese: 24, euroInMaturazione: 0 })
    // Senza bonus nel mese, chi non è più in squadra non compare.
    const vuoto = calcolaPremiMese(base({ now: NOW_14_11, conferme: conferme() }))
    assert.equal(vuoto.righe.some(x => x.userId === CHRISTEL), false)
})

test('conferme: Noemi con due account, due righe distinte riconoscibili dal ruolo', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        gdo: [...gdo, { userId: NOEMI_GDO, nome: 'Noemi', squadra: true }],
        presenze: [...presenze(NOEMI_GDO, 6)],
        conferme: conferme({ chiusure: volte(17, '2026-11-05T15:00:00Z'), confermate: confermate([NOEMI_C], '2026-11-03T10:00:00Z') }),
    }))
    const noemi = m.righe.filter(r => r.nome === 'Noemi')
    assert.deepEqual(noemi.map(r => [r.ruolo, r.userId, r.euroMese]).sort(), [['CONFERME', NOEMI_C, 12], ['GDO', NOEMI_GDO, 74]])
    assert.equal(salvadanaioDi(m, NOEMI_GDO).euroMese, 74)
    assert.equal(salvadanaioConfermeDi(m, NOEMI_C).euroMese, 12)
    assert.equal(salvadanaioConfermeDi(m, NOEMI_GDO).euroMese, 0)
})

test('conferme: i GDO non cambiano di un centesimo', () => {
    const p = [...presenze('105', 8), ...presenze('116', 6), ...presenze('106', 5), ...presenze('112', 6, '2026-11-10T15:00:00Z')]
    const senza = calcolaPremiMese(base({ now: NOW_14_11, presenze: p }))
    const con = calcolaPremiMese(base({
        now: NOW_14_11,
        presenze: p,
        conferme: conferme({
            chiusure: [...volte(25, '2026-11-05T15:00:00Z'), ...volte(28, '2026-11-11T15:00:00Z')],
            confermate: [...confermate([ALBERTO, ANDREA], '2026-11-03T10:00:00Z'), ...confermate([ALBERTO, ANDREA, NOEMI_C], '2026-11-10T10:00:00Z')],
        }),
    }))
    assert.deepEqual(con.righe.filter(r => r.ruolo === 'GDO'), senza.righe)
    assert.equal(con.totaleMese, senza.totaleMese)
    assert.equal(con.totaleInMaturazione, senza.totaleInMaturazione)
    assert.deepEqual(con.chiuse.map(s => [s.voci, s.totaleEuro]), senza.chiuse.map(s => [s.voci, s.totaleEuro]))
    assert.deepEqual([con.inCorso?.voci, con.inCorso?.totaleEuro], [senza.inCorso?.voci, senza.inCorso?.totaleEuro])
    for (const id of ['105', '116', '106', '112']) assert.deepEqual(salvadanaioDi(con, id), salvadanaioDi(senza, id))
    // Senza conferme in ingresso ogni riga è GDO e la settimana non ha bonus Conferme.
    assert.ok(senza.righe.every(r => r.ruolo === 'GDO'))
    assert.equal(senza.chiuse[0].conferme, null)
})

test('conferme: con la regola a mese niente bonus a settimana', () => {
    const m = calcolaPremiMese(base({
        now: NOW_14_11,
        conferme: conferme({ regola: { ...DEFAULT_CONFERME_BONUS, periodo: 'mese' }, chiusure: volte(30, '2026-11-05T15:00:00Z'), confermate: confermate([ALBERTO], '2026-11-03T10:00:00Z') }),
    }))
    assert.equal(m.chiuse[0].conferme, null)
    const s = salvadanaioConfermeDi(m, ALBERTO)
    assert.equal(s.settimane[0].conteggio, null)
    assert.equal(s.euroMese, 0)
})

test('settimana scorsa: dal lunedì al sabato quella prima, di domenica quella appena chiusa', () => {
    assert.equal(settimanaScorsa(NOW_14_11).lunedi, '2026-11-02')
    assert.equal(settimanaScorsa(new Date('2026-11-09T08:00:00Z')).lunedi, '2026-11-02')
    assert.equal(settimanaScorsa(new Date('2026-11-15T10:00:00Z')).lunedi, '2026-11-09')
    // Lunedì 2/11: la settimana scorsa è 26-31/10, di ottobre.
    const s = settimanaScorsa(new Date('2026-11-02T10:00:00Z'))
    assert.equal(s.lunedi, '2026-10-26')
    assert.equal(meseDellaSettimana(s), '2026-10')
})

// ── Revisione 14/11/2026 ───────────────────────────────────────────────

/** Il calcolo di sabato 14/11 pomeriggio, come resterebbe in cache fino a lunedì. */
const calcoloDiSabato = () => calcolaPremiMese(base({
    now: NOW_14_11,
    presenze: [...presenze('105', 8), ...presenze('112', 6, '2026-11-10T15:00:00Z')],
    conferme: conferme({
        chiusure: [...volte(4, '2026-11-05T15:00:00Z'), ...volte(28, '2026-11-11T15:00:00Z')],
        confermate: [...confermate([ALBERTO, ANDREA, NOEMI_C], '2026-11-03T10:00:00Z'), ...confermate([ALBERTO, ANDREA, NOEMI_C], '2026-11-10T10:00:00Z')],
    }),
}))

test('vista Conferme: calcolo fresco di sabato, la settimana scorsa è 2-7/11 e 9-14/11 matura', () => {
    const v = vistaSalvadanaioConferme(calcoloDiSabato(), null, ANDREA, NOW_14_11)
    assert.equal(v.scorsa?.lunedi, '2026-11-02')
    assert.equal(v.scorsa?.euro, 0)
    assert.equal(v.mese.inCorso?.euro, 144)
    assert.equal(v.mese.euroMese, 0)
})

test('vista Conferme: dato di sabato servito domenica o lunedì, la settimana finita conta come chiusa', () => {
    const vecchio = calcoloDiSabato()
    for (const now of [new Date('2026-11-15T10:00:00Z'), new Date('2026-11-16T07:00:00Z')]) {
        const v = vistaSalvadanaioConferme(vecchio, null, ANDREA, now)
        assert.equal(v.scorsa?.lunedi, '2026-11-09', now.toISOString())
        assert.equal(v.scorsa?.euro, 144)
        assert.equal(v.scorsa?.conteggio, 28)
        assert.deepEqual(v.mese.settimane.map(s => [s.lunedi, s.euro]), [['2026-11-02', 0], ['2026-11-09', 144]])
        assert.equal(v.mese.euroMese, 144)
        assert.equal(v.mese.inCorso, null)
    }
    // Il dato in cache non si tocca: i GDO restano quelli del calcolo.
    assert.deepEqual(vecchio, calcoloDiSabato())
})

test('vista Conferme: la settimana scorsa del mese prima arriva dal suo mese', () => {
    const c = conferme({ chiusure: volte(19, '2026-10-28T15:00:00Z'), confermate: confermate([ALBERTO], '2026-10-27T10:00:00Z') })
    const now = new Date('2026-11-03T10:00:00Z')
    const ott = calcolaPremiMese(base({ mese: '2026-10', now, presenze: [], conferme: c }))
    const nov = calcolaPremiMese(base({ now, presenze: [], conferme: c }))
    const v = vistaSalvadanaioConferme(nov, ott, ALBERTO, now)
    assert.equal(v.scorsa?.lunedi, '2026-10-26')
    assert.equal(v.scorsa?.euro, 36)
    assert.equal(v.mese.mese, '2026-11')
})

test('chiave della settimana: cambia a mezzanotte di sabato e al lunedì di Roma', () => {
    assert.equal(chiaveSettimana(new Date('2026-11-14T22:30:00Z')), '2026-11-09')          // sabato 23:30
    assert.equal(chiaveSettimana(new Date('2026-11-14T23:30:00Z')), '2026-11-09-chiusa')   // domenica 00:30
    assert.equal(chiaveSettimana(new Date('2026-11-15T10:00:00Z')), '2026-11-09-chiusa')   // domenica
    assert.equal(chiaveSettimana(new Date('2026-11-15T23:30:00Z')), '2026-11-16')          // lunedì 00:30
})

test('quota Conferme: persone attive, disattivate solo con un nome vero, mai bot o altri ruoli', () => {
    const p = (x: Partial<{ role: string; isActive: boolean; isBot: boolean; firstName: string | null }>) =>
        prendeQuotaConferme({ role: 'CONFERME', isActive: true, isBot: false, firstName: null, ...x })
    assert.equal(p({}), true)                                         // Alberto: attivo, senza firstName
    assert.equal(p({ firstName: 'Andre' }), true)
    assert.equal(p({ isActive: false, firstName: 'Christel' }), true) // persona disattivata con il nome vero
    assert.equal(p({ isActive: false, firstName: null }), false)      // "Team Conferme": disattivato, nessun nome vero
    assert.equal(p({ isActive: false, firstName: '  ' }), false)
    assert.equal(p({ isBot: true }), false)
    assert.equal(p({ role: 'GDO' }), false)
})

test('testi: nome del mese e date della settimana', () => {
    assert.equal(nomeMese('2026-11'), 'novembre')
    assert.equal(nomeMese('2027-01'), 'gennaio')
    assert.equal(dateSettimana('2026-11-02', '2026-11-07'), '2-7 novembre')
    assert.equal(dateSettimana('2026-11-30', '2026-12-05'), '30 novembre - 5 dicembre')
})
