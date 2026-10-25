import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_ECONOMY_RULES, parseEconomyRules, inizioEconomia,
    finestraIndex, fissatoIdemKey, pianoFissato, fissatiDaStornare,
    cicloInCorso, inizioStorno,
    scalinoIdemKey, pianoScalini, rewardFissato,
    piumeDovute, stadioGdo, importiGdo, importiDaValori, pianoStadi, stadioIdemKey, PREFISSO_STADI, causaleGradinoGdo,
    stadioConferme, confermaUtile, confermaInTempo, importiConferme, titolareConferma, confermaRegistrata, sottoTettoConferme, isConfermePersona,
    obiettiviPersona, obiettivoIdemKey, pianoObiettivo, contaObiettivi, premioClassifica,
    forzieriRaggiunti, tierForziere,
    contenutoForziere, destinatariForziere, chestIdemKey,
    confermeNonHannoToccato, isPersonaleUmano, puoAccreditarePiume, fissatoPremiabile,
    type EventoCiclo, type LedgerRow, type LeadObiettivo,
} from './rules'
import { DEFAULT_TARGETS, isTeamMember } from '@/lib/diretta/config'

const LEAD = 'lead-1'
const giorno = (iso: string) => new Date(iso)

// ── Regole ──────────────────────────────────────────────────────────────

test('parseEconomyRules: default se vuoto o rotto, merge profondo se parziale', () => {
    assert.deepEqual(parseEconomyRules(null), DEFAULT_ECONOMY_RULES)
    assert.deepEqual(parseEconomyRules('{rotto'), DEFAULT_ECONOMY_RULES)
    const r = parseEconomyRules(JSON.stringify({ fissato: { tettoGiorno: 12 }, forzieri: { raro: { probPiuma: 0.1 } } }))
    assert.equal(r.fissato.tettoGiorno, 12)
    assert.equal(r.fissato.scintille, 10)
    assert.equal(r.forzieri.raro.probPiuma, 0.1)
    assert.deepEqual(r.forzieri.raro.scintille, [10, 30])
    assert.deepEqual(r.forzieri.leggendario, DEFAULT_ECONOMY_RULES.forzieri.leggendario)
    assert.deepEqual(r.conferme, DEFAULT_ECONOMY_RULES.conferme)
    assert.deepEqual(r.classifica, DEFAULT_ECONOMY_RULES.classifica)
})

test('parseEconomyRules: valori assurdi tornano al default', () => {
    const r = parseEconomyRules(JSON.stringify({
        fissato: { scintille: -5, finestraGiorni: 0, tettoGiorno: 'tanti' },
        scaliniPersonali: [20],
        piume: { chiusura: 2.5 },
        forzieri: { raro: { probPiuma: 3, scintille: [80, 10] }, minFissatiGiorno: -1 },
        conferme: {
            scintille: { conferma: -1, inTempoMinuti: 'presto' },
            obiettivi: { presenze: { soglie: [22, 16] }, chiusure: { piume: [-1, 2] } },
            perPersona: { u1: { presenze: [0, 3] }, u2: 'niente' },
        },
        classifica: { premiEuro: [50, -25, 10.555], minPresenze: 0 },
        inizio: '26/10/2026',
    }))
    assert.deepEqual(r, DEFAULT_ECONOMY_RULES)
})

test('parseEconomyRules: gli stadi devono crescere, altrimenti torna il default del blocco', () => {
    // La presenza che vale meno della conferma toglierebbe Piume salendo di stadio.
    assert.deepEqual(parseEconomyRules(JSON.stringify({ piume: { conferma: 3, presenza: 2, chiusura: 5 } })).piume, DEFAULT_ECONOMY_RULES.piume)
    assert.deepEqual(parseEconomyRules(JSON.stringify({ piume: { conferma: 0, presenza: 3, chiusura: 6 } })).piume, { conferma: 0, presenza: 3, chiusura: 6 })
    const c = parseEconomyRules(JSON.stringify({ conferme: { scintille: { conferma: 30, presenza: 20 } } }))
    assert.equal(c.conferme.scintille.conferma, DEFAULT_ECONOMY_RULES.conferme.scintille.conferma)
    assert.equal(c.conferme.scintille.presenza, DEFAULT_ECONOMY_RULES.conferme.scintille.presenza)
})

test('parseEconomyRules: soglie per persona, premi della classifica e obiettivi salvati', () => {
    const r = parseEconomyRules(JSON.stringify({
        conferme: { perPersona: { andrea: { presenze: [10, 14], chiusure: [4, 5] }, vuoto: {} }, obiettivi: { chiusure: { soglie: [6, 9], piume: [5, 5] } } },
        classifica: { premiEuro: [60, 30, 15.5], minPresenze: 2 },
    }))
    assert.deepEqual(r.conferme.perPersona, { andrea: { presenze: [10, 14], chiusure: [4, 5] } })
    assert.deepEqual(r.conferme.obiettivi.chiusure, { soglie: [6, 9], piume: [5, 5] })
    assert.deepEqual(r.conferme.obiettivi.presenze, DEFAULT_ECONOMY_RULES.conferme.obiettivi.presenze)
    assert.deepEqual(r.classifica, { premiEuro: [60, 30, 15.5], minPresenze: 2 })
})

test('default dell\'economia v2 (25/10/2026 sera)', () => {
    const d = DEFAULT_ECONOMY_RULES
    assert.equal(d.fissato.scintille, 10)
    assert.equal(d.fissato.finestraGiorni, 30)
    assert.equal(d.fissato.tettoGiorno, 15)
    assert.deepEqual(d.scaliniPersonali, [20, 60])
    // Valori degli stadi, non importi da sommare: un lead chiuso vale 4 in tutto.
    assert.deepEqual(d.piume, { conferma: 1, presenza: 2, chiusura: 4 })
    assert.deepEqual(d.forzieri.raro, { probPiuma: 0.05, piume: 1, scintille: [10, 30] })
    assert.deepEqual(d.forzieri.leggendario, { probPiuma: 0.2, piume: 1, scintille: [30, 80] })
    assert.equal(d.forzieri.minFissatiGiorno, 1)
    assert.equal(d.forzieri.minFissatiPunta, 1)
    assert.deepEqual(d.conferme.scintille, { conferma: 3, presenza: 20, inTempo: 6, inTempoMinuti: 60, tettoConfermeGiorno: 12 })
    assert.deepEqual(d.conferme.obiettivi, { presenze: { soglie: [16, 22], piume: [3, 4] }, chiusure: { soglie: [5, 7], piume: [4, 5] } })
    assert.deepEqual(d.classifica, { premiEuro: [50, 25, 10], minPresenze: 1 })
})

test('inizio economia: mezzanotte di Roma del 26/10/2026 (ora solare)', () => {
    assert.equal(inizioEconomia(DEFAULT_ECONOMY_RULES).toISOString(), '2026-10-25T23:00:00.000Z')
})

// ── Fissato: una volta per lead ogni 30 giorni ──────────────────────────

test('finestra di 30 giorni: stessa finestra per giorni vicini, chiave stabile', () => {
    const a = finestraIndex('2026-10-26', 30)
    assert.equal(a, Math.floor(Date.UTC(2026, 9, 26) / 86_400_000 / 30))
    assert.equal(fissatoIdemKey(LEAD, '2026-10-26', 30), `S:fissato:${LEAD}:${a}`)
    assert.equal(fissatoIdemKey(LEAD, '2026-10-26', 30, 2), `S:fissato:${LEAD}:${a}:2`)
})

test('pianoFissato: primo fissato del lead paga con la chiave della finestra', () => {
    const p = pianoFissato([], LEAD, giorno('2026-10-26T14:00:00Z'), '2026-10-26', 30)
    assert.equal(p.bloccato, false)
    assert.equal(p.idemKey, fissatoIdemKey(LEAD, '2026-10-26', 30))
})

test('pianoFissato: rifissare lo stesso lead entro 30 giorni non paga', () => {
    const k = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [{ idemKey: k, amount: 10, createdAt: giorno('2026-10-26T14:00:00Z') }]
    // stesso giorno (doppio click o rifissaggio) e 20 giorni dopo
    assert.equal(pianoFissato(rows, LEAD, giorno('2026-10-26T14:05:00Z'), '2026-10-26', 30).bloccato, true)
    assert.equal(pianoFissato(rows, LEAD, giorno('2026-11-15T14:00:00Z'), '2026-11-15', 30).bloccato, true)
})

test('pianoFissato: anche a cavallo di due finestre fisse vale la regola dei 30 giorni', () => {
    // Un accredito vecchio di 2 giorni in una finestra precedente blocca lo stesso.
    let d = new Date(Date.UTC(2026, 9, 1))
    while (finestraIndex(d.toISOString().slice(0, 10), 30) === finestraIndex(new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10), 30)) {
        d = new Date(d.getTime() + 86_400_000)
    }
    const ultimo = d.toISOString().slice(0, 10)                                     // ultimo giorno di una finestra
    const dopo = new Date(d.getTime() + 2 * 86_400_000).toISOString().slice(0, 10)  // due giorni dopo, finestra nuova
    const rows: LedgerRow[] = [{ idemKey: fissatoIdemKey(LEAD, ultimo, 30), amount: 10, createdAt: new Date(`${ultimo}T15:00:00Z`) }]
    const p = pianoFissato(rows, LEAD, new Date(`${dopo}T15:00:00Z`), dopo, 30)
    assert.equal(p.bloccato, true)
})

test('pianoFissato: dopo 30 giorni il lead paga di nuovo, con la chiave della nuova finestra', () => {
    const rows: LedgerRow[] = [{ idemKey: fissatoIdemKey(LEAD, '2026-10-26', 30), amount: 10, createdAt: giorno('2026-10-26T14:00:00Z') }]
    const p = pianoFissato(rows, LEAD, giorno('2026-11-26T14:00:00Z'), '2026-11-26', 30)
    assert.equal(p.bloccato, false)
    assert.equal(p.idemKey, fissatoIdemKey(LEAD, '2026-11-26', 30))
})

test('pianoFissato: un fissato stornato si può ripagare una volta, con una chiave nuova', () => {
    const k = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [
        { idemKey: k, amount: 10, createdAt: giorno('2026-10-26T14:00:00Z') },
        { idemKey: `storno:${k}`, amount: -10, createdAt: giorno('2026-10-26T15:00:00Z') },
    ]
    const p = pianoFissato(rows, LEAD, giorno('2026-10-28T14:00:00Z'), '2026-10-28', 30)
    assert.equal(p.bloccato, false)
    assert.equal(p.idemKey, `${k}:2`)
    // ripagato: di nuovo bloccato
    const dopo = [...rows, { idemKey: `${k}:2`, amount: 10, createdAt: giorno('2026-10-28T14:00:00Z') }]
    assert.equal(pianoFissato(dopo, LEAD, giorno('2026-10-28T16:00:00Z'), '2026-10-28', 30).bloccato, true)
})

test('pianoFissato: le righe di altri lead non contano', () => {
    const rows: LedgerRow[] = [{ idemKey: fissatoIdemKey('lead-10', '2026-10-26', 30), amount: 10, createdAt: giorno('2026-10-26T14:00:00Z') }]
    assert.equal(pianoFissato(rows, 'lead-1', giorno('2026-10-26T15:00:00Z'), '2026-10-26', 30).bloccato, false)
})

test('fissatiDaStornare: solo gli accrediti attivi del ciclo corrente', () => {
    const k1 = fissatoIdemKey(LEAD, '2026-08-01', 30)
    const k2 = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [
        { idemKey: k1, amount: 10, createdAt: giorno('2026-08-01T14:00:00Z') },
        { idemKey: k2, amount: 10, createdAt: giorno('2026-10-26T14:00:00Z') },
    ]
    assert.deepEqual(fissatiDaStornare(rows, LEAD, giorno('2026-10-26T13:59:00Z')), [k2])
    assert.deepEqual(fissatiDaStornare(rows, LEAD, null), [k1, k2])
    const stornato = [...rows, { idemKey: `storno:${k2}`, amount: -10, createdAt: giorno('2026-10-26T15:00:00Z') }]
    assert.deepEqual(fissatiDaStornare(stornato, LEAD, giorno('2026-10-26T13:59:00Z')), [])
})

// ── Ciclo dell'appuntamento: il limite dello storno ─────────────────────

const MARGINE = 10 * 60_000
const ev = (iso: string, tipo: EventoCiclo['tipo']): EventoCiclo => ({ at: giorno(iso), tipo })

test('storno dopo un rifissaggio: il limite resta al primo fissato del ciclo', () => {
    // 14:00 fissato (+10 S), 14:30 rifissato dalla drawer per cambiare data
    // (nessun accredito, appointmentCreatedAt riscritto), 14:35 richiamo.
    const storia = [ev('2026-10-26T14:00:00Z', 'fissato'), ev('2026-10-26T14:30:00Z', 'fissato')]
    assert.deepEqual(cicloInCorso(storia), { inizio: giorno('2026-10-26T14:00:00Z'), dopo: null })
    const k = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [{ idemKey: k, amount: 10, createdAt: giorno('2026-10-26T14:00:00.400Z') }]
    assert.deepEqual(fissatiDaStornare(rows, LEAD, inizioStorno(storia, MARGINE)), [k])
    // Il vecchio limite (appointmentCreatedAt riscritto alle 14:30, meno il margine) lo perdeva.
    assert.deepEqual(fissatiDaStornare(rows, LEAD, new Date(giorno('2026-10-26T14:30:00Z').getTime() - MARGINE)), [])
})

test('storno: un ciclo chiuso prima (esito diverso) resta, si storna solo quello in corso', () => {
    const k1 = fissatoIdemKey(LEAD, '2026-09-01', 30)
    const k2 = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [
        { idemKey: k1, amount: 10, createdAt: giorno('2026-09-01T14:00:01Z') },
        { idemKey: k2, amount: 10, createdAt: giorno('2026-10-26T14:00:01Z') },
    ]
    const storia = [
        ev('2026-09-01T14:00:00Z', 'fissato'),
        ev('2026-09-02T10:00:00Z', 'lavoro'),      // chiamata delle Conferme
        ev('2026-09-02T11:00:00Z', 'chiusura'),    // poi richiamo: le Conferme l'avevano toccato, k1 resta
        ev('2026-10-26T14:00:00Z', 'fissato'),
        ev('2026-10-26T14:20:00Z', 'fissato'),     // rifissato
    ]
    assert.deepEqual(cicloInCorso(storia), { inizio: giorno('2026-10-26T14:00:00Z'), dopo: giorno('2026-09-02T11:00:00Z') })
    assert.deepEqual(fissatiDaStornare(rows, LEAD, inizioStorno(storia, MARGINE)), [k2])
})

test('storno: scarto delle Conferme riaperto da un nuovo fissato, il fissato vecchio resta', () => {
    // 20/10 fissato (k1), le Conferme lo scartano; 26/10 il GDO lo rifissa: il
    // reset dello scarto e il nuovo fissato hanno lo stesso istante (bloccato
    // dai 30 giorni, nessun accredito); poi lo mette a richiamo.
    const k1 = fissatoIdemKey(LEAD, '2026-10-20', 30)
    const rows: LedgerRow[] = [{ idemKey: k1, amount: 10, createdAt: giorno('2026-10-20T14:00:01Z') }]
    const storia = [
        ev('2026-10-20T14:00:00Z', 'fissato'),
        ev('2026-10-26T14:00:00Z', 'fissato'),
        ev('2026-10-26T14:00:00Z', 'chiusura'),    // conferme_scarto_reset, stesso istante
    ]
    assert.deepEqual(cicloInCorso(storia), { inizio: giorno('2026-10-26T14:00:00Z'), dopo: giorno('2026-10-26T14:00:00Z') })
    assert.deepEqual(fissatiDaStornare(rows, LEAD, inizioStorno(storia, MARGINE)), [])
    // Riaperto con lo spostamento della data (nessun callLog): il ciclo in corso non ha fissati.
    assert.equal(cicloInCorso([ev('2026-10-20T14:00:00Z', 'fissato'), ev('2026-10-26T13:00:00Z', 'chiusura')]), null)
    assert.equal(inizioStorno([ev('2026-10-20T14:00:00Z', 'fissato'), ev('2026-10-26T13:00:00Z', 'chiusura')], MARGINE), null)
})

test('storno: il lavoro delle Conferme sul ciclo in corso non lo chiude (annullamento admin)', () => {
    const k = fissatoIdemKey(LEAD, '2026-10-26', 30)
    const rows: LedgerRow[] = [{ idemKey: k, amount: 10, createdAt: giorno('2026-10-26T14:00:01Z') }]
    const storia = [
        ev('2026-10-26T14:00:00Z', 'fissato'),
        ev('2026-10-27T10:00:00Z', 'lavoro'),
        ev('2026-10-27T10:05:00Z', 'lavoro'),
    ]
    assert.deepEqual(fissatiDaStornare(rows, LEAD, inizioStorno(storia, MARGINE)), [k])
    // Un ciclo vecchio lavorato dalle Conferme e poi presentato separa il nuovo fissato.
    const k1 = fissatoIdemKey(LEAD, '2026-09-01', 30)
    const conVecchio: LedgerRow[] = [...rows, { idemKey: k1, amount: 10, createdAt: giorno('2026-09-01T14:00:01Z') }]
    const storia2 = [ev('2026-09-01T14:00:00Z', 'fissato'), ev('2026-09-05T16:00:00Z', 'lavoro'), ...storia]
    assert.deepEqual(fissatiDaStornare(conVecchio, LEAD, inizioStorno(storia2, MARGINE)), [k])
})

test('storno: il margine degli orologi non scavalca la chiusura del ciclo prima', () => {
    const storia = [ev('2026-10-26T14:00:00Z', 'fissato'), ev('2026-10-26T14:02:00Z', 'chiusura'), ev('2026-10-26T14:05:00Z', 'fissato')]
    assert.deepEqual(inizioStorno(storia, MARGINE), giorno('2026-10-26T14:02:00Z'))
    assert.deepEqual(inizioStorno([ev('2026-10-26T14:05:00Z', 'fissato')], MARGINE), giorno('2026-10-26T13:55:00Z'))
    assert.equal(cicloInCorso([]), null)
    assert.equal(cicloInCorso([ev('2026-10-26T14:00:00Z', 'chiusura')]), null)
})

// ── Scalini personali ───────────────────────────────────────────────────

const G = '2026-10-26'

test('scalini personali: +20 all\'8°, +60 al 10°, chiave per utente e giorno', () => {
    assert.deepEqual(pianoScalini([], 'u1', G, 7, [8, 10], [20, 60]), { accredita: [], storna: [] })
    assert.deepEqual(pianoScalini([], 'u1', G, 8, [8, 10], [20, 60]).accredita, [{ scalino: 1, scintille: 20, idemKey: 'S:scalino:u1:2026-10-26:1' }])
    assert.deepEqual(pianoScalini([], 'u1', G, 12, [8, 10], [20, 60]).accredita.map(a => [a.scalino, a.scintille]), [[1, 20], [2, 60]])
    assert.equal(scalinoIdemKey('u1', G, 2), 'S:scalino:u1:2026-10-26:2')
    assert.equal(scalinoIdemKey('u1', G, 2, 3), 'S:scalino:u1:2026-10-26:2:3')
    // già presi: niente di nuovo
    const presi: LedgerRow[] = [{ idemKey: scalinoIdemKey('u1', G, 1), amount: 20 }]
    assert.deepEqual(pianoScalini(presi, 'u1', G, 9, [8, 10], [20, 60]), { accredita: [], storna: [] })
})

test('scalini: fissati validi scesi sotto la soglia si stornano, e si riprendono con una chiave nuova', () => {
    const k1 = scalinoIdemKey('u1', G, 1)
    const k2 = scalinoIdemKey('u1', G, 2)
    const presi: LedgerRow[] = [{ idemKey: k1, amount: 20 }, { idemKey: k2, amount: 60 }]
    assert.deepEqual(pianoScalini(presi, 'u1', G, 9, [8, 10], [20, 60]), { accredita: [], storna: [k2] })
    assert.deepEqual(pianoScalini(presi, 'u1', G, 7, [8, 10], [20, 60]), { accredita: [], storna: [k1, k2] })
    // stornato il secondo, si torna a 10: si riprende con la chiave :2
    const dopo: LedgerRow[] = [...presi, { idemKey: `storno:${k2}`, amount: -60 }]
    assert.deepEqual(pianoScalini(dopo, 'u1', G, 9, [8, 10], [20, 60]), { accredita: [], storna: [] })
    assert.deepEqual(pianoScalini(dopo, 'u1', G, 10, [8, 10], [20, 60]), { accredita: [{ scalino: 2, scintille: 60, idemKey: `${k2}:2` }], storna: [] })
    // e se riscende, si storna la generazione nuova
    const ripreso: LedgerRow[] = [...dopo, { idemKey: `${k2}:2`, amount: 60 }]
    assert.deepEqual(pianoScalini(ripreso, 'u1', G, 9, [8, 10], [20, 60]).storna, [`${k2}:2`])
})

test('scalini: altre persone e altri giorni non contano, un importo a zero non storna', () => {
    const altri: LedgerRow[] = [
        { idemKey: scalinoIdemKey('u10', G, 1), amount: 20 },
        { idemKey: scalinoIdemKey('u1', '2026-10-27', 1), amount: 20 },
    ]
    assert.deepEqual(pianoScalini(altri, 'u1', G, 8, [8, 10], [20, 60]).accredita.map(a => a.idemKey), [scalinoIdemKey('u1', G, 1)])
    const presi: LedgerRow[] = [{ idemKey: scalinoIdemKey('u1', G, 1), amount: 20 }]
    assert.deepEqual(pianoScalini(presi, 'u1', G, 8, [8, 10], [0, 60]), { accredita: [], storna: [] })
    assert.deepEqual(pianoScalini([], 'u1', G, 8, [8, 10], [0, 60]), { accredita: [], storna: [] })
})

test('rewardFissato: compatibile con reward_earned (xp 0, coinsGained = Scintille)', () => {
    const r = rewardFissato({ scintille: 30, fissatiOggi: 8, scalino: 1, saldo: 130 })
    assert.equal(r.xpGained, 0)
    assert.equal(r.coinsGained, 30)
    assert.equal(r.actionType, 'FISSATO')
    assert.equal(r.didLevelUp, false)
    assert.equal(r.valuta, 'S')
    assert.equal(r.scintille, 30)
    assert.equal(r.fissatiOggi, 8)
    assert.equal(r.saldoScintille, 130)
})

// ── Piume del GDO: vale lo stadio più alto ──────────────────────────────

const INIZIO = inizioEconomia(DEFAULT_ECONOMY_RULES)
const base = {
    confirmationsOutcome: 'confermato' as string | null,
    confermatoDaPersona: true,
    confirmationsTimestamp: giorno('2026-10-26T15:00:00Z') as Date | null,
    presentedAt: null as Date | null,
    appointmentDate: giorno('2026-10-27T16:00:00Z') as Date | null,
    salespersonOutcome: null as string | null,
}
const PG = PREFISSO_STADI.gdo
const kG = (gradino: number, gen = 1) => stadioIdemKey(PG, LEAD, gradino, gen)
const IMPORTI_GDO = importiGdo(DEFAULT_ECONOMY_RULES)
const somma = (p: { accredita: { amount: number }[] }) => p.accredita.reduce((t, a) => t + a.amount, 0)

test('piumeDovute: conferma, presenza e chiusura solo su lead confermato da una persona', () => {
    assert.deepEqual(piumeDovute(base, INIZIO), { conferma: true, presenza: false, chiusura: false })
    const presente = { ...base, presentedAt: giorno('2026-10-27T16:00:00Z') }
    assert.deepEqual(piumeDovute(presente, INIZIO), { conferma: true, presenza: true, chiusura: false })
    const chiuso = { ...presente, salespersonOutcome: 'Chiuso' }
    assert.deepEqual(piumeDovute(chiuso, INIZIO), { conferma: true, presenza: true, chiusura: true })
})

test('stadio del GDO: confermato 1, presentato 2, chiuso 3; bot, scarto e autofissato 0', () => {
    assert.equal(stadioGdo(base, INIZIO), 1)
    const presente = { ...base, presentedAt: giorno('2026-10-27T16:00:00Z') }
    assert.equal(stadioGdo(presente, INIZIO), 2)
    assert.equal(stadioGdo({ ...presente, salespersonOutcome: 'Chiuso' }, INIZIO), 3)
    assert.equal(stadioGdo({ ...presente, salespersonOutcome: 'Non chiuso' }, INIZIO), 2)
    assert.equal(stadioGdo({ ...presente, salespersonOutcome: 'Chiuso', confermatoDaPersona: false }, INIZIO), 0)
    assert.equal(stadioGdo({ ...base, confirmationsOutcome: 'scartato' }, INIZIO), 0)
    assert.equal(stadioGdo({ ...presente, confirmationsOutcome: 'autofissato', salespersonOutcome: 'Chiuso' }, INIZIO), 0)
})

test('stadio del GDO: gli esiti di prima dell\'avvio non pagano, la presenza dopo l\'avvio sì', () => {
    const vecchio = { ...base, confirmationsTimestamp: giorno('2026-10-24T15:00:00Z'), presentedAt: giorno('2026-10-25T09:00:00Z'), salespersonOutcome: 'Chiuso' }
    assert.equal(stadioGdo(vecchio, INIZIO), 0)
    // Confermato sabato, presentato martedì: vale la presenza.
    assert.equal(stadioGdo({ ...base, confirmationsTimestamp: giorno('2026-10-24T15:00:00Z'), presentedAt: giorno('2026-10-27T16:00:00Z') }, INIZIO), 2)
})

test('importi dai valori: il primo gradino vale lo stadio 1, poi le differenze', () => {
    assert.deepEqual(IMPORTI_GDO, [1, 1, 2])
    assert.deepEqual(importiDaValori([1, 3, 6]), [1, 2, 3])
    assert.deepEqual(importiDaValori([0, 0, 5]), [0, 0, 5])
    assert.deepEqual([1, 2, 3].map(causaleGradinoGdo), ['conferma', 'presenza', 'chiusura'])
})

test('le Piume NON si sommano per stadio: un lead chiuso vale 4 in tutto, non 1+2+4', () => {
    // Confermato, presentato e chiuso nella stessa sincronizzazione.
    const tutto = pianoStadi([], PG, LEAD, 3, IMPORTI_GDO)
    assert.deepEqual(tutto.accredita.map(a => [a.gradino, a.amount, a.idemKey]), [[1, 1, kG(1)], [2, 1, kG(2)], [3, 2, kG(3)]])
    assert.equal(somma(tutto), DEFAULT_ECONOMY_RULES.piume.chiusura)
    // Un passo alla volta: si accredita solo la differenza.
    assert.equal(somma(pianoStadi([], PG, LEAD, 1, IMPORTI_GDO)), 1)
    const righe1: LedgerRow[] = [{ idemKey: kG(1), amount: 1 }]
    assert.deepEqual(pianoStadi(righe1, PG, LEAD, 2, IMPORTI_GDO), { accredita: [{ gradino: 2, amount: 1, idemKey: kG(2) }], storna: [] })
    const righe2: LedgerRow[] = [...righe1, { idemKey: kG(2), amount: 1 }]
    assert.deepEqual(pianoStadi(righe2, PG, LEAD, 3, IMPORTI_GDO), { accredita: [{ gradino: 3, amount: 2, idemKey: kG(3) }], storna: [] })
    // Già allineato: niente da fare (doppia sincronizzazione).
    const righe3: LedgerRow[] = [...righe2, { idemKey: kG(3), amount: 2 }]
    assert.deepEqual(pianoStadi(righe3, PG, LEAD, 3, IMPORTI_GDO), { accredita: [], storna: [] })
})

test('stadio che scende: si storna solo il gradino perso, e si riprende con una chiave nuova', () => {
    const chiuso: LedgerRow[] = [{ idemKey: kG(1), amount: 1 }, { idemKey: kG(2), amount: 1 }, { idemKey: kG(3), amount: 2 }]
    // Chiusura tolta (esito cambiato o riassegnazione del venditore): la presenza resta.
    assert.deepEqual(pianoStadi(chiuso, PG, LEAD, 2, IMPORTI_GDO), { accredita: [], storna: [kG(3)] })
    // Esito rimosso col latch azzerato: via chiusura e presenza.
    assert.deepEqual(pianoStadi(chiuso, PG, LEAD, 1, IMPORTI_GDO).storna, [kG(2), kG(3)])
    // Conferma tolta o appuntamento annullato: via tutto.
    assert.deepEqual(pianoStadi(chiuso, PG, LEAD, 0, IMPORTI_GDO).storna, [kG(1), kG(2), kG(3)])
    // Dopo lo storno della chiusura, un nuovo Chiuso la riprende con la chiave :2.
    const stornata: LedgerRow[] = [...chiuso, { idemKey: `storno:${kG(3)}`, amount: -2 }]
    assert.deepEqual(pianoStadi(stornata, PG, LEAD, 2, IMPORTI_GDO), { accredita: [], storna: [] })
    assert.deepEqual(pianoStadi(stornata, PG, LEAD, 3, IMPORTI_GDO), { accredita: [{ gradino: 3, amount: 2, idemKey: kG(3, 2) }], storna: [] })
})

test('stadi: altri lead e le Scintille delle Conferme non si mescolano con le Piume del GDO', () => {
    const rows: LedgerRow[] = [
        { idemKey: stadioIdemKey(PG, 'lead-10', 1), amount: 1 },
        { idemKey: stadioIdemKey(PREFISSO_STADI.conferme, LEAD, 1), amount: 3 },
    ]
    assert.deepEqual(pianoStadi(rows, PG, LEAD, 1, IMPORTI_GDO).accredita.map(a => a.idemKey), [kG(1)])
    // Due accrediti attivi sullo stesso gradino (errore): ne resta uno.
    const doppi: LedgerRow[] = [{ idemKey: kG(1), amount: 1 }, { idemKey: kG(1, 2), amount: 1 }]
    assert.deepEqual(pianoStadi(doppi, PG, LEAD, 1, IMPORTI_GDO).storna, [kG(1, 2)])
})

test('chi può far guadagnare Piume: solo Conferme, venditori e staff, mai il GDO stesso', () => {
    const gdo = { id: 'g', role: 'GDO', isActive: true, isBot: false, firstName: 'Zora' }
    const conferme = { id: 'c', role: 'CONFERME', isActive: true, isBot: false, firstName: null }
    const venditore = { id: 'v', role: 'VENDITORE', isActive: true, isBot: false, firstName: null }
    const bot = { id: 'b', role: 'GDO', isActive: true, isBot: true, firstName: null }
    const ia = { id: 'i', role: 'GDO', isActive: true, isBot: false, firstName: null }
    assert.equal(isPersonaleUmano(conferme), true)
    assert.equal(isPersonaleUmano(venditore), true)
    assert.equal(isPersonaleUmano(gdo), false)
    assert.equal(isPersonaleUmano(bot), false)
    assert.equal(puoAccreditarePiume(conferme, gdo), true)
    assert.equal(puoAccreditarePiume(venditore, gdo), true)
    assert.equal(puoAccreditarePiume(gdo, gdo), false)        // il GDO non si premia da solo
    assert.equal(puoAccreditarePiume(conferme, ia), false)    // 108: niente nome, fuori squadra
    assert.equal(puoAccreditarePiume(conferme, bot), false)   // 201
    assert.equal(puoAccreditarePiume(undefined, gdo), false)
})

// ── Conferme: Scintille per lead ────────────────────────────────────────

const PC = PREFISSO_STADI.conferme
const kC = (gradino: number, gen = 1) => stadioIdemKey(PC, LEAD, gradino, gen)
const conf = {
    confirmationsOutcome: 'confermato' as string | null,
    confirmationsTimestamp: giorno('2026-10-27T10:00:00Z') as Date | null,   // 11:00 di Roma
    appointmentDate: giorno('2026-10-27T16:00:00Z') as Date | null,         // 17:00 di Roma
    presentedAt: null as Date | null,
}

test('Conferme: la conferma conta solo se arriva prima dell\'appuntamento', () => {
    assert.equal(confermaUtile(conf), true)
    // Registrata a call iniziata (il lead è già davanti al venditore): non è lavoro di conferma.
    assert.equal(confermaUtile({ ...conf, confirmationsTimestamp: giorno('2026-10-27T16:05:00Z') }), false)
    assert.equal(confermaUtile({ ...conf, confirmationsTimestamp: giorno('2026-10-27T16:00:00Z') }), false)
    assert.equal(confermaUtile({ ...conf, confirmationsOutcome: 'scartato' }), false)
    assert.equal(confermaUtile({ ...conf, appointmentDate: null }), false)
    assert.equal(stadioConferme({ ...conf, confirmationsTimestamp: giorno('2026-10-27T16:05:00Z'), presentedAt: giorno('2026-10-27T16:00:00Z') }, INIZIO), 0)
})

test('Conferme: stadi 1 (confermato) e 2 (presentato), dall\'avvio', () => {
    assert.equal(stadioConferme(conf, INIZIO), 1)
    assert.equal(stadioConferme({ ...conf, presentedAt: giorno('2026-10-27T16:00:00Z') }, INIZIO), 2)
    // Confermato prima dell'avvio: la sola conferma non paga, la presenza dopo l'avvio sì.
    const prima = { ...conf, confirmationsTimestamp: giorno('2026-10-24T10:00:00Z'), appointmentDate: giorno('2026-10-27T16:00:00Z') }
    assert.equal(stadioConferme(prima, INIZIO), 0)
    assert.equal(stadioConferme({ ...prima, presentedAt: giorno('2026-10-27T16:00:00Z') }, INIZIO), 2)
})

test('Conferme: 3 Scintille alla conferma, 20 in tutto alla presenza, 26 se confermato con un\'ora d\'anticipo', () => {
    assert.equal(confermaInTempo(conf, 60), true)                                                                    // 6 ore prima
    assert.equal(confermaInTempo({ ...conf, confirmationsTimestamp: giorno('2026-10-27T15:30:00Z') }, 60), false)   // 30 minuti prima
    assert.equal(confermaInTempo({ ...conf, confirmationsTimestamp: giorno('2026-10-27T15:00:00Z') }, 60), true)    // un'ora esatta
    assert.deepEqual(importiConferme(DEFAULT_ECONOMY_RULES, false), [3, 17])
    assert.deepEqual(importiConferme(DEFAULT_ECONOMY_RULES, true), [3, 23])
    assert.equal(somma(pianoStadi([], PC, LEAD, 2, importiConferme(DEFAULT_ECONOMY_RULES, true))), 26)
    assert.equal(somma(pianoStadi([], PC, LEAD, 2, importiConferme(DEFAULT_ECONOMY_RULES, false))), 20)
    assert.deepEqual(pianoStadi([], PC, LEAD, 1, importiConferme(DEFAULT_ECONOMY_RULES, true)).accredita, [{ gradino: 1, amount: 3, idemKey: kC(1) }])
})

test('Conferme: chi tiene la conferma è chi ha il primo gradino attivo, non l\'ultimo che ha confermato', () => {
    const rows: LedgerRow[] = [{ idemKey: kC(1), amount: 3, userId: 'andrea' }]
    // Un collega riconferma lo stesso lead: il premio resta a chi l'aveva confermato.
    assert.equal(titolareConferma(rows, LEAD, 'alberto'), 'andrea')
    // Nessun accredito (conferma oltre il tetto, o prima dell'avvio): chi risulta sul lead.
    assert.equal(titolareConferma([], LEAD, 'alberto'), 'alberto')
    // Conferma stornata (scarto) e poi rifatta da un altro: passa a lui.
    const stornata: LedgerRow[] = [...rows, { idemKey: `storno:${kC(1)}`, amount: -3, userId: 'andrea' }]
    assert.equal(titolareConferma(stornata, LEAD, 'alberto'), 'alberto')
})

test('Conferme: tetto delle conferme pagate al giorno e ruolo letto dal DB', () => {
    assert.equal(sottoTettoConferme(11, DEFAULT_ECONOMY_RULES), true)
    assert.equal(sottoTettoConferme(12, DEFAULT_ECONOMY_RULES), false)
    assert.equal(isConfermePersona({ role: 'CONFERME', isActive: true, isBot: false }), true)
    assert.equal(isConfermePersona({ role: 'CONFERME', isActive: false, isBot: false }), false)
    assert.equal(isConfermePersona({ role: 'GDO', isActive: true, isBot: false }), false)
    assert.equal(isConfermePersona({ role: 'ADMIN', isActive: true, isBot: false }), false)
    assert.equal(isConfermePersona(undefined), false)
})

// ── Conferme: obiettivi settimanali (Piume) ─────────────────────────────

const LUNEDI = '2026-10-26'
const SETT_START = giorno('2026-10-25T23:00:00Z')
const SETT_END = giorno('2026-11-01T23:00:00Z')
const lo = (p: Partial<LeadObiettivo>): LeadObiettivo => ({
    titolare: 'andrea', confermaUtile: true, autoreEsito: 'venditore', presentedAt: giorno('2026-10-27T16:00:00Z'), chiusoAt: null, ...p,
})

test('obiettivi: contano solo i lead tenuti dalla persona, confermati in tempo utile, con esito scritto da altri', () => {
    const righe = [
        lo({}),
        lo({ chiusoAt: giorno('2026-10-28T10:00:00Z') }),
        lo({ titolare: 'alberto' }),                                                     // di un collega
        lo({ confermaUtile: false }),                                                    // confermato a call iniziata
        lo({ autoreEsito: 'andrea', chiusoAt: giorno('2026-10-28T10:00:00Z') }),        // esito scritto da lei
        lo({ presentedAt: giorno('2026-10-20T16:00:00Z') }),                             // settimana prima
        lo({ presentedAt: giorno('2026-10-20T16:00:00Z'), chiusoAt: giorno('2026-10-27T10:00:00Z') }),   // presenza prima, chiusura in settimana
    ]
    assert.deepEqual(contaObiettivi(righe, 'andrea', SETT_START, SETT_END), { presenze: 2, chiusure: 2 })
})

test('obiettivi: scalini 16/22 presenze e 5/7 chiusure, Piume 3+4 e 4+5', () => {
    const o = obiettiviPersona(DEFAULT_ECONOMY_RULES, 'andrea')
    assert.deepEqual(o.presenze, { soglie: [16, 22], piume: [3, 4] })
    assert.deepEqual(pianoObiettivo([], 'presenze', 'andrea', LUNEDI, 15, o.presenze).accredita, [])
    assert.deepEqual(pianoObiettivo([], 'presenze', 'andrea', LUNEDI, 16, o.presenze).accredita.map(a => [a.gradino, a.amount]), [[1, 3]])
    assert.deepEqual(pianoObiettivo([], 'chiusure', 'andrea', LUNEDI, 7, o.chiusure).accredita.map(a => [a.gradino, a.amount]), [[1, 4], [2, 5]])
    assert.equal(obiettivoIdemKey('chiusure', 'andrea', LUNEDI, 2), `P:obiettivo:chiusure:andrea:${LUNEDI}:2`)
    // Una chiusura tolta riporta sotto la soglia: lo scalino si storna.
    const presi: LedgerRow[] = [
        { idemKey: obiettivoIdemKey('chiusure', 'andrea', LUNEDI, 1), amount: 4 },
        { idemKey: obiettivoIdemKey('chiusure', 'andrea', LUNEDI, 2), amount: 5 },
    ]
    assert.deepEqual(pianoObiettivo(presi, 'chiusure', 'andrea', LUNEDI, 6, o.chiusure).storna, [obiettivoIdemKey('chiusure', 'andrea', LUNEDI, 2)])
    // Settimane e persone diverse non si toccano.
    assert.equal(pianoObiettivo(presi, 'chiusure', 'andrea', '2026-11-02', 7, o.chiusure).accredita.length, 2)
    assert.equal(pianoObiettivo(presi, 'chiusure', 'alberto', LUNEDI, 7, o.chiusure).accredita.length, 2)
})

test('obiettivi: soglie per persona (chi fa le Conferme a metà tempo)', () => {
    const r = parseEconomyRules(JSON.stringify({ conferme: { perPersona: { andrea: { presenze: [10, 14] } } } }))
    assert.deepEqual(obiettiviPersona(r, 'andrea').presenze.soglie, [10, 14])
    assert.deepEqual(obiettiviPersona(r, 'andrea').chiusure.soglie, [5, 7])
    assert.deepEqual(obiettiviPersona(r, 'alberto').presenze.soglie, [16, 22])
})

test('classifica: 50, 25 e 10 euro ai primi tre, niente agli altri', () => {
    assert.deepEqual([1, 2, 3, 4, 0].map(p => premioClassifica(p, DEFAULT_ECONOMY_RULES)), [50, 25, 10, 0, 0])
})

// ── Forzieri di squadra ─────────────────────────────────────────────────

test('forzieri raggiunti: 55/65 di squadra e 14/20 nell\'ora di punta', () => {
    assert.deepEqual(forzieriRaggiunti(54, 13, DEFAULT_TARGETS), [])
    assert.deepEqual(forzieriRaggiunti(55, null, DEFAULT_TARGETS), ['giorno_1'])
    assert.deepEqual(forzieriRaggiunti(66, 14, DEFAULT_TARGETS), ['giorno_1', 'giorno_2', 'punta_1'])
    assert.deepEqual(forzieriRaggiunti(30, 20, DEFAULT_TARGETS), ['punta_1', 'punta_2'])
    assert.equal(tierForziere('giorno_1'), 'raro')
    assert.equal(tierForziere('punta_1'), 'raro')
    assert.equal(tierForziere('giorno_2'), 'leggendario')
    assert.equal(tierForziere('punta_2'), 'leggendario')
})

test('contenuto del forziere: Piuma sotto la probabilità, altrimenti Scintille nel range', () => {
    const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length] }
    assert.deepEqual(contenutoForziere('raro', DEFAULT_ECONOMY_RULES, seq(0.01)), { currency: 'P', amount: 1 })
    assert.deepEqual(contenutoForziere('raro', DEFAULT_ECONOMY_RULES, seq(0.5, 0)), { currency: 'S', amount: 10 })
    assert.deepEqual(contenutoForziere('raro', DEFAULT_ECONOMY_RULES, seq(0.5, 0.999999)), { currency: 'S', amount: 30 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.19)), { currency: 'P', amount: 1 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.2, 0)), { currency: 'S', amount: 30 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.2, 0.999999)), { currency: 'S', amount: 80 })
})

test('contenuto del forziere: le probabilità tornano su molti tiri', () => {
    let s = 12345
    const lcg = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    let piume = 0
    let min = Infinity
    let max = -Infinity
    const N = 20_000
    for (let i = 0; i < N; i++) {
        const c = contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, lcg)
        if (c.currency === 'P') piume++
        else { min = Math.min(min, c.amount); max = Math.max(max, c.amount) }
    }
    assert.ok(Math.abs(piume / N - 0.2) < 0.02, `Piume ${piume / N}`)
    assert.equal(min, 30)
    assert.equal(max, 80)
})

test('destinatari del forziere: chi ha fissato almeno N volte, 0 = tutta la squadra', () => {
    const conteggi = { a: 3, b: 1, x: 5 }   // x non è in squadra
    assert.deepEqual(destinatariForziere(conteggi, ['a', 'b', 'c'], 1), ['a', 'b'])
    assert.deepEqual(destinatariForziere(conteggi, ['a', 'b', 'c'], 2), ['a'])
    assert.deepEqual(destinatariForziere(conteggi, ['a', 'b', 'c'], 0), ['a', 'b', 'c'])
    assert.equal(chestIdemKey('ch1', 'a'), 'chest:ch1:a')
})

// ── Appuntamento tolto dal GDO prima delle Conferme ─────────────────────

test('confermeNonHannoToccato: vero solo se le Conferme non ci hanno ancora lavorato', () => {
    const vuoto = { confirmationsOutcome: null, confCall1At: null, confNeedsReschedule: false, confSnoozeAt: null }
    assert.equal(confermeNonHannoToccato(vuoto), true)
    assert.equal(confermeNonHannoToccato({ ...vuoto, confirmationsOutcome: 'confermato' }), false)
    assert.equal(confermeNonHannoToccato({ ...vuoto, confirmationsOutcome: 'scartato' }), false)
    assert.equal(confermeNonHannoToccato({ ...vuoto, confCall1At: new Date() }), false)
    assert.equal(confermeNonHannoToccato({ ...vuoto, confNeedsReschedule: true }), false)
    assert.equal(confermeNonHannoToccato({ ...vuoto, confSnoozeAt: new Date() }), false)
})

// ── Anti-imbroglio ──────────────────────────────────────────────────────

test('fissato: niente Scintille a bot, IA vocale, ruoli non GDO o userId passato dal client', () => {
    const gdo = { serviceCtx: false, isBot: false, actorRole: 'GDO', sessionUserId: 'u1', effectiveUserId: 'u1' }
    assert.equal(fissatoPremiabile(gdo), true)
    assert.equal(fissatoPremiabile({ ...gdo, serviceCtx: true }), false)              // bot 201 e IA vocale 108
    assert.equal(fissatoPremiabile({ ...gdo, isBot: true }), false)
    assert.equal(fissatoPremiabile({ ...gdo, actorRole: 'ADMIN' }), false)
    assert.equal(fissatoPremiabile({ ...gdo, actorRole: 'VENDITORE' }), false)
    assert.equal(fissatoPremiabile({ ...gdo, effectiveUserId: 'u2' }), false)         // userId forzato dal client
    assert.equal(fissatoPremiabile({ ...gdo, sessionUserId: undefined }), false)
    // E il DB deve confermare la squadra: 108 e 201 non hanno un nome, chi è disattivato è fuori.
    assert.equal(isTeamMember({ role: 'GDO', isActive: true, isBot: false, firstName: null }), false)
    assert.equal(isTeamMember({ role: 'GDO', isActive: true, isBot: true, firstName: null }), false)
    assert.equal(isTeamMember({ role: 'GDO', isActive: false, isBot: false, firstName: 'Noemi' }), false)
})

test('doppio click e gara: lo stesso fissato ha sempre la stessa chiave, quindi un solo accredito', () => {
    // Due salvataggi simultanei leggono il registro vuoto e calcolano la stessa
    // chiave: l'indice unico su idemKey fa passare solo il primo.
    const a = pianoFissato([], LEAD, giorno('2026-10-26T14:00:00.100Z'), '2026-10-26', 30)
    const b = pianoFissato([], LEAD, giorno('2026-10-26T14:00:00.300Z'), '2026-10-26', 30)
    assert.equal(a.idemKey, b.idemKey)
    // Gli scalini: una chiave per persona e giorno.
    assert.equal(scalinoIdemKey('u1', '2026-10-26', 1), scalinoIdemKey('u1', '2026-10-26', 1))
    // Le Piume: la seconda sincronizzazione trova gli accrediti e non ne fa altri.
    const dopoPrimo: LedgerRow[] = pianoStadi([], PG, LEAD, 3, IMPORTI_GDO).accredita.map(a => ({ idemKey: a.idemKey, amount: a.amount }))
    assert.deepEqual(pianoStadi(dopoPrimo, PG, LEAD, 3, IMPORTI_GDO), { accredita: [], storna: [] })
    // Le Scintille delle Conferme: idem.
    const conf1: LedgerRow[] = [{ idemKey: kC(1), amount: 3 }]
    assert.deepEqual(pianoStadi(conf1, PC, LEAD, 1, importiConferme(DEFAULT_ECONOMY_RULES, true)), { accredita: [], storna: [] })
})

test('storni: annullamento, conferma cambiata, presenza o chiusura tolte', () => {
    const presente = { ...base, presentedAt: giorno('2026-10-27T16:00:00Z'), salespersonOutcome: 'Chiuso' }
    const rows: LedgerRow[] = [{ idemKey: kG(1), amount: 1 }, { idemKey: kG(2), amount: 1 }, { idemKey: kG(3), amount: 2 }]
    assert.equal(stadioGdo(presente, INIZIO), 3)
    // Riassegnazione del venditore o esito cambiato: via la chiusura, la presenza resta (latch).
    assert.deepEqual(pianoStadi(rows, PG, LEAD, stadioGdo({ ...presente, salespersonOutcome: null }, INIZIO), IMPORTI_GDO).storna, [kG(3)])
    // Esito rimosso con il latch azzerato: via anche la presenza.
    assert.deepEqual(pianoStadi(rows, PG, LEAD, stadioGdo({ ...presente, salespersonOutcome: null, presentedAt: null }, INIZIO), IMPORTI_GDO).storna, [kG(2), kG(3)])
    // Conferma cambiata (scartato) o appuntamento annullato (conferma azzerata): via tutto.
    for (const stato of [{ ...presente, confirmationsOutcome: 'scartato' }, { ...presente, confirmationsOutcome: null, presentedAt: null, salespersonOutcome: null }]) {
        assert.deepEqual(pianoStadi(rows, PG, LEAD, stadioGdo(stato, INIZIO), IMPORTI_GDO).storna, [kG(1), kG(2), kG(3)])
    }
})

test('Conferme: una conferma già pagata resta valida anche se poi viene risalvata a call iniziata', () => {
    // Confermata alle 11, risalvata alle 17:05 per cambiare venditore: il timestamp si sposta.
    const risalvata = { ...conf, confirmationsTimestamp: giorno('2026-10-27T16:05:00Z') }
    assert.equal(stadioConferme(risalvata, INIZIO), 0)
    assert.equal(stadioConferme(risalvata, INIZIO, true), 1)
    assert.equal(stadioConferme({ ...risalvata, presentedAt: giorno('2026-10-27T16:00:00Z') }, INIZIO, true), 2)
    // Ma se la conferma non c'è più (scartato), niente.
    assert.equal(stadioConferme({ ...risalvata, confirmationsOutcome: 'scartato' }, INIZIO, true), 0)
    const rows: LedgerRow[] = [{ idemKey: kC(1), amount: 3, userId: 'andrea', createdAt: giorno('2026-10-27T10:00:00Z') }]
    assert.equal(confermaRegistrata(rows, LEAD)?.createdAt?.toISOString(), '2026-10-27T10:00:00.000Z')
    assert.equal(confermaRegistrata([...rows, { idemKey: `storno:${kC(1)}`, amount: -3 }], LEAD), undefined)
})
