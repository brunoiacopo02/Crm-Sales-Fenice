import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_ECONOMY_RULES, parseEconomyRules, inizioEconomia,
    finestraIndex, fissatoIdemKey, pianoFissato, fissatiDaStornare,
    scalinoIdemKey, bonusScalini, rewardFissato,
    piumeDovute, pianoPiuma, piumePresenza,
    contaFissatiPerPersona, sommaFissati, forzieriRaggiunti, tierForziere,
    contenutoForziere, destinatariForziere, chestIdemKey,
    confermeNonHannoToccato, isPersonaleUmano, puoAccreditarePiume, fissatoPremiabile,
    type LedgerRow,
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
    assert.deepEqual(r.forzieri.raro.scintille, [20, 60])
    assert.deepEqual(r.forzieri.leggendario, DEFAULT_ECONOMY_RULES.forzieri.leggendario)
})

test('parseEconomyRules: valori assurdi tornano al default', () => {
    const r = parseEconomyRules(JSON.stringify({
        fissato: { scintille: -5, finestraGiorni: 0, tettoGiorno: 'tanti' },
        scaliniPersonali: [20],
        piume: { chiusura: 2.5 },
        forzieri: { raro: { probPiuma: 3, scintille: [80, 10] }, minFissatiGiorno: -1 },
        inizio: '26/10/2026',
    }))
    assert.deepEqual(r, DEFAULT_ECONOMY_RULES)
})

test('default decisi il 25/10/2026', () => {
    const d = DEFAULT_ECONOMY_RULES
    assert.equal(d.fissato.scintille, 10)
    assert.equal(d.fissato.finestraGiorni, 30)
    assert.equal(d.fissato.tettoGiorno, 15)
    assert.deepEqual(d.scaliniPersonali, [20, 60])
    assert.deepEqual(d.piume, { conferma: 1, presenza: 2, presenzaOltreSoglia: 4, chiusura: 5 })
    assert.deepEqual(d.forzieri.raro, { probPiuma: 0.05, piume: 1, scintille: [20, 60] })
    assert.deepEqual(d.forzieri.leggendario, { probPiuma: 0.2, piume: 1, scintille: [60, 150] })
    assert.equal(d.forzieri.minFissatiGiorno, 1)
    assert.equal(d.forzieri.minFissatiPunta, 1)
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

// ── Scalini personali ───────────────────────────────────────────────────

test('scalini personali: +20 all\'8°, +60 al 10°, chiave per utente e giorno', () => {
    assert.deepEqual(bonusScalini(7, [8, 10], [20, 60]), [])
    assert.deepEqual(bonusScalini(8, [8, 10], [20, 60]), [{ scalino: 1, scintille: 20 }])
    assert.deepEqual(bonusScalini(12, [8, 10], [20, 60]), [{ scalino: 1, scintille: 20 }, { scalino: 2, scintille: 60 }])
    assert.equal(scalinoIdemKey('u1', '2026-10-26', 2), 'S:scalino:u1:2026-10-26:2')
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

// ── Piume ───────────────────────────────────────────────────────────────

const INIZIO = inizioEconomia(DEFAULT_ECONOMY_RULES)
const base = {
    confirmationsOutcome: 'confermato' as string | null,
    confermatoDaPersona: true,
    confirmationsTimestamp: giorno('2026-10-26T15:00:00Z') as Date | null,
    presentedAt: null as Date | null,
    appointmentDate: giorno('2026-10-27T16:00:00Z') as Date | null,
    salespersonOutcome: null as string | null,
}

test('piumeDovute: conferma, presenza e chiusura solo su lead confermato da una persona', () => {
    assert.deepEqual(piumeDovute(base, INIZIO), { conferma: true, presenza: false, chiusura: false })
    const presente = { ...base, presentedAt: giorno('2026-10-27T16:00:00Z') }
    assert.deepEqual(piumeDovute(presente, INIZIO), { conferma: true, presenza: true, chiusura: false })
    const chiuso = { ...presente, salespersonOutcome: 'Chiuso' }
    assert.deepEqual(piumeDovute(chiuso, INIZIO), { conferma: true, presenza: true, chiusura: true })
})

test('piumeDovute: confermato dal bot (lancio) o scartato non paga niente', () => {
    const bot = { ...base, confermatoDaPersona: false, presentedAt: giorno('2026-10-27T16:00:00Z'), salespersonOutcome: 'Chiuso' }
    assert.deepEqual(piumeDovute(bot, INIZIO), { conferma: false, presenza: false, chiusura: false })
    const scartato = { ...base, confirmationsOutcome: 'scartato' }
    assert.deepEqual(piumeDovute(scartato, INIZIO), { conferma: false, presenza: false, chiusura: false })
    const autofissato = { ...base, confirmationsOutcome: 'autofissato', salespersonOutcome: 'Chiuso', presentedAt: giorno('2026-10-27T16:00:00Z') }
    assert.deepEqual(piumeDovute(autofissato, INIZIO), { conferma: false, presenza: false, chiusura: false })
})

test('piumeDovute: gli esiti di prima dell\'avvio non pagano', () => {
    const vecchio = {
        ...base,
        confirmationsTimestamp: giorno('2026-10-24T15:00:00Z'),
        presentedAt: giorno('2026-10-25T09:00:00Z'),
        salespersonOutcome: 'Chiuso',
    }
    assert.deepEqual(piumeDovute(vecchio, INIZIO), { conferma: false, presenza: false, chiusura: false })
})

test('pianoPiuma: accredita una volta, storna se l\'esito sparisce, riaccredita con chiave nuova', () => {
    assert.deepEqual(pianoPiuma([], 'conferma', LEAD, true), { accredita: `P:conferma:${LEAD}:1`, storna: [] })
    const accreditata: LedgerRow[] = [{ idemKey: `P:conferma:${LEAD}:1`, amount: 1 }]
    assert.deepEqual(pianoPiuma(accreditata, 'conferma', LEAD, true), { accredita: null, storna: [] })
    assert.deepEqual(pianoPiuma(accreditata, 'conferma', LEAD, false), { accredita: null, storna: [`P:conferma:${LEAD}:1`] })
    const stornata: LedgerRow[] = [...accreditata, { idemKey: `storno:P:conferma:${LEAD}:1`, amount: -1 }]
    assert.deepEqual(pianoPiuma(stornata, 'conferma', LEAD, false), { accredita: null, storna: [] })
    assert.deepEqual(pianoPiuma(stornata, 'conferma', LEAD, true), { accredita: `P:conferma:${LEAD}:2`, storna: [] })
})

test('pianoPiuma: i tipi non si mescolano', () => {
    const rows: LedgerRow[] = [{ idemKey: `P:presenza:${LEAD}:1`, amount: 2 }]
    assert.deepEqual(pianoPiuma(rows, 'chiusura', LEAD, false), { accredita: null, storna: [] })
    assert.deepEqual(pianoPiuma(rows, 'conferma', LEAD, true).accredita, `P:conferma:${LEAD}:1`)
})

test('pianoPiuma: se per errore ci sono due accrediti attivi ne resta uno', () => {
    const rows: LedgerRow[] = [
        { idemKey: `P:chiusura:${LEAD}:1`, amount: 5 },
        { idemKey: `P:chiusura:${LEAD}:2`, amount: 5 },
    ]
    assert.deepEqual(pianoPiuma(rows, 'chiusura', LEAD, true), { accredita: null, storna: [`P:chiusura:${LEAD}:2`] })
})

test('piumePresenza: 2 fino alla 4ª della settimana, 4 dalla 5ª', () => {
    assert.equal(piumePresenza(1, 4, DEFAULT_ECONOMY_RULES), 2)
    assert.equal(piumePresenza(4, 4, DEFAULT_ECONOMY_RULES), 2)
    assert.equal(piumePresenza(5, 4, DEFAULT_ECONOMY_RULES), 4)
    assert.equal(piumePresenza(9, 4, DEFAULT_ECONOMY_RULES), 4)
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

// ── Forzieri di squadra ─────────────────────────────────────────────────

test('conta fissati: lead distinti per persona, eventualmente in una finestra', () => {
    const rows = [
        { userId: 'a', leadId: 'l1', createdAt: giorno('2026-10-26T14:00:00Z') },
        { userId: 'a', leadId: 'l1', createdAt: giorno('2026-10-26T17:10:00Z') },   // rifissato: conta una volta
        { userId: 'a', leadId: 'l2', createdAt: giorno('2026-10-26T17:20:00Z') },
        { userId: 'b', leadId: 'l3', createdAt: giorno('2026-10-26T17:30:00Z') },
        { userId: null, leadId: 'l4', createdAt: giorno('2026-10-26T17:30:00Z') },
    ]
    const giornata = contaFissatiPerPersona(rows)
    assert.equal(giornata.get('a'), 2)
    assert.equal(giornata.get('b'), 1)
    assert.equal(sommaFissati(giornata), 3)
    const punta = contaFissatiPerPersona(rows, { start: giorno('2026-10-26T17:00:00Z'), end: giorno('2026-10-26T18:00:00Z') })
    assert.equal(punta.get('a'), 2)
    assert.equal(punta.get('b'), 1)
})

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
    assert.deepEqual(contenutoForziere('raro', DEFAULT_ECONOMY_RULES, seq(0.5, 0)), { currency: 'S', amount: 20 })
    assert.deepEqual(contenutoForziere('raro', DEFAULT_ECONOMY_RULES, seq(0.5, 0.999999)), { currency: 'S', amount: 60 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.19)), { currency: 'P', amount: 1 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.2, 0)), { currency: 'S', amount: 60 })
    assert.deepEqual(contenutoForziere('leggendario', DEFAULT_ECONOMY_RULES, seq(0.2, 0.999999)), { currency: 'S', amount: 150 })
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
    assert.equal(min, 60)
    assert.equal(max, 150)
})

test('destinatari del forziere: chi ha fissato almeno N volte, 0 = tutta la squadra', () => {
    const conteggi = new Map([['a', 3], ['b', 1], ['x', 5]])   // x non è in squadra
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
    // Le Piume: la seconda sincronizzazione trova l'accredito e non ne fa un altro.
    const dopoPrimo: LedgerRow[] = [{ idemKey: `P:chiusura:${LEAD}:1`, amount: 5 }]
    assert.deepEqual(pianoPiuma(dopoPrimo, 'chiusura', LEAD, true), { accredita: null, storna: [] })
})

test('storni: annullamento, conferma cambiata, presenza o chiusura tolte', () => {
    const presente = { ...base, presentedAt: giorno('2026-10-27T16:00:00Z'), salespersonOutcome: 'Chiuso' }
    const rows: LedgerRow[] = [
        { idemKey: `P:conferma:${LEAD}:1`, amount: 1 },
        { idemKey: `P:presenza:${LEAD}:1`, amount: 2 },
        { idemKey: `P:chiusura:${LEAD}:1`, amount: 5 },
    ]
    const tutteDovute = piumeDovute(presente, INIZIO)
    assert.deepEqual(tutteDovute, { conferma: true, presenza: true, chiusura: true })
    // Riassegnazione del venditore o esito cambiato: via la chiusura, la presenza resta (latch).
    const senzaChiusura = piumeDovute({ ...presente, salespersonOutcome: null }, INIZIO)
    assert.deepEqual(pianoPiuma(rows, 'chiusura', LEAD, senzaChiusura.chiusura).storna, [`P:chiusura:${LEAD}:1`])
    assert.deepEqual(pianoPiuma(rows, 'presenza', LEAD, senzaChiusura.presenza).storna, [])
    // Esito rimosso con il latch azzerato: via anche la presenza.
    const senzaPresenza = piumeDovute({ ...presente, salespersonOutcome: null, presentedAt: null }, INIZIO)
    assert.deepEqual(pianoPiuma(rows, 'presenza', LEAD, senzaPresenza.presenza).storna, [`P:presenza:${LEAD}:1`])
    // Conferma cambiata (scartato) o appuntamento annullato (conferma azzerata): via tutto.
    for (const stato of [{ ...presente, confirmationsOutcome: 'scartato' }, { ...presente, confirmationsOutcome: null, presentedAt: null, salespersonOutcome: null }]) {
        const d = piumeDovute(stato, INIZIO)
        for (const tipo of ['conferma', 'presenza', 'chiusura'] as const) {
            assert.equal(pianoPiuma(rows, tipo, LEAD, d[tipo]).storna.length, 1, `${tipo} da stornare`)
        }
    }
})
