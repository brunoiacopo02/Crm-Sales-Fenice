// Cosa vede un GDO dei lead che passano dal bot (PO 25/10/2026): niente.
// Nessuna schermata GDO deve nominare il bot, la chat, il Fissatore o "GDO 201".
// Le note del bot non si mostrano proprio, nemmeno ridotte o rese neutre
// (PO 25/10 mattina): niente "ha scritto di nuovo, aspetta prima di chiamarlo".
// Resta solo "Ti ha cercato" con le parole del lead: sono sue, e servono a chi
// lo richiama. Funzioni pure, usate lato server prima che i dati arrivino al browser.

import { destinatarioAssegnazione } from './arrivo'

/** Parole che un testo mostrato al GDO non deve contenere (le usano anche i test). */
export const PAROLE_VIETATE = /\b(bot|chat|fissatore)\b|gdo\s*201|evento sconosciuto/i

const MARCATORE_PAROLE = /(?:parole del lead|sue parole)\s*:\s*/i
const CHIUSURE: Record<string, string> = { '"': '"', '“': '”', '«': '»' }

/**
 * Le parole del lead dentro un testo del bot ("... Parole del lead: "Mi chiami".").
 * La virgoletta di chiusura è quella seguita da fine testo, da un punto o da una
 * nuova frase: così un lead che cita qualcosa fra virgolette non viene troncato.
 */
export function paroleDelLead(testo: string | null | undefined): string | null {
    if (!testo) return null
    const m = MARCATORE_PAROLE.exec(testo)
    if (!m) return null
    const resto = testo.slice(m.index + m[0].length)
    const chiude = CHIUSURE[resto.charAt(0)]
    if (!chiude) return null
    const corpo = resto.slice(1)
    for (let i = 0; i < corpo.length; i++) {
        if (corpo[i] !== chiude) continue
        const dopo = corpo.slice(i + 1)
        if (/^\.?\s*($|[A-ZÀ-Ý])/.test(dopo) || /^[,;)]/.test(dopo)) {
            return corpo.slice(0, i).trim() || null
        }
    }
    // Testo troncato senza chiusura: vale quel che c'è.
    return corpo.trim() || null
}

export interface EventoTimeline {
    eventType: string
    userId: string | null
    userIsBot: boolean | null
    userName?: string | null
    metadata: unknown
    timestamp: Date | string
    fromSection: string | null
    toSection: string | null
}

export interface EventoTimelineGdo {
    tipo: string
    etichetta: string
    testo: string | null
    operatore: string | null
    fromSection: string | null
    toSection: string | null
}

const ASSEGNAZIONI = new Set(['ASSIGNED', 'REASSIGNED_ADMIN', 'REASSIGNED_FROM_BOT', 'SALES_PIPELINE_ASSIGNED'])

/** Eventi che il GDO vede, con l'etichetta di sempre dove c'era già. */
const ETICHETTE: Record<string, string> = {
    IMPORTED: 'Lead Importato',
    CALL_LOGGED: 'Chiamata Registrata',
    SECTION_MOVED: 'Spostato di Sezione',
    DISCARDED: 'Lead Scartato',
    RECALL_SET: 'Richiamo Programmato',
    APPOINTMENT_SET: 'Appuntamento Fissato',
    contact_info_edited: 'Dati Contatto Modificati',
    followup_rescheduled: 'Follow-up spostato',
    lead_parked: 'Messo in lavorazione',
    salesperson_outcome_cleared: 'Esito venditore rimosso',
    venditore_appointment_rescheduled: 'Appuntamento spostato dal venditore',
    appointment_forced: 'Appuntamento forzato',
    AGENDA_SENT: 'Agenda inviata',
    AGENDA_DELIVERED: 'Agenda consegnata',
    INBOUND_MESSAGE: 'Ci ha scritto',
    BOT_APPOINTMENT_RESCHEDULED: 'Appuntamento spostato',
    NOTE: 'Nota',
}

/** Tipi rinominati per il GDO: il nome interno dell'evento non arriva al browser. */
const TIPI_NEUTRI: Record<string, string> = {
    BOT_APPOINTMENT_RESCHEDULED: 'APPOINTMENT_RESCHEDULED',
}

function leggiMetadata(m: unknown): Record<string, unknown> {
    if (typeof m === 'string') {
        try { return leggiMetadata(JSON.parse(m)) } catch { return {} }
    }
    return m && typeof m === 'object' ? m as Record<string, unknown> : {}
}

const testoDi = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Un evento della timeline come lo vede il GDO `io`, oppure null se per lui non
 * esiste. Gli eventi del bot spariscono o diventano neutri, quelli sconosciuti
 * spariscono invece di diventare "Evento Sconosciuto". Per admin e manager la
 * timeline resta quella di sempre: questa funzione si applica solo ai GDO.
 */
export function eventoTimelinePerGdo(e: EventoTimeline, io: string): EventoTimelineGdo | null {
    const meta = leggiMetadata(e.metadata)
    const vuoto = { testo: null, operatore: null, fromSection: null, toSection: null }

    if (ASSEGNAZIONI.has(e.eventType)) {
        const destinatario = destinatarioAssegnazione({
            eventType: e.eventType,
            userId: e.userId,
            timestamp: e.timestamp,
            toAssigneeId: testoDi(meta.toAssigneeId),
            assignedToUser: testoDi(meta.assignedToUser),
        })
        return destinatario === io ? { tipo: 'ASSIGNED', etichetta: 'Lead assegnato a te', ...vuoto } : null
    }

    // Le note del bot non arrivano al GDO, in nessuna forma.
    if (e.eventType === 'BOT_NOTE') return null

    if (e.eventType === 'BOT_CONTACT_REQUEST') {
        const parole = paroleDelLead(testoDi(meta.note))
        return { tipo: 'CONTACT_REQUEST', etichetta: 'Ti ha cercato', ...vuoto, testo: parole ? `"${parole}"` : null }
    }

    const etichetta = ETICHETTE[e.eventType]
    if (!etichetta) return null

    const umano = e.userIsBot === false
    // Una nota scritta dal bot o da uno script non è di nessun collega.
    if (e.eventType === 'NOTE' && !umano) return null

    // La nota di un collega si mostra come oggi; quella di una macchina no.
    const nota = umano ? testoDi(meta.note) : null
    return {
        tipo: TIPI_NEUTRI[e.eventType] ?? e.eventType,
        etichetta,
        testo: nota && !PAROLE_VIETATE.test(nota) ? `"${nota}"` : null,
        operatore: umano ? (e.userName ?? null) : null,
        fromSection: e.fromSection,
        toSection: e.toSection,
    }
}

/** Chi ha il lead, detto a un GDO: il bot è "In lavorazione". */
export function assegnatarioPerGdo(nome: string | null | undefined, isBot: boolean | null | undefined): string {
    if (isBot) return 'In lavorazione'
    return nome?.trim() || 'Nessuno'
}

/** Notifica al GDO a cui l'admin affida una richiesta di contatto. */
export function notificaTiHaCercato(nomeLead: string, motivo: string | null | undefined): { title: string; body: string } {
    const parole = paroleDelLead(motivo)
    const corte = parole && parole.length > 180 ? `${parole.slice(0, 180)}…` : parole
    return {
        title: 'Ti ha cercato: chiamalo tu',
        body: corte ? `${nomeLead}: "${corte}"` : nomeLead,
    }
}
