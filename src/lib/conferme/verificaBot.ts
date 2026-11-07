/**
 * "App da verificare" (PO 07/11/2026).
 *
 * Dal 07/11 le Conferme fanno la 1ª chiamata il giorno lavorativo prima della call
 * (boardWindow.ts). Chi conferma il giorno prima rischia di sparire più di chi conferma
 * la mattina stessa: un'ora prima della call il bot gli chiede di confermare la presenza
 * (lato bot lib/verifica-presenza.ts, qui arriva da POST /api/bot/verifica-presenza).
 *
 * - Coorte: `confirmationsOutcome = 'confermato'` e la conferma è di un giorno di Roma
 *   precedente al giorno della call. Stessa regola del bot.
 * - Il bot scrive da max(T-60, 08:30) a T-45. Il lead ha 30 minuti: se tace, o risponde
 *   senza confermare, le Conferme lo devono chiamare (avviso bloccante). Se dice di non
 *   poter venire o di voler spostare, lo devono chiamare subito.
 *
 * Pura: niente DB, `now` arriva da fuori. Tutto in ora di Roma.
 */
import { toRomeDateStr } from '../dateUtils';

const MIN = 60_000;

export const VERIFICA_ANTICIPO_MS = 60 * MIN;
export const VERIFICA_ULTIMO_MS = 45 * MIN;
export const VERIFICA_TIMEOUT_MS = 30 * MIN;
/** Dopo l'inizio della call la verifica non serve più: è del venditore. */
export const VERIFICA_FINE_DOPO_CALL_MS = 10 * MIN;

export type EsitoVerificaBot = 'in_attesa' | 'confermato' | 'non_conferma' | 'risposta';
export const ESITI_VERIFICA: readonly EsitoVerificaBot[] = ['in_attesa', 'confermato', 'non_conferma', 'risposta'];

export type StatoVerifica =
    /** Il bot non scrive (call alle 9:00: il messaggio cadrebbe fuori fascia). */
    | 'esclusa'
    /** Il messaggio deve ancora partire (`dueAt` = quando parte). */
    | 'attesa_messaggio'
    /** Messaggio partito, il lead ha ancora tempo (`dueAt` = scadenza dei 30 minuti). */
    | 'in_attesa'
    | 'confermato'
    /** Da chiamare: silenzio oltre i 30 minuti, risposta senza conferma o non conferma. */
    | 'da_chiamare'
    /** Le Conferme l'hanno presa in mano (aperta dall'avviso o confermata a voce). */
    | 'gestita'
    | 'sparito'
    /** Passato il T-45 senza messaggio: il bot non l'ha raggiunto (niente chat, chat ferma…). */
    | 'non_raggiunto'

export type VerificaLead = {
    confirmationsOutcome: string | null
    confirmationsTimestamp: Date | null
    appointmentDate: Date | null
    botVerificaApptAt: Date | null
    botVerificaSentAt: Date | null
    botVerificaEsito: string | null
    botVerificaEsitoAt: Date | null
    botVerificaGestitaAt: Date | null
    botVerificaSparitoAt: Date | null
}

/** Ora e minuti di Roma. */
function romeHm(at: Date): { h: number; m: number } {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
    return { h: get('hour'), m: get('minute') }
}

export function inCoorteVerifica(l: Pick<VerificaLead, 'confirmationsOutcome' | 'confirmationsTimestamp' | 'appointmentDate'>): boolean {
    if (l.confirmationsOutcome !== 'confermato' || !l.confirmationsTimestamp || !l.appointmentDate) return false
    return toRomeDateStr(new Date(l.confirmationsTimestamp)) < toRomeDateStr(new Date(l.appointmentDate))
}

/**
 * Quando parte il messaggio del bot per una call, o null se non parte (stessa regola del
 * bot: T-60, ma mai prima delle 08:30 di Roma, e non dopo T-45).
 */
export function istanteVerifica(appointmentDate: Date): Date | null {
    const callMs = new Date(appointmentDate).getTime()
    let primo = callMs - VERIFICA_ANTICIPO_MS
    const { h, m } = romeHm(new Date(primo))
    const minuti = h * 60 + m
    if (minuti < 8 * 60 + 30) primo += (8 * 60 + 30 - minuti) * MIN
    if (primo > callMs - VERIFICA_ULTIMO_MS) return null
    return new Date(primo)
}

/** La verifica registrata vale per la data della call di adesso? */
function verificaDellaCall(l: VerificaLead): boolean {
    return !!l.botVerificaApptAt && !!l.appointmentDate
        && new Date(l.botVerificaApptAt).getTime() === new Date(l.appointmentDate).getTime()
}

export type StatoVerificaResult = {
    stato: StatoVerifica
    /** Istante che dà senso allo stato: quando parte il messaggio, quando scadono i 30
     *  minuti, da quando il lead è da chiamare. */
    dueAt: Date | null
}

export function statoVerifica(l: VerificaLead, now: Date): StatoVerificaResult {
    if (!l.appointmentDate) return { stato: 'esclusa', dueAt: null }
    const valida = verificaDellaCall(l)
    if (valida && l.botVerificaSparitoAt) return { stato: 'sparito', dueAt: new Date(l.botVerificaSparitoAt) }

    if (!valida || !l.botVerificaSentAt) {
        // Presa in mano dalle Conferme senza messaggio del bot (call alle 9, bot che non
        // l'ha raggiunto): resta presa.
        if (valida && l.botVerificaGestitaAt) return { stato: 'gestita', dueAt: new Date(l.botVerificaGestitaAt) }
        const istante = istanteVerifica(l.appointmentDate)
        if (!istante) return { stato: 'esclusa', dueAt: null }
        const ultimo = new Date(l.appointmentDate).getTime() - VERIFICA_ULTIMO_MS
        if (now.getTime() > ultimo + 5 * MIN) return { stato: 'non_raggiunto', dueAt: null }
        return { stato: 'attesa_messaggio', dueAt: istante }
    }

    const esito = (l.botVerificaEsito ?? 'in_attesa') as EsitoVerificaBot
    if (esito === 'confermato') return { stato: 'confermato', dueAt: l.botVerificaEsitoAt ? new Date(l.botVerificaEsitoAt) : null }

    const scadenza = new Date(new Date(l.botVerificaSentAt).getTime() + VERIFICA_TIMEOUT_MS)
    // Una non conferma è da chiamare da quando arriva: prima dei 30 minuti vuol dire
    // subito; dopo che le Conferme l'avevano già presa in mano, riaccende l'avviso.
    const daChiamareDal = esito === 'non_conferma' && l.botVerificaEsitoAt
        ? new Date(l.botVerificaEsitoAt)
        : scadenza

    if (now.getTime() < daChiamareDal.getTime()) return { stato: 'in_attesa', dueAt: scadenza }
    if (l.botVerificaGestitaAt && new Date(l.botVerificaGestitaAt).getTime() >= daChiamareDal.getTime()) {
        return { stato: 'gestita', dueAt: new Date(l.botVerificaGestitaAt) }
    }
    return { stato: 'da_chiamare', dueAt: daChiamareDal }
}

/** Il lead deve bloccare lo schermo delle Conferme adesso? (Snooze e claim a parte.) */
export function verificaBlocca(l: VerificaLead, now: Date): Date | null {
    if (!l.appointmentDate) return null
    if (now.getTime() > new Date(l.appointmentDate).getTime() + VERIFICA_FINE_DOPO_CALL_MS) return null
    const s = statoVerifica(l, now)
    return s.stato === 'da_chiamare' ? s.dueAt : null
}

/** Perché è da chiamare, detto alle Conferme. */
export function motivoDaChiamare(esito: string | null): string {
    if (esito === 'non_conferma') return 'Ha risposto al bot che non può o vuole spostare'
    if (esito === 'risposta') return 'Ha risposto al bot senza confermare'
    return 'Nessuna risposta al bot in 30 minuti'
}
