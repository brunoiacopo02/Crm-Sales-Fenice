// Obiettivi della pagina /statistiche-fissatore: la linea del piano (fissa nel
// codice) e i quattro obiettivi del funnel del bot (default nel codice, valore
// dell'admin in appSettings che vince sempre).

import type { Direzione } from './statisticheFissatore'

/** Chiave di appSettings con gli obiettivi scritti dall'admin (JSON). */
export const OBIETTIVI_FISSATORE_KEY = 'fissatore_obiettivi'

// Linea del piano per gli appuntamenti del bot.
// Fonte: Piano Direzione Commerciale (16/10/2026) §2 e §8.3; Doc Paolo
// "Responsabile GDO, Conferme e HR" §2 e §5. Linea = requisito minimo, base =
// 1 agosto - 14 settembre 2026, lanci esclusi.
/** Confermati ÷ appuntamenti del bot. */
export const PIANO_CONFERMA_BOT = { linea: 18.6, base: 19.1 } as const
/** Confermati presentati ÷ confermati con appuntamento passato (nel piano vale per tutti i confermati). */
export const PIANO_PRESENZA_CONFERMATI = { linea: 85, base: 88.6 } as const

export const CHIAVI_OBIETTIVI = ['risposta', 'fissaggioTotale', 'fissaggioRisposti', 'restituzione'] as const
export type ChiaveObiettivo = typeof CHIAVI_OBIETTIVI[number]

export const ETICHETTE_OBIETTIVI: Record<ChiaveObiettivo, string> = {
    risposta: '% che risponde',
    fissaggioTotale: '% fissaggio sul totale',
    fissaggioRisposti: '% fissaggio su chi risponde',
    restituzione: '% restituzioni',
}

export const DIREZIONE_OBIETTIVI: Record<ChiaveObiettivo, Direzione> = {
    risposta: 'alto',
    fissaggioTotale: 'alto',
    fissaggioRisposti: 'alto',
    restituzione: 'basso',
}

export type FonteDefault = 'piano' | 'miglior_mese'
export type FonteObiettivo = FonteDefault | 'admin'

export type ObiettiviDefault = Record<ChiaveObiettivo, { valore: number | null; fonte: FonteDefault }>
export type ObiettiviSalvati = Partial<Record<ChiaveObiettivo, number>>
export type ObiettivoRisolto = { valore: number; fonte: FonteObiettivo } | { valore: null; fonte: null }
export type ObiettiviRisolti = Record<ChiaveObiettivo, ObiettivoRisolto>

export const TESTO_FONTE: Record<FonteObiettivo, string> = {
    piano: 'dal piano',
    miglior_mese: 'miglior mese del bot',
    admin: "scritto dall'admin",
}

function valido(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
}

/** Il JSON di appSettings: tiene solo le chiavi note con un numero 0-100. */
export function leggiObiettiviSalvati(raw: string | null | undefined): ObiettiviSalvati {
    if (!raw) return {}
    let v: unknown
    try { v = JSON.parse(raw) } catch { return {} }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: ObiettiviSalvati = {}
    for (const k of CHIAVI_OBIETTIVI) {
        const n = (v as Record<string, unknown>)[k]
        if (valido(n)) out[k] = n
    }
    return out
}

/** Il valore dell'admin vince sempre; poi il default; altrimenti "da impostare". */
export function risolviObiettivi(salvati: ObiettiviSalvati, def: ObiettiviDefault): ObiettiviRisolti {
    const out = {} as ObiettiviRisolti
    for (const k of CHIAVI_OBIETTIVI) {
        const s = salvati[k]
        if (s !== undefined) out[k] = { valore: s, fonte: 'admin' }
        else if (def[k].valore !== null) out[k] = { valore: def[k].valore as number, fonte: def[k].fonte }
        else out[k] = { valore: null, fonte: null }
    }
    return out
}

export type EsitoValidazione = { ok: true; valori: ObiettiviSalvati } | { ok: false; errore: string }

/** Input del form: stringhe; vuoto = nessun valore dell'admin (torna al default). */
export function validaObiettivi(input: Record<ChiaveObiettivo, string>): EsitoValidazione {
    const valori: ObiettiviSalvati = {}
    for (const k of CHIAVI_OBIETTIVI) {
        const t = String(input[k] ?? '').trim().replace(',', '.')
        if (t === '') continue
        const n = Number(t)
        if (!valido(n)) return { ok: false, errore: `${ETICHETTE_OBIETTIVI[k]}: scrivi un numero fra 0 e 100` }
        valori[k] = n
    }
    return { ok: true, valori }
}
