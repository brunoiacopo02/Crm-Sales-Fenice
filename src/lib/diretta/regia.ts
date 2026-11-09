// Regia dei lead (PO 09/11/2026): le regole della pagina /admin/diretta/regia-lead,
// senza DB. Le usano regiaDb.ts e le server action; si testano in regia.test.ts.
//
// Cosa decide questo modulo:
//  - i filtri dell'elenco lead (valori ammessi, predefiniti);
//  - chi NON si sposta e perché (appuntamento, Conferme, presentato, chiuso,
//    prova, lancio, e la protezione durante il turno: niente lead chiamati o
//    lavorati negli ultimi 30 minuti dal GDO che li ha, l'incidente del 06/11
//    con Zora);
//  - la ripartizione fra i GDO scelti (a turno);
//  - la fotografia prima/dopo dei campi toccati e quando un'operazione si può
//    ancora annullare, lead per lead.

import { eLeadDelLancio } from './instradamento'

/** Stati di un lead "aperto": la stessa definizione della panoramica e degli script. */
export const APERTI = ['NEW', 'IN_PROGRESS'] as const
/** Protezione durante il turno: minuti dall'ultima chiamata o lavorazione del GDO che ha il lead. */
export const MINUTI_PROTEZIONE = 30
/** Quanti lead al massimo in una sola operazione. */
export const MASSIMO_PER_OPERAZIONE = 500
/** Quanti lead al massimo al bot in una sola operazione (il push va a 30 al minuto). */
export const MASSIMO_AL_BOT = 60

export type Tentativi = 'tutti' | '0' | '1' | '2+'
export type SiNo = 'tutti' | 'si' | 'no'
export type Provenienza = 'tutti' | 'ridati' | 'vergini' | 'altri'
export type Richiamo = 'tutti' | 'con' | 'senza' | 'scaduti'

export interface FiltriLead {
    /** Funnel esatto (maiuscole come nel DB), null = tutti. */
    funnel: string | null
    tentativi: Tentativi
    bf: SiNo
    /** ridati = restituiti dal bot; vergini = freschi mai toccati da nessuno; altri = il resto. */
    provenienza: Provenienza
    richiamo: Richiamo
    /** Età in giorni dall'ingresso nel CRM (createdAt), estremi inclusi; null = senza limite. */
    etaMin: number | null
    etaMax: number | null
}

const scelta = <T extends string>(v: unknown, ammessi: readonly T[], predefinito: T): T =>
    (typeof v === 'string' && (ammessi as readonly string[]).includes(v) ? v as T : predefinito)

function giorni(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : null
}

/** Filtri dal client, ripuliti: un valore sconosciuto torna al predefinito. */
export function normalizzaFiltri(x: unknown): FiltriLead {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const funnel = typeof o.funnel === 'string' && o.funnel.trim() !== '' ? o.funnel.trim().slice(0, 120) : null
    return {
        funnel,
        tentativi: scelta(o.tentativi, ['tutti', '0', '1', '2+'] as const, 'tutti'),
        bf: scelta(o.bf, ['tutti', 'si', 'no'] as const, 'tutti'),
        provenienza: scelta(o.provenienza, ['tutti', 'ridati', 'vergini', 'altri'] as const, 'tutti'),
        richiamo: scelta(o.richiamo, ['tutti', 'con', 'senza', 'scaduti'] as const, 'tutti'),
        etaMin: giorni(o.etaMin),
        etaMax: giorni(o.etaMax),
    }
}

/** Quello che serve per decidere se un lead si può toccare. */
export interface LeadControllo {
    id: string
    assignedToId: string | null
    status: string
    callCount: number
    appointmentDate: Date | null
    presentedAt: Date | null
    confirmationsUserId: string | null
    confirmationsOutcome: string | null
    confCall1At: Date | null
    isTest: boolean
    lastCallDate: Date | null
    updatedAt: Date
    /** L'ultimo evento scritto dal titolare attuale sul lead (esiti, note, richiami). */
    ultimoEventoDelTitolare: Date | null
    launchBucket: string | null
    funnel: string | null
    lancioPool: string | null
    humanTestCohort: string | null
}

export interface ContestoEsclusione {
    /** Chi deve avere il lead adesso (null = senza assegnatario). */
    mittenteId: string | null
    /** Il titolare è un GDO umano: vale la protezione durante il turno. */
    titolareUmano: boolean
    ora: Date
}

const recente = (d: Date | null, ora: Date) => !!d && ora.getTime() - d.getTime() < MINUTI_PROTEZIONE * 60_000

/**
 * Perché questo lead non si sposta (null = si sposta). Vale per sposta,
 * accantona e "dai al bot": un lead con appuntamento, in Conferme, presentato
 * o chiuso resta dov'è; un lead che il GDO ha chiamato o lavorato negli
 * ultimi 30 minuti non gli si toglie.
 */
export function motivoEsclusione(l: LeadControllo, c: ContestoEsclusione): string | null {
    if (l.isTest) return 'lead di prova'
    if (l.assignedToId !== c.mittenteId) return 'non è più di chi lo aveva'
    if (l.status === 'APPOINTMENT' || l.appointmentDate) return 'ha un appuntamento'
    if (!(APERTI as readonly string[]).includes(l.status)) return 'chiuso o scartato'
    if (l.presentedAt) return 'già presentato'
    if (l.confirmationsUserId || l.confirmationsOutcome || l.confCall1At) return 'in mano alle Conferme'
    if (eLeadDelLancio(l)) return 'lead del lancio'
    if (c.titolareUmano) {
        if (recente(l.lastCallDate, c.ora)) return `chiamato da meno di ${MINUTI_PROTEZIONE} minuti`
        if (recente(l.ultimoEventoDelTitolare, c.ora) || recente(l.updatedAt, c.ora)) return `lavorato da meno di ${MINUTI_PROTEZIONE} minuti`
    }
    return null
}

/** Ripartizione a turno fra i destinatari, nell'ordine dei lead. */
export function ripartisci(ids: readonly string[], destinatari: readonly string[]): { id: string; a: string }[] {
    const d = [...new Set(destinatari)]
    if (d.length === 0) return []
    return ids.map((id, i) => ({ id, a: d[i % d.length] }))
}

// ── Prima e dopo ─────────────────────────────────────────────────────────

export type Valore = string | number | boolean | null
export type Fotografia = Record<string, Valore>

/** Campi del lead che le operazioni della regia possono toccare. */
export const CAMPI_LEAD = [
    'assignedToId', 'assignedAt', 'status', 'callCount', 'recallDate', 'recallNote', 'recallMissedAt',
    'scortaStato', 'scortaDal', 'discardReason', 'updatedAt',
] as const
/** Campi dell'appuntamento (togli appuntamento). */
export const CAMPI_APPUNTAMENTO = [
    'status', 'appointmentDate', 'appointmentNote', 'appointmentCreatedAt', 'salespersonAssigned', 'salespersonUserId',
    'salespersonAssignedAt', 'confirmationsOutcome', 'confirmationsDiscardReason', 'confirmationsUserId',
    'confirmationsTimestamp', 'salespersonOutcome', 'salespersonOutcomeNotes', 'salespersonOutcomeAt', 'presentedAt',
] as const
/** Campi del GDO (interruttori). */
export const CAMPI_GDO = ['isActive', 'acAutoIntake', 'botReturnIntake', 'freshOverflowScorta', 'dailyFreshCap'] as const

/** Campi data: nel ripristino tornano Date. */
export const CAMPI_DATA = new Set([
    'assignedAt', 'recallDate', 'recallMissedAt', 'scortaDal', 'updatedAt', 'appointmentDate', 'appointmentCreatedAt',
    'salespersonAssignedAt', 'confirmationsTimestamp', 'salespersonOutcomeAt', 'presentedAt',
])

function valore(v: unknown): Valore {
    if (v === undefined || v === null) return null
    if (v instanceof Date) return v.toISOString()
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    return String(v)
}

/** I campi scelti di una riga, con le date in ISO. */
export function fotografa(riga: Record<string, unknown>, campi: readonly string[]): Fotografia {
    const out: Fotografia = {}
    for (const c of campi) out[c] = valore(riga[c])
    return out
}

/** Campi che dicono se qualcuno ha lavorato il lead dopo l'operazione. La scorta e updatedAt no: cambiano da soli. */
const GUARDIA: { campo: string; motivo: string }[] = [
    { campo: 'assignedToId', motivo: 'ha cambiato assegnatario da allora' },
    { campo: 'callCount', motivo: 'è stato chiamato da allora' },
    { campo: 'status', motivo: 'ha cambiato stato da allora' },
    { campo: 'appointmentDate', motivo: 'l\'appuntamento è cambiato da allora' },
    { campo: 'discardReason', motivo: 'il motivo di scarto è cambiato da allora' },
]

const stesso = (a: Valore | undefined, b: Valore | undefined) => {
    const x = a ?? null, y = b ?? null
    if (typeof x === 'string' && typeof y === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && /^\d{4}-\d\d-\d\dT/.test(y)) {
        return Date.parse(x) === Date.parse(y)
    }
    return x === y
}

/**
 * Si può annullare l'operazione su questo lead? null = sì. Solo se il lead è
 * ancora come l'operazione l'ha lasciato sui campi che contano: se nel frattempo
 * un GDO l'ha chiamato, fissato o se l'è visto passare a un altro, resta com'è.
 */
export function annullabile(attuale: Fotografia, dopo: Fotografia): string | null {
    for (const g of GUARDIA) {
        if (!(g.campo in dopo)) continue
        if (!stesso(attuale[g.campo], dopo[g.campo])) return g.motivo
    }
    return null
}

/** I valori da rimettere: quelli di prima, solo sui campi che l'operazione ha toccato. */
export function ripristino(prima: Fotografia, dopo: Fotografia): Fotografia {
    const out: Fotografia = {}
    for (const k of Object.keys(dopo)) out[k] = prima[k] ?? null
    return out
}

/** Tetto giornaliero dei freschi: intero fra 0 e 1000, oppure vuoto (nessun tetto). Come /gestione. */
export function tettoValido(cap: number | null): boolean {
    return cap === null || (Number.isInteger(cap) && cap >= 0 && cap <= 1000)
}
