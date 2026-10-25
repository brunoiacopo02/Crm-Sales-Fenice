// Centro di controllo della Diretta (/admin/diretta, PO 25/10/2026): conti e
// testi del registro delle monete, dei controlli anti-imbroglio e dello stato
// di citazioni e consigli. Funzioni pure: le righe arrivano dalle action
// (centroDirettaActions), qui si contano e si mettono in parole.

import { fissatoValido } from './fissati'
import { euroIt, numeroConSegno } from './formato'

export type Valuta = 'S' | 'P'

// ── Registro delle monete ────────────────────────────────────────────────

/** Causali del registro con un ruolo nei totali (le altre sono premi). */
export const CAUSALE_NEGOZIO = 'negozio'
export const CAUSALE_RIMBORSO = 'negozio_rimborso'
export const CAUSALE_AZZERAMENTO = 'azzeramento'

/** Gli storni hanno la chiave 'storno:<chiave originale>' (src/lib/economy/ledger.ts). */
export function isStorno(idemKey: string): boolean {
    return idemKey.startsWith('storno:')
}

/** Righe del registro raggruppate per valuta, causale e storno. */
export interface GruppoRegistro {
    currency: string
    reason: string
    storno: boolean
    /** Somma degli importi positivi. */
    positivi: number
    /** Somma degli importi negativi (zero o meno). */
    negativi: number
}

export interface TotaliValuta {
    /** Premi accreditati: fissati, scalini, forzieri, Piume, benvenuto. */
    emesse: number
    /** Spese nel negozio, al netto dei rimborsi. */
    spese: number
    /** Tolte con uno storno o con un'altra correzione negativa. */
    stornate: number
}

const zero = (): TotaliValuta => ({ emesse: 0, spese: 0, stornate: 0 })

/**
 * Totali per valuta di un periodo. L'azzeramento del go-live non è né un
 * premio né una spesa e resta fuori; un rimborso del negozio riduce le spese.
 */
export function totaliRegistro(gruppi: readonly GruppoRegistro[]): Record<Valuta, TotaliValuta> {
    const out: Record<Valuta, TotaliValuta> = { S: zero(), P: zero() }
    for (const g of gruppi) {
        if (g.currency !== 'S' && g.currency !== 'P') continue
        const t = out[g.currency]
        if (g.reason === CAUSALE_AZZERAMENTO) continue
        if (g.storno) {
            t.stornate += -(g.positivi + g.negativi)
        } else if (g.reason === CAUSALE_NEGOZIO) {
            t.spese += -g.negativi
        } else if (g.reason === CAUSALE_RIMBORSO) {
            t.spese -= g.positivi
        } else {
            t.emesse += g.positivi
            t.stornate += -g.negativi
        }
    }
    return out
}

const CAUSALI: Record<string, string> = {
    fissato: 'Appuntamento fissato',
    scalino_personale: 'Obiettivo personale del giorno',
    forziere: 'Forziere di squadra',
    benvenuto: 'Benvenuto',
    azzeramento: 'Azzeramento',
    conferma: 'Conferma',
    presenza: 'Presenza',
    chiusura: 'Chiusura',
    negozio: 'Negozio',
    negozio_rimborso: 'Rimborso del negozio',
}

/** Causale del registro in parole: le note degli storni sono già frasi, le altre si traducono. */
export function causaleTesto(reason: string): string {
    const r = reason.trim()
    if (CAUSALI[r]) return CAUSALI[r]
    const t = r.replace(/_/g, ' ').replace(/\s+/g, ' ')
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Movimento'
}

// ── Controlli anti-imbroglio: fissati tolti nel giorno ───────────────────

/** callLog APPUNTAMENTO della squadra nel giorno, con lo stato attuale del lead. */
export interface RigaAppuntamento {
    userId: string | null
    leadId: string
    createdAt: Date | string
    stato: string | null
}

export interface ControlloPersona {
    userId: string
    /** Lead distinti fissati nel giorno. */
    fissati: number
    /** Ancora in appuntamento: quelli che contano per numeri e premi. */
    validi: number
    /** Fissati e poi usciti dall'appuntamento. */
    tolti: number
}

export interface Tolto {
    userId: string
    leadId: string
    /** Ultimo APPUNTAMENTO della persona su quel lead nel giorno (ISO). */
    fissatoAlle: string
    stato: string | null
}

const ms = (d: Date | string) => new Date(d).getTime()

/**
 * Per persona, i lead fissati nel giorno divisi in validi e tolti (stessa
 * definizione di fissato valido dei numeri e dei premi). Le persone con più
 * tolti vengono prima; i tolti sono dal più recente.
 */
export function controlloFissati(righe: readonly RigaAppuntamento[]): { persone: ControlloPersona[]; tolti: Tolto[] } {
    // persona -> lead -> riga più recente
    const perPersona = new Map<string, Map<string, RigaAppuntamento>>()
    for (const r of righe) {
        if (!r.userId) continue
        let lead = perPersona.get(r.userId)
        if (!lead) { lead = new Map(); perPersona.set(r.userId, lead) }
        const prima = lead.get(r.leadId)
        if (!prima || ms(r.createdAt) > ms(prima.createdAt)) lead.set(r.leadId, r)
    }

    const persone: ControlloPersona[] = []
    const tolti: Tolto[] = []
    for (const [userId, lead] of perPersona) {
        let validi = 0
        for (const r of lead.values()) {
            if (fissatoValido(r.stato)) {
                validi++
            } else {
                tolti.push({ userId, leadId: r.leadId, fissatoAlle: new Date(r.createdAt).toISOString(), stato: r.stato })
            }
        }
        persone.push({ userId, fissati: lead.size, validi, tolti: lead.size - validi })
    }
    persone.sort((a, b) => b.tolti - a.tolti || b.fissati - a.fissati || a.userId.localeCompare(b.userId))
    tolti.sort((a, b) => ms(b.fissatoAlle) - ms(a.fissatoAlle))
    return { persone, tolti }
}

export interface ChiamataDopo {
    leadId: string
    outcome: string
    createdAt: Date | string
    userId: string | null
}

/** Il primo esito registrato sul lead dopo l'appuntamento: è quello che l'ha tolto. */
export function esitoDopo(tolto: { leadId: string; fissatoAlle: string }, chiamate: readonly ChiamataDopo[]): ChiamataDopo | null {
    const da = ms(tolto.fissatoAlle)
    let primo: ChiamataDopo | null = null
    for (const c of chiamate) {
        if (c.leadId !== tolto.leadId || ms(c.createdAt) <= da) continue
        if (!primo || ms(c.createdAt) < ms(primo.createdAt)) primo = c
    }
    return primo
}

const ESITI: Record<string, string> = {
    APPUNTAMENTO: 'di nuovo appuntamento',
    RICHIAMO: 'richiamo',
    NON_RISPOSTO: 'non risponde',
    DA_SCARTARE: 'da scartare',
}

/** Esito di un callLog in parole. */
export function esitoTesto(outcome: string): string {
    return ESITI[outcome] ?? outcome.toLowerCase().replace(/_/g, ' ')
}

const STATI: Record<string, string> = {
    NEW: 'da chiamare',
    IN_PROGRESS: 'in lavorazione',
    APPOINTMENT: 'in appuntamento',
    REJECTED: 'scartato',
}

/** Stato del lead in parole. */
export function statoLeadTesto(stato: string | null): string {
    if (!stato) return 'stato sconosciuto'
    return STATI[stato] ?? stato.toLowerCase().replace(/_/g, ' ')
}

// ── Citazione del giorno e consiglio di vendita ──────────────────────────

export type StatoVoce = 'manca' | 'da_approvare' | 'approvata' | 'approvata_vuota'

/** La voce di un giorno com'è nel calendario admin (src/lib/quotes/adminTypes.ts). */
export interface VoceGiorno {
    quote: unknown | null
    reflection: string | null
    approved: boolean
    /** Spiegazione spenta dall'admin: si vede come approvata senza testo. */
    showReflection?: boolean
}

export function statoVoce(v: VoceGiorno): StatoVoce {
    if (!v.quote) return 'manca'
    if (!v.approved) return 'da_approvare'
    return v.reflection?.trim() && v.showReflection !== false ? 'approvata' : 'approvata_vuota'
}

/** Il giorno ha una riflessione (o un consiglio) approvata con un testo. */
export function haRiflessioneApprovata(v: VoceGiorno): boolean {
    return statoVoce(v) === 'approvata'
}

export function statoVoceTesto(stato: StatoVoce, kind: 'citazione' | 'vendita'): string {
    switch (stato) {
        case 'manca': return kind === 'citazione' ? 'Nessuna citazione' : 'Nessun consiglio'
        case 'da_approvare': return 'Da approvare'
        case 'approvata': return 'Approvata'
        case 'approvata_vuota': return kind === 'citazione' ? 'Approvata senza riflessione' : 'Approvata senza consiglio'
    }
}

export interface GiornoCalendario {
    day: string
    citazione: VoceGiorno
    vendita: VoceGiorno
}

export interface RiepilogoCalendario {
    giorni: number
    /** Giorni senza riflessione approvata sulla citazione. */
    citazioni: string[]
    /** Giorni senza consiglio approvato. */
    consigli: string[]
    /** Giorni a cui manca una delle due frasi. */
    mancanti: string[]
    /** Giorni con almeno una delle due voci ancora da approvare. */
    daApprovare: string[]
}

/** Quanti giorni del calendario sono ancora senza riflessione o consiglio approvati. */
export function riepilogoCalendario(giorni: readonly GiornoCalendario[]): RiepilogoCalendario {
    const out: RiepilogoCalendario = { giorni: giorni.length, citazioni: [], consigli: [], mancanti: [], daApprovare: [] }
    for (const g of giorni) {
        if (!haRiflessioneApprovata(g.citazione)) out.citazioni.push(g.day)
        if (!haRiflessioneApprovata(g.vendita)) out.consigli.push(g.day)
        if (!g.citazione.quote || !g.vendita.quote) out.mancanti.push(g.day)
        if (statoVoce(g.citazione) === 'da_approvare' || statoVoce(g.vendita) === 'da_approvare') out.daApprovare.push(g.day)
    }
    return out
}

/** Un giorno è "da sistemare" se una delle due voci manca o è da approvare. */
export function giornoDaSistemare(g: GiornoCalendario): boolean {
    const a = statoVoce(g.citazione)
    const b = statoVoce(g.vendita)
    return a === 'manca' || a === 'da_approvare' || b === 'manca' || b === 'da_approvare'
}

// ── Testi ────────────────────────────────────────────────────────────────

/** Prima lettera maiuscola: "lunedì 26 ottobre" diventa "Lunedì 26 ottobre". */
export function maiuscola(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "1 giorno", "3 giorni". */
export function giorniTesto(n: number): string {
    return n === 1 ? '1 giorno' : `${n} giorni`
}

/** Importo del registro col segno: "+10", "-2". Scritto a mano, vedi ./formato. */
export function importoConSegno(n: number): string {
    return numeroConSegno(n)
}

/** Euro alla maniera italiana, con i centesimi solo se ci sono: 12 €, 12,50 €. */
export function euroTesto(n: number): string {
    return euroIt(n)
}
