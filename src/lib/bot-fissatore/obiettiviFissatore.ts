// Obiettivi della pagina /statistiche-fissatore: la linea del piano (fissa nel
// codice) e gli obiettivi del funnel del bot (default nel codice, valore
// dell'admin in appSettings che vince sempre).

import { toRomeDateStr } from '@/lib/dateUtils'
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
/** Confermati ÷ appuntamenti dei GDO. Piano §2 (base 10,7%) e §8.3 (rientro R0-CONF: tasso GDO ≥ 10,2%). */
export const PIANO_CONFERMA_GDO = { linea: 10.2, base: 10.7 } as const
/**
 * Chiusi ÷ presentati. Piano §1, §3.2 e §12: chiusura sulle presenze al 38%,
 * soglia di sicurezza 27,5%. Il piano non la divide fra bot e GDO.
 */
export const PIANO_CHIUSURA_PRESENTATI = { obiettivo: 38, sicurezza: 27.5 } as const

export const CHIAVI_OBIETTIVI = ['appuntamenti', 'risposta', 'fissaggioTotale', 'fissaggioRisposti', 'restituzione'] as const
export type ChiaveObiettivo = typeof CHIAVI_OBIETTIVI[number]

/** Le chiavi che sono percentuali (0-100); le altre sono conteggi interi. */
export const OBIETTIVI_PERCENTUALI: readonly ChiaveObiettivo[] = ['risposta', 'fissaggioTotale', 'fissaggioRisposti', 'restituzione']

export const ETICHETTE_OBIETTIVI: Record<ChiaveObiettivo, string> = {
    appuntamenti: 'Appuntamenti fissati dal bot (al mese)',
    risposta: 'Lead che rispondono al bot',
    fissaggioTotale: 'Lead fissati, su tutti quelli ricevuti',
    fissaggioRisposti: 'Lead fissati, su quelli che rispondono',
    restituzione: 'Lead che il bot ridà ai GDO',
}

export const DIREZIONE_OBIETTIVI: Record<ChiaveObiettivo, Direzione> = {
    appuntamenti: 'alto',
    risposta: 'alto',
    fissaggioTotale: 'alto',
    fissaggioRisposti: 'alto',
    restituzione: 'basso',
}

export type FonteDefault = 'piano' | 'base_piano' | 'miglior_mese'
export type FonteObiettivo = FonteDefault | 'admin'

export type ObiettivoDefault = { valore: number | null; fonte: FonteDefault; dettaglio?: string }
export type ObiettiviDefault = Record<ChiaveObiettivo, ObiettivoDefault>
export type ObiettiviSalvati = Partial<Record<ChiaveObiettivo, number>>
export type ObiettivoRisolto =
    | { valore: number; fonte: FonteObiettivo; dettaglio?: string }
    | { valore: null; fonte: null }
export type ObiettiviRisolti = Record<ChiaveObiettivo, ObiettivoRisolto>

export const TESTO_FONTE: Record<FonteObiettivo, string> = {
    piano: 'dal piano',
    base_piano: 'come nel periodo base del piano (1/8-14/9)',
    miglior_mese: 'miglior mese del bot',
    admin: "scritto dall'admin",
}

/** "dal piano (§8.2)", "miglior mese del bot (agosto)", "scritto dall'admin". */
export function testoFonte(o: { valore?: number | null; fonte: FonteObiettivo; dettaglio?: string }): string {
    return o.dettaglio ? `${TESTO_FONTE[o.fonte]} (${o.dettaglio})` : TESTO_FONTE[o.fonte]
}

function valido(k: ChiaveObiettivo, n: unknown): n is number {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false
    return OBIETTIVI_PERCENTUALI.includes(k) ? n <= 100 : Number.isInteger(n)
}

/** Il JSON di appSettings: tiene solo le chiavi note con un numero valido. */
export function leggiObiettiviSalvati(raw: string | null | undefined): ObiettiviSalvati {
    if (!raw) return {}
    let v: unknown
    try { v = JSON.parse(raw) } catch { return {} }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: ObiettiviSalvati = {}
    for (const k of CHIAVI_OBIETTIVI) {
        const n = (v as Record<string, unknown>)[k]
        if (valido(k, n)) out[k] = n
    }
    return out
}

/** Il valore dell'admin vince sempre; poi il default; altrimenti "da impostare". */
export function risolviObiettivi(salvati: ObiettiviSalvati, def: ObiettiviDefault): ObiettiviRisolti {
    const out = {} as ObiettiviRisolti
    for (const k of CHIAVI_OBIETTIVI) {
        const s = salvati[k]
        const d = def[k]
        if (s !== undefined) out[k] = { valore: s, fonte: 'admin' }
        else if (d.valore !== null) out[k] = d.dettaglio ? { valore: d.valore, fonte: d.fonte, dettaglio: d.dettaglio } : { valore: d.valore, fonte: d.fonte }
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
        if (!valido(k, n)) {
            const regola = OBIETTIVI_PERCENTUALI.includes(k) ? 'un numero fra 0 e 100' : 'un numero intero da 0 in su'
            return { ok: false, errore: `${ETICHETTE_OBIETTIVI[k]}: scrivi ${regola}` }
        }
        valori[k] = n
    }
    return { ok: true, valori }
}

/**
 * Un obiettivo mensile (conteggio) riportato ai giorni passati del mese in
 * corso: obiettivo × giorni trascorsi ÷ giorni del mese, con oggi contato
 * (giorno di Roma). Per un mese chiuso è l'obiettivo pieno.
 */
export function obiettivoInProporzione(obiettivo: number, mese: string, ora: Date): {
    valore: number; giorniTrascorsi: number; giorniMese: number; inCorso: boolean
} {
    const [a, m] = mese.split('-').map(Number)
    const giorniMese = new Date(Date.UTC(a, m, 0)).getUTCDate()
    const oggi = toRomeDateStr(ora)
    if (oggi.slice(0, 7) !== mese) return { valore: obiettivo, giorniTrascorsi: giorniMese, giorniMese, inCorso: false }
    const giorniTrascorsi = Number(oggi.slice(8, 10))
    return { valore: (obiettivo * giorniTrascorsi) / giorniMese, giorniTrascorsi, giorniMese, inCorso: true }
}
