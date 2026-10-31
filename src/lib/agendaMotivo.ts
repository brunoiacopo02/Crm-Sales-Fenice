// Perché l'invio dell'agenda è fallito, quando il fornitore lo sa con certezza
// (contratto bot v1.12, campo `motivo` di /api/send-agenda). Modulo puro: lo
// usano sia il server (agendaBot, server action) sia il modale del GDO.

/** Unico motivo noto oggi: Twilio 63024, il numero non ha WhatsApp. */
export type AgendaMotivo = 'numero_senza_whatsapp'

const MOTIVI_NOTI: readonly string[] = ['numero_senza_whatsapp']

/** Il motivo dalla risposta del fornitore; qualunque altro valore vale "nessun motivo". */
export function motivoAgenda(raw: unknown): AgendaMotivo | undefined {
    return typeof raw === 'string' && MOTIVI_NOTI.includes(raw) ? (raw as AgendaMotivo) : undefined
}

/**
 * Testo per il GDO. Regole UI: niente bot, niente codici tecnici. Il campo
 * citato è quello del modale ("WhatsApp su un altro numero?").
 */
export const MESSAGGIO_NUMERO_SENZA_WHATSAPP =
    'Questo numero non ha WhatsApp. Chiedi al lead un numero su cui ha WhatsApp, scrivilo nel campo "WhatsApp su un altro numero?" e invia di nuovo.'
