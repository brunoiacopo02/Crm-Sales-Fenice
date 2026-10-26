// Premi in euro della settimana (PO 25/10/2026, seconda tornata): classifica
// dei primi tre, bonus presenze dei GDO e bonus di squadra delle Conferme.
// Funzioni pure: la settimana, i conti e la forma di quello che si registra a
// settimana chiusa (tabella weeklyPrizeRuns, migr. 0051). La lettura dal DB è
// in ./settimanaDb.ts, l'action admin in src/app/actions/premiSettimanaActions.ts.
//
// La settimana va da lunedì a sabato (la domenica non si lavora): il lunedì
// alle 00:00 di Roma tutto riparte da zero.

import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import type { GamificationTargets } from '@/lib/diretta/config'
import { progressoSquadra, type ConfermeBonusConfig } from '@/lib/conferme/bonus'
import type { EconomyRules } from './rules'

const GIORNO_MS = 86_400_000

export interface SettimanaLunSab {
    /** Lunedì 00:00 di Roma. */
    start: Date
    /** Domenica 00:00 di Roma: il sabato è compreso, la domenica no. */
    end: Date
    /** Lunedì 'YYYY-MM-DD' (giorno di Roma): la chiave della settimana. */
    lunedi: string
    /** Sabato 'YYYY-MM-DD'. */
    sabato: string
}

/** Settimana lun-sab che contiene `at`; di domenica è quella appena chiusa. */
export function settimanaLunSab(at: Date): SettimanaLunSab {
    const w = weekBoundsRome(at)
    // Sabato a mezzogiorno circa: un'ora di cambio d'ora non sposta il giorno.
    const sabato = new Date(w.start.getTime() + 5 * GIORNO_MS + 12 * 3_600_000)
    return { start: w.start, end: dayBoundsRome(sabato).end, lunedi: toRomeDateStr(w.start), sabato: toRomeDateStr(sabato) }
}

/** La settimana lun-sab del lunedì 'YYYY-MM-DD' (null se la data non è un lunedì valido). */
export function settimanaDaLunedi(lunedi: string): SettimanaLunSab | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lunedi)) return null
    const s = settimanaLunSab(new Date(`${lunedi}T12:00:00Z`))
    return s.lunedi === lunedi ? s : null
}

/** La settimana prima (il lunedì precedente). */
export function settimanaPrima(s: SettimanaLunSab): SettimanaLunSab {
    return settimanaLunSab(new Date(s.start.getTime() - 3 * GIORNO_MS))
}

/** Chiusa = è già domenica (o dopo): i conti di quella settimana non cambiano più per il lavoro di squadra. */
export function settimanaChiusa(s: SettimanaLunSab, now: Date): boolean {
    return now.getTime() >= s.end.getTime()
}

// ── Ordine della classifica ─────────────────────────────────────────────

export interface RigaClassificaInput {
    userId: string
    nome: string
    presenze: number
    fissati: number
}

const perNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
const arrotonda = (n: number) => Math.round(n * 100) / 100

/**
 * Presenze della settimana, poi il nome solo come ordine di lettura: a pari
 * presenze si è pari merito (PO 26/10/2026, i fissati non spareggiano più:
 * chi fissa meno ma meglio non deve perdere).
 */
export function ordinaPerPresenze<T extends { nome: string; presenze: number }>(righe: readonly T[]): T[] {
    return [...righe].sort((a, b) => (b.presenze - a.presenze) || perNome(a, b))
}

/**
 * Posizioni a pari merito e premi divisi (PO 26/10/2026). Chi ha le stesse
 * presenze sta nella stessa posizione (1, 1, 3); i premi dei posti che il
 * gruppo occupa si sommano e si dividono in parti uguali: due primi a pari
 * merito prendono (50 + 25) / 2 = 37,50 a testa e chi viene dopo è terzo.
 * Il monte premi della settimana resta lo stesso. Sotto `minPresenze` niente premio.
 */
export function posizioniPremiate<T extends { nome: string; presenze: number }>(
    righe: readonly T[],
    premiEuro: readonly number[],
    minPresenze: number,
): Array<T & { posizione: number; euro: number }> {
    const ordinati = ordinaPerPresenze(righe)
    const out: Array<T & { posizione: number; euro: number }> = []
    for (let i = 0; i < ordinati.length;) {
        let j = i
        while (j < ordinati.length && ordinati[j].presenze === ordinati[i].presenze) j++
        const monte = ordinati[i].presenze >= minPresenze ? premiEuro.slice(i, j).reduce((t, x) => t + x, 0) : 0
        const euro = arrotonda(monte / (j - i))
        for (let k = i; k < j; k++) out.push({ ...ordinati[k], posizione: i + 1, euro })
        i = j
    }
    return out
}

// ── Calcolo dei premi ───────────────────────────────────────────────────

export interface NumeriSettimana {
    lunedi: string
    gdo: RigaClassificaInput[]
    conferme: {
        /** Chiusure (o presenze) di squadra dei lead confermati da un account Conferme. */
        chiusure: number
        presenze: number
        /** Le persone delle Conferme che hanno lavorato la settimana (almeno una conferma). */
        persone: Array<{ userId: string; nome: string }>
    }
}

export interface PremioClassifica { userId: string; nome: string; posizione: number; presenze: number; fissati: number; euro: number }
export interface PremioPresenze { userId: string; nome: string; presenze: number; pagate: number; euro: number }
export interface PremioConferme {
    unita: 'presenze' | 'chiusure'
    conteggio: number
    soglia: number
    oltre: number
    euroPerUnita: number
    /** Euro a testa (ognuno delle persone sotto prende questa cifra). */
    euroATesta: number
    persone: Array<{ userId: string; nome: string; euro: number }>
}

export interface PremiSettimana {
    lunedi: string
    classifica: PremioClassifica[]
    presenzeGdo: PremioPresenze[]
    /** null se il bonus Conferme non è a settimana (a mese si chiude a fine mese, non qui). */
    conferme: PremioConferme | null
    totaleEuro: number
}

export function calcolaPremiSettimana(
    n: NumeriSettimana,
    regole: { economia: EconomyRules; obiettivi: Pick<GamificationTargets, 'presenzeSogliaEuro' | 'euroPerPresenza'>; conferme: ConfermeBonusConfig },
): PremiSettimana {
    const min = regole.economia.classifica.minPresenze
    const classifica = posizioniPremiate(n.gdo, regole.economia.classifica.premiEuro, min)
        .filter(r => r.posizione <= 3 && r.presenze >= min)

    // €12 lordi per ogni presenza oltre la soglia (dalla 5ª): la stessa regola
    // di euroFromPresences della Diretta, che il GDO vede nel suo salvadanaio.
    const presenzeGdo = ordinaPerPresenze(n.gdo)
        .map(r => {
            const pagate = Math.max(0, r.presenze - regole.obiettivi.presenzeSogliaEuro)
            return { userId: r.userId, nome: r.nome, presenze: r.presenze, pagate, euro: arrotonda(pagate * regole.obiettivi.euroPerPresenza) }
        })
        .filter(r => r.euro > 0)

    let conferme: PremioConferme | null = null
    if (regole.conferme.periodo === 'settimana') {
        const conteggio = regole.conferme.unita === 'presenze' ? n.conferme.presenze : n.conferme.chiusure
        const p = progressoSquadra(conteggio, regole.conferme)
        conferme = {
            unita: regole.conferme.unita,
            conteggio: p.conteggio,
            soglia: p.soglia,
            oltre: p.oltre,
            euroPerUnita: regole.conferme.euroPerUnita,
            euroATesta: p.euro,
            persone: p.euro > 0 ? n.conferme.persone.map(x => ({ ...x, euro: p.euro })) : [],
        }
    }

    const totaleEuro = arrotonda(
        classifica.reduce((s, r) => s + r.euro, 0)
        + presenzeGdo.reduce((s, r) => s + r.euro, 0)
        + (conferme ? conferme.persone.reduce((s, r) => s + r.euro, 0) : 0),
    )
    return { lunedi: n.lunedi, classifica, presenzeGdo, conferme, totaleEuro }
}

/** Euro da pagare a ciascuno nella settimana, sommando i tre bonus. */
export function euroPerPersona(p: PremiSettimana): Array<{ userId: string; nome: string; euro: number }> {
    const m = new Map<string, { userId: string; nome: string; euro: number }>()
    const add = (userId: string, nome: string, euro: number) => {
        const x = m.get(userId) ?? { userId, nome, euro: 0 }
        x.euro = arrotonda(x.euro + euro)
        m.set(userId, x)
    }
    for (const r of p.classifica) add(r.userId, r.nome, r.euro)
    for (const r of p.presenzeGdo) add(r.userId, r.nome, r.euro)
    for (const r of p.conferme?.persone ?? []) add(r.userId, r.nome, r.euro)
    return [...m.values()].filter(x => x.euro > 0).sort((a, b) => b.euro - a.euro || perNome(a, b))
}

/**
 * Lettura difensiva di uno snapshot salvato (JSON della tabella): se la forma
 * non torna, null, e la pagina mostra la settimana come da ricalcolare.
 */
export function parsePremiSettimana(v: unknown): PremiSettimana | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const o = v as Record<string, unknown>
    if (typeof o.lunedi !== 'string' || !Array.isArray(o.classifica) || !Array.isArray(o.presenzeGdo) || typeof o.totaleEuro !== 'number') return null
    if (o.conferme !== null && (typeof o.conferme !== 'object' || !Array.isArray((o.conferme as Record<string, unknown>).persone))) return null
    return o as unknown as PremiSettimana
}
