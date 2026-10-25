import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    calcolaSerie, DEFAULT_SERIE, giorniFatti, parseSerie, pianoSerie, prossimaTappa, puoComprareScudo,
    scudiComprati, scudiDelMese, tappaIdemKey, type RigaSerie,
} from './serie'
import { toRomeDateStr } from '@/lib/dateUtils'
import { addDays, isWorkingDay } from '@/lib/quotes/calendar'

const U = 'u1'
const at = (giorno: string, hhmm = '18:00') => new Date(`${giorno}T${hhmm}:00+01:00`)
const scalino = (giorno: string, gen = 1): RigaSerie => ({
    idemKey: `S:scalino:${U}:${giorno}:1${gen > 1 ? `:${gen}` : ''}`, reason: 'scalino_personale', amount: 20, createdAt: at(giorno), metadata: null,
})
const storno = (k: string, giorno: string): RigaSerie => ({ idemKey: `storno:${k}`, reason: 'storno', amount: -20, createdAt: at(giorno, '19:00'), metadata: null })
const scudo = (giorno: string, id = `s-${giorno}`): RigaSerie => ({
    idemKey: `buy:${id}`, reason: 'negozio', amount: -400, createdAt: at(giorno, '14:00'), metadata: { purchaseId: id, itemId: 'scudo-serie', scudo: true },
})
const fatti = (...giorni: string[]) => new Set(giorni)

// Settimana lun 26/10 - sab 31/10, domenica 1/11 (anche festa), lun 2/11...
const SETTIMANA = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']

test('serie: giorni fatti = primo scalino attivo, gli stornati no, la rigenerazione sì', () => {
    const righe = [
        scalino('2026-10-26'),
        scalino('2026-10-27'), storno(`S:scalino:${U}:2026-10-27:1`, '2026-10-27'),
        scalino('2026-10-28'), storno(`S:scalino:${U}:2026-10-28:1`, '2026-10-28'), scalino('2026-10-28', 2),
        { ...scalino('2026-10-29'), idemKey: `S:scalino:${U}:2026-10-29:2` }, // secondo scalino: non conta
        { ...scalino('2026-10-30'), idemKey: `S:scalino:altro:2026-10-30:1` },
    ]
    assert.deepEqual([...giorniFatti(righe, U)].sort(), ['2026-10-26', '2026-10-28'])
})

test('serie: giorni di fila, domenica e festa saltate, oggi conta solo se fatto', () => {
    const tutti = fatti(...SETTIMANA, '2026-11-02')
    const s = calcolaSerie({ fatti: tutti, scudi: [], oggi: '2026-11-02' })
    assert.equal(s.giorni, 7)
    assert.equal(s.inizio, '2026-10-26')
    assert.equal(s.oggiFatto, true)
    // Oggi non ancora fatto: la serie resta, non si rompe.
    const ieri = calcolaSerie({ fatti: fatti(...SETTIMANA), scudi: [], oggi: '2026-11-02' })
    assert.equal(ieri.giorni, 6)
    assert.equal(ieri.oggiFatto, false)
    // Domenica: non è lavorativa, non conta e non rompe.
    const domenica = calcolaSerie({ fatti: fatti(...SETTIMANA), scudi: [], oggi: '2026-11-01' })
    assert.equal(domenica.giorni, 6)
    assert.equal(domenica.oggiLavorativo, false)
})

test('serie: un giorno mancato la azzera, la serie nuova riparte da lì', () => {
    const s = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'), scudi: [], oggi: '2026-10-30' })
    assert.equal(s.giorni, 2)
    assert.equal(s.inizio, '2026-10-29')
})

test('serie: le chiusure dell\'ufficio si saltano come le feste', () => {
    const s = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-28'), scudi: [], oggi: '2026-10-28', chiusi: new Set(['2026-10-27']) })
    assert.equal(s.giorni, 2)
    // Festa nazionale: 8 dicembre 2026 (martedì).
    const f = calcolaSerie({ fatti: fatti('2026-12-07', '2026-12-09'), scudi: [], oggi: '2026-12-09' })
    assert.equal(f.giorni, 2)
})

test('scudo: salva un giorno mancato, si consuma da solo, il secondo buco rompe', () => {
    const acquisti = scudiComprati([scudo('2026-10-26')], toRomeDateStr)
    const s = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-28', '2026-10-29'), scudi: acquisti, oggi: '2026-10-29' })
    assert.equal(s.giorni, 3)
    assert.equal(s.inizio, '2026-10-26')
    assert.deepEqual(s.salvati, ['2026-10-27'])
    assert.equal(s.scudiInTasca, 0)
    const due = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-28', '2026-10-30'), scudi: acquisti, oggi: '2026-10-30' })
    assert.equal(due.giorni, 1)
    assert.equal(due.inizio, '2026-10-30')
})

test('scudo: resta in tasca finché non serve, e senza serie non si spreca', () => {
    const acquisti = scudiComprati([scudo('2026-10-26')], toRomeDateStr)
    const intatto = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-27'), scudi: acquisti, oggi: '2026-10-28' })
    assert.equal(intatto.scudiInTasca, 1)
    // Comprato a serie zero, primo giorno mancato: non c'è niente da salvare.
    const vuoto = calcolaSerie({ fatti: fatti('2026-10-28'), scudi: scudiComprati([scudo('2026-10-26')], toRomeDateStr), oggi: '2026-10-28' })
    assert.equal(vuoto.scudiInTasca, 1)
    assert.equal(vuoto.giorni, 1)
    // Comprato il giorno stesso del buco: vale per quel giorno.
    const stesso = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-28'), scudi: scudiComprati([scudo('2026-10-27')], toRomeDateStr), oggi: '2026-10-28' })
    assert.equal(stesso.giorni, 2)
    // Comprato dopo il buco: troppo tardi.
    const tardi = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-28'), scudi: scudiComprati([scudo('2026-10-28')], toRomeDateStr), oggi: '2026-10-28' })
    assert.equal(tardi.giorni, 1)
    assert.equal(tardi.scudiInTasca, 1)
})

test('scudo: annullato e rimborsato non conta', () => {
    const righe = [scudo('2026-10-26', 'x'), { idemKey: 'refund:x', reason: 'negozio_rimborso', amount: 400, createdAt: at('2026-10-27'), metadata: { purchaseId: 'x' } }]
    assert.deepEqual(scudiComprati(righe, toRomeDateStr), [])
})

test('scudo: uno in tasca e due al mese', () => {
    const r = DEFAULT_SERIE
    const due = scudiComprati([scudo('2026-10-05'), scudo('2026-10-20')], toRomeDateStr)
    assert.deepEqual(puoComprareScudo({ stato: { scudiInTasca: 1 }, scudi: [], oggi: '2026-10-28', rules: r }), { ok: false, error: 'scudo_tasca' })
    assert.deepEqual(puoComprareScudo({ stato: { scudiInTasca: 0 }, scudi: due, oggi: '2026-10-28', rules: r }), { ok: false, error: 'scudo_mese' })
    assert.deepEqual(puoComprareScudo({ stato: { scudiInTasca: 0 }, scudi: due, oggi: '2026-11-02', rules: r }), { ok: true })
    assert.equal(scudiDelMese(due, '2026-10-31'), 2)
})

test('tappe: si accreditano una volta per serie, legate all\'inizio', () => {
    const stato = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-27', '2026-10-28'), scudi: [], oggi: '2026-10-28' })
    const oggiDa = at('2026-10-28', '00:00')
    const p = pianoSerie([], U, stato, DEFAULT_SERIE, oggiDa)
    assert.deepEqual(p.accredita, [{ valuta: 'S', amount: 15, giorni: 3, idemKey: `S:serie:${U}:2026-10-26:3` }])
    assert.deepEqual(p.storna, [])
    const gia: RigaSerie = { idemKey: `S:serie:${U}:2026-10-26:3`, reason: 'serie', amount: 15, createdAt: at('2026-10-28'), metadata: null }
    assert.deepEqual(pianoSerie([gia], U, stato, DEFAULT_SERIE, oggiDa), { accredita: [], storna: [] })
})

test('tappe: scalino di oggi stornato = tappa di oggi stornata; ripresa con chiave nuova', () => {
    const oggiDa = at('2026-10-28', '00:00')
    const presa: RigaSerie = { idemKey: `S:serie:${U}:2026-10-26:3`, reason: 'serie', amount: 15, createdAt: at('2026-10-28'), metadata: null }
    const senzaOggi = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-27'), scudi: [], oggi: '2026-10-28' })
    assert.deepEqual(pianoSerie([presa], U, senzaOggi, DEFAULT_SERIE, oggiDa), { accredita: [], storna: [presa.idemKey] })
    const stornata = { idemKey: `storno:${presa.idemKey}`, reason: 'storno', amount: -15, createdAt: at('2026-10-28', '19:00'), metadata: null }
    const diNuovo = calcolaSerie({ fatti: fatti('2026-10-26', '2026-10-27', '2026-10-28'), scudi: [], oggi: '2026-10-28' })
    assert.deepEqual(pianoSerie([presa, stornata], U, diNuovo, DEFAULT_SERIE, oggiDa).accredita.map(a => a.idemKey), [`S:serie:${U}:2026-10-26:3:2`])
})

test('tappe: quelle di una serie finita e dei giorni passati non si toccano', () => {
    const vecchia: RigaSerie = { idemKey: `S:serie:${U}:2026-10-01:3`, reason: 'serie', amount: 15, createdAt: at('2026-10-05'), metadata: null }
    const stato = calcolaSerie({ fatti: fatti('2026-10-28'), scudi: [], oggi: '2026-10-28' })
    assert.deepEqual(pianoSerie([vecchia], U, stato, DEFAULT_SERIE, at('2026-10-28', '00:00')), { accredita: [], storna: [] })
})

test('tappe: a 60 anche le Piume; prossima tappa', () => {
    const giorni: string[] = []
    let d = new Date(Date.UTC(2026, 10, 2))
    while (giorni.length < 60) {
        const s = d.toISOString().slice(0, 10)
        if (d.getUTCDay() !== 0 && !['2026-12-08', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06'].includes(s)) giorni.push(s)
        d = new Date(d.getTime() + 86_400_000)
    }
    const oggi = giorni[giorni.length - 1]
    const stato = calcolaSerie({ fatti: new Set(giorni), scudi: [], oggi })
    assert.equal(stato.giorni, 60)
    const p = pianoSerie([], U, stato, DEFAULT_SERIE, at(oggi, '00:00'))
    assert.equal(p.accredita.filter(a => a.valuta === 'S').reduce((s, a) => s + a.amount, 0), 805)
    assert.deepEqual(p.accredita.filter(a => a.valuta === 'P'), [{ valuta: 'P', amount: 20, giorni: 60, idemKey: tappaIdemKey('P', U, giorni[0], 60) }])
    assert.deepEqual(prossimaTappa(0, DEFAULT_SERIE), DEFAULT_SERIE.tappe[0])
    assert.equal(prossimaTappa(3, DEFAULT_SERIE)?.giorni, 6)
    assert.deepEqual(prossimaTappa(60, DEFAULT_SERIE), { giorni: 90, scintille: 250, piume: 0 })
})

/** I primi `n` giorni lavorativi da lunedì 2/11/2026. */
function giorniDiLavoro(n: number): string[] {
    const out: string[] = []
    for (let d = '2026-11-02'; out.length < n; d = addDays(d, 1)) if (isWorkingDay(d)) out.push(d)
    return out
}

test('tappe oltre i 60 (PO 25/10/2026): ogni 30 giorni 250 Scintille, Piume a 120 e 180, poi più niente', () => {
    assert.deepEqual(DEFAULT_SERIE.tappe.slice(-5), [
        { giorni: 60, scintille: 250, piume: 20 },
        { giorni: 90, scintille: 250, piume: 0 },
        { giorni: 120, scintille: 250, piume: 20 },
        { giorni: 150, scintille: 250, piume: 0 },
        { giorni: 180, scintille: 250, piume: 20 },
    ])
    const giorni = giorniDiLavoro(200)
    // A 180 giorni: tutte le tappe, una volta sola.
    const a180 = giorni.slice(0, 180)
    const stato180 = calcolaSerie({ fatti: new Set(a180), scudi: [], oggi: a180[179] })
    assert.equal(stato180.giorni, 180)
    const p = pianoSerie([], U, stato180, DEFAULT_SERIE, at(a180[179], '00:00'))
    assert.equal(p.accredita.filter(a => a.valuta === 'S').reduce((s, a) => s + a.amount, 0), 805 + 4 * 250)
    assert.deepEqual(p.accredita.filter(a => a.valuta === 'P').map(a => a.giorni), [60, 120, 180])
    assert.equal(prossimaTappa(150, DEFAULT_SERIE)?.giorni, 180)
    assert.equal(prossimaTappa(180, DEFAULT_SERIE), null)
    // Oltre i 180 la serie conta ma non paga altro.
    const stato200 = calcolaSerie({ fatti: new Set(giorni), scudi: [], oggi: giorni[199] })
    assert.equal(stato200.giorni, 200)
    const gia: RigaSerie[] = p.accredita.map(a => ({ idemKey: a.idemKey, reason: 'serie', amount: a.amount, createdAt: at(a180[179]), metadata: null }))
    assert.deepEqual(pianoSerie(gia, U, stato200, DEFAULT_SERIE, at(giorni[199], '00:00')), { accredita: [], storna: [] })
})

test('serie: regole lette dal JSON', () => {
    assert.deepEqual(parseSerie(undefined), DEFAULT_SERIE)
    assert.deepEqual(parseSerie({ tappe: [{ giorni: 5, scintille: 10 }, { giorni: 3, scintille: 5 }] }).tappe, DEFAULT_SERIE.tappe)
    assert.deepEqual(parseSerie({ tappe: [{ giorni: 2, scintille: 5 }, { giorni: 4, scintille: 9, piume: 1 }], scudiAlMese: 1 }), {
        tappe: [{ giorni: 2, scintille: 5, piume: 0 }, { giorni: 4, scintille: 9, piume: 1 }], scudiAlMese: 1, scudiInTasca: 1,
    })
})
