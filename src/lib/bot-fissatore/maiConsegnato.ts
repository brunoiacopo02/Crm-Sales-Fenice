/**
 * Lead che il bot restituisce come NON_RISPOSTO perché il WhatsApp non è mai
 * stato consegnato (numero senza WhatsApp, errore Twilio 63024 o simili). Il
 * bot lo scrive nella nota: inizia con "WhatsApp mai consegnato" e chiude con
 * "chiamare a voce" (`esitoMaiConsegnato` in lib/bot-followups.ts del bot).
 *
 * Questi lead non hanno mai potuto rispondere: parcheggiarli come i "mai
 * risposto" (PO 19/10) voleva dire non farli contattare da nessuno. Dal
 * 28/10/2026 (PO) vanno ai GDO da chiamare, come le chat interrotte.
 *
 * Riconoscimento sul prefisso, tollerante a maiuscole, spazi, apostrofi o
 * trattini nel nome ("Whats App", "whatsapp", "WhatsApp: mai consegnato").
 */
const MAI_CONSEGNATO = /^\W*whats\s*-?\s*app\W*\s*mai\s+consegnat[oa]/i

export function isWhatsappMaiConsegnato(botNote: string | null | undefined): boolean {
    if (!botNote) return false
    return MAI_CONSEGNATO.test(botNote.trim())
}

export type InstradamentoRidato = 'parcheggia' | 'giro_gdo'

/** Dove va un lead restituito dal bot, dato il motivo e la nota del bot. */
export function instradamentoRidato(
    reason: 'mai_risposto' | 'chat_interrotta' | 'rifiutato_dal_bot',
    botNote: string | null | undefined,
): InstradamentoRidato {
    // Il lead che il bot non ha nemmeno preso (PO 29/10) va chiamato: nessuno ci ha parlato.
    if (reason === 'chat_interrotta' || reason === 'rifiutato_dal_bot') return 'giro_gdo'
    return isWhatsappMaiConsegnato(botNote) ? 'giro_gdo' : 'parcheggia'
}
