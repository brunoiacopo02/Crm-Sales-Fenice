// Tasso di risposta per SIM (PO 14/11/2026, decisioni in memoria "SIM GDO").
//
// Tasso = risposte ÷ chiamate esitate (callLogs). Chiamata esitata = uno dei
// quattro esiti del GDO; risposta = esito diverso da NON_RISPOSTO. Le righe
// DA_SCARTARE con motivo "numero inesistente" stanno FUORI da numeratore e
// denominatore: il numero non esisteva, la SIM non c'entra.
//
// Differenza voluta con il canone KPI (src/lib/kpi/canon.ts): lì l'inesistente
// resta al denominatore come "non risposto". Qui no, per decisione del titolare.
// Il riconoscimento dell'inesistente è però lo stesso (isNeverAnsweredLog).

import { isAnsweredLog, isNeverAnsweredLog } from '@/lib/kpi/canon'

export const ESITI_CHIAMATA = ['NON_RISPOSTO', 'RICHIAMO', 'APPUNTAMENTO', 'DA_SCARTARE'] as const

/** Sotto queste chiamate nel giorno il tasso si scrive lo stesso, ma in grigio. */
export const MIN_CHIAMATE = 50
/** Rosso sotto il 90% della media di squadra. */
export const FATTORE_ROSSO = 0.9
/** La media di squadra parte dal 1 giugno 2026 (mese, ora di Roma). */
export const MEDIA_DAL_MESE = '2026-06'

export type Colore = 'grigio' | 'rosso' | 'verde'

export interface Conteggio {
    chiamate: number
    risposte: number
}

export interface LogChiamata {
    outcome: string | null
    discardReason: string | null
    createdAt: Date
}

const ESITI = new Set<string>(ESITI_CHIAMATA)

/** Quanto vale una riga di callLogs: fuori, chiamata senza risposta, chiamata con risposta. */
function valuta(outcome: string | null, discardReason: string | null): 'fuori' | 'chiamata' | 'risposta' {
    if (!ESITI.has(outcome ?? '')) return 'fuori'
    if (isNeverAnsweredLog(outcome, discardReason)) return 'fuori'
    return isAnsweredLog(outcome, discardReason) ? 'risposta' : 'chiamata'
}

/** Conta le chiamate esitate da `dal` in poi (incluso); `dal` null = tutte. */
export function contaChiamate(logs: LogChiamata[], dal: Date | null = null): Conteggio {
    const c: Conteggio = { chiamate: 0, risposte: 0 }
    for (const l of logs) {
        if (dal && l.createdAt.getTime() < dal.getTime()) continue
        const v = valuta(l.outcome, l.discardReason)
        if (v === 'fuori') continue
        c.chiamate++
        if (v === 'risposta') c.risposte++
    }
    return c
}

/** Stesso conto su righe già raggruppate dalla query (esito, motivo, quante). */
export function contaGruppi(gruppi: { outcome: string | null; discardReason: string | null; n: number }[]): Conteggio {
    const c: Conteggio = { chiamate: 0, risposte: 0 }
    for (const g of gruppi) {
        const v = valuta(g.outcome, g.discardReason)
        if (v === 'fuori') continue
        c.chiamate += g.n
        if (v === 'risposta') c.risposte += g.n
    }
    return c
}

export function tasso(c: Conteggio): number | null {
    return c.chiamate > 0 ? c.risposte / c.chiamate : null
}

export function sogliaRossa(media: number): number {
    return media * FATTORE_ROSSO
}

/** null = cella vuota senza colore (nessuna chiamata). */
export function coloreCella(c: Conteggio, soglia: number | null): Colore | null {
    const t = tasso(c)
    if (t === null) return null
    if (c.chiamate < MIN_CHIAMATE) return 'grigio'
    if (soglia !== null && t < soglia) return 'rosso'
    return 'verde'
}

/**
 * GDO che entrano nella media di squadra. Unico punto in cui si decide.
 *
 * Non si usa `isRealGdo` del canone KPI perché pretende l'account attivo: la
 * media va da giugno e deve contare anche chi da allora è uscito o è stato
 * spento (es. "GDO 109 storico", 117, 118 di Fabio). Fuori:
 *  - il bot fissatore (`isBot`, "GDO 201"): i suoi esiti non sono chiamate;
 *  - gli account di prova (`isTest`, "Prova GDO" 990);
 *  - il "GDO 108", l'account con cui entravano gli appuntamenti dell'IA
 *    vocale (Mario): non telefona con una SIM.
 */
export const GDO_FUORI_MEDIA = new Set<number>([108])

export function eGdoDellaMedia(u: { role: string; isBot: boolean; isTest: boolean; gdoCode: number | null }): boolean {
    if (u.role !== 'GDO' || u.isBot || u.isTest) return false
    return u.gdoCode === null || !GDO_FUORI_MEDIA.has(u.gdoCode)
}
