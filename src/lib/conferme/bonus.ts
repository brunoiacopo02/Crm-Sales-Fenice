// Bonus delle Conferme (PO 25/10/2026, confermato nella seconda tornata): una
// soglia di SQUADRA sulle CHIUSURE della settimana lun-sab, 16; oltre la soglia
// 12 euro lordi a testa per ogni chiusura in più. Unità e periodo restano
// parametri, modificabili dall'admin. In aggiunta gli obiettivi individuali
// sugli account (Andrea, Alberto); le Piume degli obiettivi settimanali di
// presenze e chiusure stanno nelle regole dell'economia (src/lib/economy/rules.ts).
//
// I valori vivono in appSettings (chiave CONFERME_BONUS_KEY, JSON) e li cambia
// l'admin da /admin/diretta/conferme. Qui ci sono i default e i calcoli, puri e
// testabili senza database.

import { monthBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'

export const CONFERME_BONUS_KEY = 'conferme_bonus'

export type BonusUnita = 'presenze' | 'chiusure'
export type BonusPeriodo = 'settimana' | 'mese'

/** Obiettivi individuali di un account Conferme. null = non impostato: non si mostra. */
export interface ObiettiviConferme {
    confermeGiorno: number | null
    presenzeSettimana: number | null
    chiusureMese: number | null
}

export interface ConfermeBonusConfig {
    unita: BonusUnita
    periodo: BonusPeriodo
    /** Unità di squadra da superare: si guadagna dalla (soglia + 1)ª in poi. */
    soglia: number
    /** Euro per ogni unità oltre la soglia. */
    euroPerUnita: number
    /** Obiettivi individuali per userId. */
    obiettivi: Record<string, ObiettiviConferme>
}

export const DEFAULT_CONFERME_BONUS: ConfermeBonusConfig = {
    unita: 'chiusure',
    periodo: 'settimana',
    soglia: 16,
    euroPerUnita: 12,
    obiettivi: {},
}

export const LIMITE_SOGLIA = 1000
export const LIMITE_EURO = 1000
export const LIMITE_OBIETTIVO = 999

const OBIETTIVI_KEYS = ['confermeGiorno', 'presenzeSettimana', 'chiusureMese'] as const

function isIntIn(v: unknown, min: number, max: number): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** Euro con al massimo due decimali, tra 0 e LIMITE_EURO. */
function isEuro(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= LIMITE_EURO
        && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
}

function isUnita(v: unknown): v is BonusUnita {
    return v === 'presenze' || v === 'chiusure'
}

function isPeriodo(v: unknown): v is BonusPeriodo {
    return v === 'settimana' || v === 'mese'
}

/** Un obiettivo vale se è un intero da 1 in su; 0, vuoto o rotto = non impostato. */
function obiettivoOrNull(v: unknown): number | null {
    return isIntIn(v, 1, LIMITE_OBIETTIVO) ? v : null
}

function haAlmenoUnObiettivo(o: ObiettiviConferme): boolean {
    return OBIETTIVI_KEYS.some(k => o[k] !== null)
}

/** Lettura tollerante degli obiettivi salvati: le voci rotte si scartano, le vuote spariscono. */
function parseObiettivi(raw: unknown): Record<string, ObiettiviConferme> {
    const out: Record<string, ObiettiviConferme> = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!userId || !value || typeof value !== 'object') continue
        const v = value as Record<string, unknown>
        const o: ObiettiviConferme = {
            confermeGiorno: obiettivoOrNull(v.confermeGiorno),
            presenzeSettimana: obiettivoOrNull(v.presenzeSettimana),
            chiusureMese: obiettivoOrNull(v.chiusureMese),
        }
        if (haAlmenoUnObiettivo(o)) out[userId] = o
    }
    return out
}

/**
 * Configurazione salvata unita ai default: un campo mancante o malformato
 * prende il default, senza buttare il resto. Mai un'eccezione: la colonna
 * della Diretta deve comparire anche con un JSON rovinato a mano.
 */
export function parseConfermeBonus(raw: string | null | undefined): ConfermeBonusConfig {
    if (!raw) return DEFAULT_CONFERME_BONUS
    let saved: unknown
    try {
        saved = JSON.parse(raw)
    } catch {
        return DEFAULT_CONFERME_BONUS
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULT_CONFERME_BONUS
    const s = saved as Record<string, unknown>
    return {
        unita: isUnita(s.unita) ? s.unita : DEFAULT_CONFERME_BONUS.unita,
        periodo: isPeriodo(s.periodo) ? s.periodo : DEFAULT_CONFERME_BONUS.periodo,
        soglia: isIntIn(s.soglia, 0, LIMITE_SOGLIA) ? s.soglia : DEFAULT_CONFERME_BONUS.soglia,
        euroPerUnita: isEuro(s.euroPerUnita) ? s.euroPerUnita : DEFAULT_CONFERME_BONUS.euroPerUnita,
        obiettivi: parseObiettivi(s.obiettivi),
    }
}

export type ConfermeBonusValidation =
    | { ok: true; value: ConfermeBonusConfig }
    | { ok: false; error: string }

/**
 * Validazione rigida di quello che arriva dalla pagina admin: qui un valore
 * sbagliato si rifiuta con un messaggio, non si sostituisce in silenzio.
 * `utentiAmmessi` limita gli obiettivi agli account Conferme esistenti.
 */
export function validateConfermeBonus(input: unknown, utentiAmmessi: ReadonlySet<string>): ConfermeBonusValidation {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'Dati mancanti.' }
    }
    const s = input as Record<string, unknown>
    if (!isUnita(s.unita)) return { ok: false, error: 'Scegli se il bonus conta le presenze o le chiusure.' }
    if (!isPeriodo(s.periodo)) return { ok: false, error: 'Scegli se il bonus vale a settimana o a mese.' }
    if (!isIntIn(s.soglia, 0, LIMITE_SOGLIA)) {
        return { ok: false, error: `La soglia deve essere un numero intero tra 0 e ${LIMITE_SOGLIA}.` }
    }
    if (!isEuro(s.euroPerUnita)) {
        return { ok: false, error: `L'importo per unità deve essere tra 0 e ${LIMITE_EURO} euro, al massimo con due decimali.` }
    }

    const obiettivi: Record<string, ObiettiviConferme> = {}
    const raw = s.obiettivi ?? {}
    if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Obiettivi individuali non validi.' }
    for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!utentiAmmessi.has(userId)) return { ok: false, error: 'Obiettivo assegnato a un account che non è delle Conferme.' }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { ok: false, error: 'Obiettivi individuali non validi.' }
        }
        const v = value as Record<string, unknown>
        const o = {} as ObiettiviConferme
        for (const k of OBIETTIVI_KEYS) {
            const x = v[k]
            if (x === null || x === undefined) { o[k] = null; continue }
            if (!isIntIn(x, 1, LIMITE_OBIETTIVO)) {
                return { ok: false, error: `Gli obiettivi individuali sono numeri interi tra 1 e ${LIMITE_OBIETTIVO}, oppure vuoti.` }
            }
            o[k] = x
        }
        if (haAlmenoUnObiettivo(o)) obiettivi[userId] = o
    }

    return {
        ok: true,
        value: { unita: s.unita, periodo: s.periodo, soglia: s.soglia, euroPerUnita: s.euroPerUnita, obiettivi },
    }
}

/** Finestra del bonus di squadra che contiene `now`: settimana ISO o mese, ora di Roma, fine esclusa. */
export function periodoBonusBounds(now: Date, periodo: BonusPeriodo): { start: Date; end: Date } {
    return periodo === 'settimana'
        ? weekBoundsRome(now)
        : monthBoundsRome(toRomeDateStr(now).slice(0, 7))
}

export interface ProgressoSquadra {
    conteggio: number
    soglia: number
    /** Unità oltre la soglia, quelle che valgono euro. */
    oltre: number
    /** Unità che mancano alla prima pagata (la soglia + 1ª); 0 se è già passata. */
    mancano: number
    euro: number
}

/** Euro maturati dalla squadra: solo le unità oltre la soglia, mai negativi. */
export function progressoSquadra(conteggio: number, cfg: Pick<ConfermeBonusConfig, 'soglia' | 'euroPerUnita'>): ProgressoSquadra {
    const n = Math.max(0, Math.floor(conteggio))
    const oltre = Math.max(0, n - cfg.soglia)
    return {
        conteggio: n,
        soglia: cfg.soglia,
        oltre,
        mancano: Math.max(0, cfg.soglia + 1 - n),
        euro: Math.round(oltre * cfg.euroPerUnita * 100) / 100,
    }
}
