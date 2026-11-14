// Salvadanaio del mese dei GDO (PO 09/11/2026): i bonus in euro presi finora
// nel mese, settimana per settimana. Solo visualizzazione: le regole sono
// quelle dei premi della settimana (./premiSettimana.ts, calcolaPremiSettimana),
// così i numeri coincidono con la pagina /admin/diretta/premi-settimana.
//
// Regola del mese (confermata dal PO il 09/11/2026): una settimana lun-sab
// conta nel mese del suo SABATO, cioè dove si chiude e si paga. Novembre 2026
// = settimane 2-7, 9-14, 16-21 e 23-28/11; quella 30/11-5/12 va a dicembre.
//
// Nel totale del mese entrano solo le settimane CHIUSE (dalla domenica). La
// settimana in corso si mostra a parte, "in maturazione": il bonus presenze è
// già quello, la classifica può ancora cambiare.
//
// Se una settimana è registrata (weeklyPrizeRuns) valgono i numeri dello
// snapshot; altrimenti si ricalcola. Funzioni pure: la lettura è in ./premiMeseDb.ts.
//
// Conferme (titolare 14/11/2026): anche Noemi, Andrea e Alberto vedono il loro
// bonus di squadra (src/lib/conferme/bonus.ts) settimana per settimana. Gli
// importi sono sempre per persona: nessun totale di squadra in euro, e i
// totali del mese (totaleMese, totaleInMaturazione, totaleEuro delle
// settimane) restano quelli dei soli GDO, identici a prima.

import { DEFAULT_CONFERME_BONUS, type ConfermeBonusConfig } from '@/lib/conferme/bonus'
import type { GamificationTargets } from '@/lib/diretta/config'
import {
    calcolaPremiSettimana, settimanaChiusa, settimanaLunSab, settimanaPrima,
    type PremioConferme, type PremiSettimana, type SettimanaLunSab,
} from './premiSettimana'
import type { EconomyRules } from './rules'

const GIORNO_MS = 86_400_000
const arrotonda = (n: number) => Math.round(n * 100) / 100

/** Mese di Roma 'YYYY-MM' in cui conta la settimana: quello del sabato. */
export const meseDellaSettimana = (s: SettimanaLunSab) => s.sabato.slice(0, 7)

/** Le settimane lun-sab che contano nel mese 'YYYY-MM' (sabato nel mese). */
export function settimaneDelMese(mese: string): SettimanaLunSab[] {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mese)) return []
    const out: SettimanaLunSab[] = []
    let s = settimanaLunSab(new Date(`${mese}-01T12:00:00Z`))
    while (meseDellaSettimana(s) <= mese) {
        if (meseDellaSettimana(s) === mese) out.push(s)
        // Lunedì successivo a mezzogiorno: un'ora di cambio d'ora non sposta il giorno.
        s = settimanaLunSab(new Date(s.end.getTime() + 1.5 * GIORNO_MS))
    }
    return out
}

/** Il mese che il GDO vede nel salvadanaio: quello della settimana in corso (o appena chiusa, di domenica). */
export function meseDelSalvadanaio(now: Date): string {
    return meseDellaSettimana(settimanaLunSab(now))
}

/** L'ultima settimana chiusa: dal lunedì al sabato quella prima, di domenica quella appena finita. */
export function settimanaScorsa(now: Date): SettimanaLunSab {
    const s = settimanaLunSab(now)
    return settimanaChiusa(s, now) ? s : settimanaPrima(s)
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** 'YYYY-MM' → "novembre". */
export function nomeMese(mese: string): string {
    return MESI[Number(mese.slice(5, 7)) - 1] ?? mese
}

/** Date della settimana in chiaro: "2-7 novembre", "30 novembre - 5 dicembre". */
export function dateSettimana(lunedi: string, sabato: string): string {
    const g = (iso: string) => Number(iso.slice(8, 10))
    const m = (iso: string) => nomeMese(iso.slice(0, 7))
    return lunedi.slice(0, 7) === sabato.slice(0, 7)
        ? `${g(lunedi)}-${g(sabato)} ${m(sabato)}`
        : `${g(lunedi)} ${m(lunedi)} - ${g(sabato)} ${m(sabato)}`
}

// ── Calcolo ─────────────────────────────────────────────────────────────

export interface GdoDelMese {
    userId: string
    nome: string
    /** In squadra oggi (isTeamMember): compare anche senza presenze. */
    squadra: boolean
}

/** Una presenza (n = 1) o un aggiustamento manuale (n = count), nel momento in cui conta. */
export interface PresenzaGrezza { userId: string; at: Date | string; n: number }

/** Una persona delle Conferme. `squadra` = account attivo oggi: compare anche senza bonus. */
export type PersonaConferme = GdoDelMese

/**
 * Numeri grezzi delle Conferme sul periodo del mese (lead veri confermati da
 * un account CONFERME, come ./settimanaDb.ts): si dividono per settimana qui.
 */
export interface ConfermeGrezze {
    /** Tutte le persone delle Conferme, anche disattivate: chi ha lavorato una settimana passata resta. */
    persone: PersonaConferme[]
    /** salespersonOutcomeAt dei lead chiusi. */
    chiusure: Array<Date | string>
    /** presentedAt dei lead presentati. */
    presenze: Array<Date | string>
    /** Chi ha confermato e quando (confirmationsTimestamp): la quota va a chi ne ha almeno una nella settimana. */
    confermate: Array<{ userId: string; at: Date | string }>
    regola: ConfermeBonusConfig
}

export type Ruolo = 'GDO' | 'CONFERME'

export interface InputPremiMese {
    mese: string
    now: Date
    gdo: GdoDelMese[]
    presenze: PresenzaGrezza[]
    /** Assente = le Conferme non entrano (come prima del 14/11/2026). */
    conferme?: ConfermeGrezze
    /** Snapshot registrati, per lunedì 'YYYY-MM-DD'. */
    registrate: Record<string, PremiSettimana>
    /** Prima di questo istante i premi nuovi non c'erano: quelle settimane non contano. */
    inizioEconomia: Date
    regole: { economia: EconomyRules; obiettivi: Pick<GamificationTargets, 'presenzeSogliaEuro' | 'euroPerPresenza'> }
}

export interface VoceSettimana {
    presenze: number
    euroPresenze: number
    /** Posizione in classifica se premiata (pari merito: stessa posizione), altrimenti null. */
    posizione: number | null
    euroClassifica: number
    euro: number
}

export interface SettimanaDelMese {
    lunedi: string
    sabato: string
    registrata: boolean
    /** Per userId dei GDO; manca chi non ha presenze né premi. */
    voci: Record<string, VoceSettimana>
    /** Totale dei soli GDO. */
    totaleEuro: number
    /** Bonus di squadra delle Conferme (euro a testa); null se le Conferme non entrano o la regola non è a settimana. */
    conferme: PremioConferme | null
}

export interface RigaMese {
    userId: string
    nome: string
    ruolo: Ruolo
    euroMese: number
    euroInMaturazione: number
}

export interface PremiMese {
    mese: string
    /** Settimane chiuse del mese, dalla prima. */
    chiuse: SettimanaDelMese[]
    /** Settimana in corso, se è di questo mese. Provvisoria. */
    inCorso: SettimanaDelMese | null
    /** Settimane del mese ancora da iniziare (solo le date). */
    future: Array<{ lunedi: string; sabato: string }>
    /** Prima i GDO, poi le Conferme (una riga per account: Noemi ne ha due). */
    righe: RigaMese[]
    /** Totali dei soli GDO: per le Conferme gli importi sono solo per persona. */
    totaleMese: number
    totaleInMaturazione: number
}

const VOCE_VUOTA: VoceSettimana = { presenze: 0, euroPresenze: 0, posizione: null, euroClassifica: 0, euro: 0 }

/** Voci per GDO da un calcolo (o snapshot) dei premi della settimana. */
function vociDaPremi(premi: PremiSettimana, presenze: Map<string, number>): Record<string, VoceSettimana> {
    const voci: Record<string, VoceSettimana> = {}
    const voce = (id: string) => (voci[id] ??= { ...VOCE_VUOTA, presenze: presenze.get(id) ?? 0 })
    for (const id of presenze.keys()) voce(id)
    for (const r of premi.presenzeGdo) {
        const v = voce(r.userId)
        v.presenze = r.presenze
        v.euroPresenze = arrotonda(v.euroPresenze + r.euro)
    }
    for (const r of premi.classifica) {
        const v = voce(r.userId)
        v.presenze = r.presenze
        v.posizione = r.posizione
        v.euroClassifica = arrotonda(v.euroClassifica + r.euro)
    }
    for (const v of Object.values(voci)) v.euro = arrotonda(v.euroPresenze + v.euroClassifica)
    return voci
}

export function calcolaPremiMese(input: InputPremiMese): PremiMese {
    const { mese, now, gdo, regole } = input
    const settimane = settimaneDelMese(mese).filter(s => s.end.getTime() > input.inizioEconomia.getTime())
    const nomi = new Map(gdo.map(g => [g.userId, g.nome]))

    // Presenze per settimana (lunedì) e GDO. La domenica non conta.
    const perSettimana = new Map<string, Map<string, number>>(settimane.map(s => [s.lunedi, new Map()]))
    for (const p of input.presenze) {
        const at = p.at instanceof Date ? p.at : new Date(p.at)
        const s = settimanaLunSab(at)
        if (at.getTime() >= s.end.getTime()) continue
        const m = perSettimana.get(s.lunedi)
        if (!m || !nomi.has(p.userId)) continue
        m.set(p.userId, (m.get(p.userId) ?? 0) + (p.n || 0))
    }

    // Conferme: chiusure, presenze e chi ha confermato, per settimana. La domenica non conta.
    const cg = input.conferme
    const nomiConferme = new Map((cg?.persone ?? []).map(p => [p.userId, p.nome]))
    const numeriConferme = new Map(settimane.map(s => [s.lunedi, { chiusure: 0, presenze: 0, chi: new Set<string>() }]))
    const settimanaDi = (x: Date | string) => {
        const at = x instanceof Date ? x : new Date(x)
        const s = settimanaLunSab(at)
        return at.getTime() < s.end.getTime() ? numeriConferme.get(s.lunedi) : undefined
    }
    for (const at of cg?.chiusure ?? []) { const n = settimanaDi(at); if (n) n.chiusure++ }
    for (const at of cg?.presenze ?? []) { const n = settimanaDi(at); if (n) n.presenze++ }
    for (const c of cg?.confermate ?? []) {
        const n = settimanaDi(c.at)
        if (n && nomiConferme.has(c.userId)) n.chi.add(c.userId)
    }
    const premioConferme = (lunedi: string, snapshot: PremiSettimana | undefined): PremioConferme | null => {
        if (!cg) return null
        if (snapshot) return snapshot.conferme
        const n = numeriConferme.get(lunedi)
        if (!n) return null
        const persone = [...n.chi].map(userId => ({ userId, nome: nomiConferme.get(userId) ?? userId }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }))
        return calcolaPremiSettimana(
            { lunedi, gdo: [], conferme: { chiusure: n.chiusure, presenze: n.presenze, persone } },
            { economia: regole.economia, obiettivi: regole.obiettivi, conferme: cg.regola },
        ).conferme
    }

    // I GDO si calcolano senza le Conferme, come prima del 14/11/2026: i loro numeri non cambiano.
    const conferme = { ...DEFAULT_CONFERME_BONUS, periodo: 'mese' as const }
    const calcola = (s: SettimanaLunSab): SettimanaDelMese => {
        const presenze = perSettimana.get(s.lunedi) ?? new Map<string, number>()
        for (const [id, n] of presenze) if (n === 0) presenze.delete(id)
        const snapshot = input.registrate[s.lunedi]
        const premi = snapshot ?? calcolaPremiSettimana({
            lunedi: s.lunedi,
            gdo: [...presenze].map(([userId, n]) => ({ userId, nome: nomi.get(userId) ?? userId, presenze: n, fissati: 0 })),
            conferme: { chiusure: 0, presenze: 0, persone: [] },
        }, { economia: regole.economia, obiettivi: regole.obiettivi, conferme })
        const voci = vociDaPremi(premi, presenze)
        // Chi è nello snapshot ma non più fra i GDO letti: il nome dallo snapshot.
        for (const r of [...premi.classifica, ...premi.presenzeGdo]) if (!nomi.has(r.userId)) nomi.set(r.userId, r.nome)
        return {
            lunedi: s.lunedi,
            sabato: s.sabato,
            registrata: !!snapshot,
            voci,
            totaleEuro: arrotonda(Object.values(voci).reduce((t, v) => t + v.euro, 0)),
            conferme: premioConferme(s.lunedi, snapshot),
        }
    }

    const chiuse = settimane.filter(s => settimanaChiusa(s, now)).map(calcola)
    const corrente = settimane.find(s => !settimanaChiusa(s, now) && s.start.getTime() <= now.getTime())
    const inCorso = corrente ? calcola(corrente) : null
    const future = settimane.filter(s => s.start.getTime() > now.getTime()).map(s => ({ lunedi: s.lunedi, sabato: s.sabato }))

    const ids = new Set(gdo.filter(g => g.squadra).map(g => g.userId))
    for (const s of [...chiuse, ...(inCorso ? [inCorso] : [])]) for (const id of Object.keys(s.voci)) ids.add(id)
    const ordine = (a: RigaMese, b: RigaMese) => b.euroMese - a.euroMese || b.euroInMaturazione - a.euroInMaturazione
        || a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
    const righeGdo: RigaMese[] = [...ids].map(userId => ({
        userId,
        nome: nomi.get(userId) ?? userId,
        ruolo: 'GDO' as const,
        euroMese: arrotonda(chiuse.reduce((t, s) => t + (s.voci[userId]?.euro ?? 0), 0)),
        euroInMaturazione: inCorso?.voci[userId]?.euro ?? 0,
    })).sort(ordine)

    // Conferme: chi è in squadra oggi, più chi ha preso un bonus in una settimana del mese.
    const idsConferme = new Set((cg?.persone ?? []).filter(p => p.squadra).map(p => p.userId))
    for (const s of [...chiuse, ...(inCorso ? [inCorso] : [])]) {
        for (const p of s.conferme?.persone ?? []) {
            idsConferme.add(p.userId)
            if (!nomiConferme.has(p.userId)) nomiConferme.set(p.userId, p.nome)
        }
    }
    const euroConferme = (s: SettimanaDelMese | null, userId: string) => s?.conferme?.persone.find(p => p.userId === userId)?.euro ?? 0
    const righeConferme: RigaMese[] = [...idsConferme].map(userId => ({
        userId,
        nome: nomiConferme.get(userId) ?? userId,
        ruolo: 'CONFERME' as const,
        euroMese: arrotonda(chiuse.reduce((t, s) => t + euroConferme(s, userId), 0)),
        euroInMaturazione: euroConferme(inCorso, userId),
    })).sort(ordine)
    const righe = [...righeGdo, ...righeConferme]

    return {
        mese,
        chiuse,
        inCorso,
        future,
        righe,
        totaleMese: arrotonda(chiuse.reduce((t, s) => t + s.totaleEuro, 0)),
        totaleInMaturazione: inCorso?.totaleEuro ?? 0,
    }
}

// ── Il salvadanaio di un GDO ────────────────────────────────────────────

export interface SettimanaSalvadanaio extends VoceSettimana { lunedi: string; sabato: string; registrata: boolean }

export interface Salvadanaio {
    mese: string
    euroMese: number
    settimane: SettimanaSalvadanaio[]
    inCorso: SettimanaSalvadanaio | null
}

export function salvadanaioDi(m: PremiMese, userId: string): Salvadanaio {
    const una = (s: SettimanaDelMese): SettimanaSalvadanaio => ({
        lunedi: s.lunedi, sabato: s.sabato, registrata: s.registrata, ...(s.voci[userId] ?? VOCE_VUOTA),
    })
    return {
        mese: m.mese,
        euroMese: arrotonda(m.chiuse.reduce((t, s) => t + (s.voci[userId]?.euro ?? 0), 0)),
        settimane: m.chiuse.map(una),
        inCorso: m.inCorso ? una(m.inCorso) : null,
    }
}

// ── Il salvadanaio di una persona delle Conferme (titolare 14/11/2026) ──

export interface SettimanaConferme {
    lunedi: string
    sabato: string
    registrata: boolean
    unita: 'presenze' | 'chiusure'
    /** Chiusure (o presenze) di squadra; null se quella settimana il bonus non era a settimana. */
    conteggio: number | null
    soglia: number
    oltre: number
    /** Quanto vale la settimana a testa per chi ha confermato. */
    euroATesta: number
    /** Quanto ha preso questa persona (0 se non ha confermato nella settimana). */
    euro: number
}

export interface SalvadanaioConferme {
    mese: string
    euroMese: number
    settimane: SettimanaConferme[]
    inCorso: SettimanaConferme | null
}

/** Quello che vede una persona delle Conferme nella sua colonna. */
export interface VistaSalvadanaioConferme {
    /** L'ultima settimana chiusa, anche se è del mese prima; null se è prima dei premi nuovi. */
    scorsa: SettimanaConferme | null
    mese: SalvadanaioConferme
}

export function settimanaConfermeDi(s: SettimanaDelMese, userId: string): SettimanaConferme {
    const c = s.conferme
    return {
        lunedi: s.lunedi,
        sabato: s.sabato,
        registrata: s.registrata,
        unita: c?.unita ?? 'chiusure',
        conteggio: c ? c.conteggio : null,
        soglia: c?.soglia ?? 0,
        oltre: c?.oltre ?? 0,
        euroATesta: c?.euroATesta ?? 0,
        euro: c?.persone.find(p => p.userId === userId)?.euro ?? 0,
    }
}

export function salvadanaioConfermeDi(m: PremiMese, userId: string): SalvadanaioConferme {
    const settimane = m.chiuse.map(s => settimanaConfermeDi(s, userId))
    return {
        mese: m.mese,
        euroMese: arrotonda(settimane.reduce((t, s) => t + s.euro, 0)),
        settimane,
        inCorso: m.inCorso ? settimanaConfermeDi(m.inCorso, userId) : null,
    }
}
