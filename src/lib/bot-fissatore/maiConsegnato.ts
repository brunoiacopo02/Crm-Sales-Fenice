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

/**
 * `letto` del corpo NON_RISPOSTO (contratto v1.11): true se il lead ha letto almeno un
 * nostro messaggio (spunte blu). Solo un booleano vero conta; qualunque altro valore
 * è "non lo sappiamo" (null), e il lead si tratta come prima.
 */
export function lettoDalCorpo(v: unknown): boolean | null {
    return typeof v === 'boolean' ? v : null
}

/** Dove va un lead restituito dal bot, dato il motivo, la nota del bot e se ha letto. */
export function instradamentoRidato(
    reason: 'mai_risposto' | 'chat_interrotta' | 'rifiutato_dal_bot',
    botNote: string | null | undefined,
    letto?: boolean | null,
): InstradamentoRidato {
    // Il lead che il bot non ha nemmeno preso (PO 29/10) va chiamato: nessuno ci ha parlato.
    if (reason === 'chat_interrotta' || reason === 'rifiutato_dal_bot') return 'giro_gdo'
    if (isWhatsappMaiConsegnato(botNote)) return 'giro_gdo'
    // PO 29/10/2026: chi ha LETTO il messaggio e non ha risposto non si parcheggia più,
    // va ai GDO come i ridati. Chi non l'ha letto (o il bot non lo dice) resta parcheggiato.
    return letto === true ? 'giro_gdo' : 'parcheggia'
}
