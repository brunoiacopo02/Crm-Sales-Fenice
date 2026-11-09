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

import { DEFAULT_CONFERME_BONUS } from '@/lib/conferme/bonus'
import type { GamificationTargets } from '@/lib/diretta/config'
import { calcolaPremiSettimana, settimanaChiusa, settimanaLunSab, type PremiSettimana, type SettimanaLunSab } from './premiSettimana'
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

export interface InputPremiMese {
    mese: string
    now: Date
    gdo: GdoDelMese[]
    presenze: PresenzaGrezza[]
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
    /** Per userId; manca chi non ha presenze né premi. */
    voci: Record<string, VoceSettimana>
    totaleEuro: number
}

export interface RigaMese {
    userId: string
    nome: string
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
    righe: RigaMese[]
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
        }
    }

    const chiuse = settimane.filter(s => settimanaChiusa(s, now)).map(calcola)
    const corrente = settimane.find(s => !settimanaChiusa(s, now) && s.start.getTime() <= now.getTime())
    const inCorso = corrente ? calcola(corrente) : null
    const future = settimane.filter(s => s.start.getTime() > now.getTime()).map(s => ({ lunedi: s.lunedi, sabato: s.sabato }))

    const ids = new Set(gdo.filter(g => g.squadra).map(g => g.userId))
    for (const s of [...chiuse, ...(inCorso ? [inCorso] : [])]) for (const id of Object.keys(s.voci)) ids.add(id)
    const righe = [...ids].map(userId => ({
        userId,
        nome: nomi.get(userId) ?? userId,
        euroMese: arrotonda(chiuse.reduce((t, s) => t + (s.voci[userId]?.euro ?? 0), 0)),
        euroInMaturazione: inCorso?.voci[userId]?.euro ?? 0,
    })).sort((a, b) => b.euroMese - a.euroMese || b.euroInMaturazione - a.euroInMaturazione
        || a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }))

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
