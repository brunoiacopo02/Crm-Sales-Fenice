// Tasso di risposta per le persone delle Conferme (titolare 28/11/2026): nel
// foglio delle SIM, colonna UTENTI, ci sono anche Noemi, Alberto e Andrea.
//
// Le Conferme NON scrivono in callLogs (0 righe): ogni loro tentativo lascia un
// evento in leadEvents con userId e orario. Gli esiti che mettono sui loro
// account, giorno per giorno:
//   - NR (conferme_no_answer, conferme_auto_discarded_3nr): chiamata senza
//     risposta. conferme_nr_undone toglie un NR (clic annullato).
//   - esito confermato o scartato (conferme_outcome_set): chiamata con risposta.
//     Fuori dal conto lo scarto «numero inesistente» (come per i GDO, la SIM non
//     c'entra); lo scarto a mano «non risponde» è una chiamata senza risposta.
//   - richiamo fissato (conferme_snooze_set, conferme_recall_scheduled): il
//     cliente ha risposto e chiede di essere richiamato, come RICHIAMO per i
//     GDO: chiamata con risposta. Si spegne con CONTA_RICHIAMI.
// I campi leads.confCall1At/2At/3At non dicono CHI ha chiamato (solo quando),
// quindi non servono per una persona.
//
// La media di riferimento è separata da quella dei GDO (lavoro diverso): stesso
// conto, su tutte le persone delle Conferme (no prova, no bot, anche uscite)
// dal 1 giugno 2026.

import type { Conteggio } from './tasso'

export const EVENTI_CONFERME = [
    'conferme_no_answer',
    'conferme_auto_discarded_3nr',
    'conferme_nr_undone',
    'conferme_outcome_set',
    'conferme_snooze_set',
    'conferme_recall_scheduled',
] as const

/** I richiami fissati contano come risposta (vedi sopra). */
export const CONTA_RICHIAMI = true

/** Motivi di scarto che non sono una conversazione. */
const MOTIVO_INESISTENTE = 'numero inesistente'
const MOTIVO_NON_RISPONDE = 'non risponde'

export interface EventoConferme {
    eventType: string
    /** metadata.outcome di conferme_outcome_set: 'confermato' | 'scartato'. */
    outcome: string | null
    /** Motivo di scarto del lead (leads.confirmationsDiscardReason). */
    discardReason: string | null
    createdAt: Date
}

function motivo(v: string | null): string {
    return (v ?? '').trim().toLowerCase()
}

/** Quanto vale un evento: chiamate e risposte da sommare (le chiamate possono essere -1). */
export function valutaEventoConferme(e: { eventType: string; outcome: string | null; discardReason: string | null }): Conteggio {
    switch (e.eventType) {
        case 'conferme_no_answer':
        case 'conferme_auto_discarded_3nr':
            return { chiamate: 1, risposte: 0 }
        case 'conferme_nr_undone':
            return { chiamate: -1, risposte: 0 }
        case 'conferme_outcome_set': {
            if (e.outcome === 'confermato') return { chiamate: 1, risposte: 1 }
            if (e.outcome !== 'scartato') return { chiamate: 0, risposte: 0 }
            const m = motivo(e.discardReason)
            if (m === MOTIVO_INESISTENTE) return { chiamate: 0, risposte: 0 }
            if (m === MOTIVO_NON_RISPONDE) return { chiamate: 1, risposte: 0 }
            return { chiamate: 1, risposte: 1 }
        }
        case 'conferme_snooze_set':
        case 'conferme_recall_scheduled':
            return CONTA_RICHIAMI ? { chiamate: 1, risposte: 1 } : { chiamate: 0, risposte: 0 }
        default:
            return { chiamate: 0, risposte: 0 }
    }
}

function somma(valori: Conteggio[]): Conteggio {
    const c = valori.reduce((a, v) => ({ chiamate: a.chiamate + v.chiamate, risposte: a.risposte + v.risposte }), { chiamate: 0, risposte: 0 })
    // Un NR annullato in un giorno diverso da quello del clic non deve dare numeri negativi.
    const chiamate = Math.max(0, c.chiamate)
    return { chiamate, risposte: Math.min(Math.max(0, c.risposte), chiamate) }
}

/** Conta gli eventi da `dal` in poi (incluso); `dal` null = tutti. */
export function contaEventiConferme(eventi: EventoConferme[], dal: Date | null = null): Conteggio {
    return somma(eventi
        .filter(e => !dal || e.createdAt.getTime() >= dal.getTime())
        .map(valutaEventoConferme))
}

/** Stesso conto su righe già raggruppate dalla query (evento, esito, motivo, quante). */
export function contaGruppiConferme(gruppi: { eventType: string; outcome: string | null; discardReason: string | null; n: number }[]): Conteggio {
    return somma(gruppi.map(g => {
        const v = valutaEventoConferme(g)
        return { chiamate: v.chiamate * g.n, risposte: v.risposte * g.n }
    }))
}
