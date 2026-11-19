/**
 * Lead che il bot restituisce come NON_RISPOSTO perché il WhatsApp non è mai
 * stato consegnato (numero senza WhatsApp, errore Twilio 63024 o simili). Il
 * bot lo scrive nella nota: inizia con "WhatsApp mai consegnato" e chiude con
 * "chiamare a voce" (`esitoMaiConsegnato` in lib/bot-followups.ts del bot).
 *
 * Questi lead non hanno mai potuto rispondere: parcheggiarli come i "mai
 * risposto" (PO 19/10) voleva dire non farli contattare da nessuno. Dal
 * 28/10/2026 (PO) andavano ai GDO da chiamare, come le chat interrotte.
 *
 * Dal 19/11/2026 (titolare): rendono il 2% contro il 6-11% degli altri ridati,
 * quindi NON vanno più ai GDO. Si accantonano (pool "Lead accantonati" di
 * /import, motivo MOTIVO_WA_MAI_CONSEGNATO) e la scorta generale non li ridà.
 * Unica eccezione i Black Friday (07/11: priorità su tutto, mai accantonati),
 * che continuano ad andare ai GDO anche se mai consegnati.
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

/** Funnel BLACK FRIDAY (stessa regola di `eBlackFriday` in lib/diretta/scorta.ts). */
export function eFunnelBlackFriday(funnel: string | null | undefined): boolean {
    return (funnel ?? '').trim().toUpperCase() === 'BLACK FRIDAY'
}

/** Dove va un lead restituito dal bot, dato il motivo, la nota del bot, se ha letto e il funnel. */
export function instradamentoRidato(
    reason: 'mai_risposto' | 'chat_interrotta' | 'rifiutato_dal_bot',
    botNote: string | null | undefined,
    letto?: boolean | null,
    funnel?: string | null,
): InstradamentoRidato {
    // Il lead che il bot non ha nemmeno preso (PO 29/10) va chiamato: nessuno ci ha parlato.
    if (reason === 'chat_interrotta' || reason === 'rifiutato_dal_bot') return 'giro_gdo'
    // Black Friday (PO 07/11/2026): i ridati BF vanno ai GDO con priorità su tutto,
    // anche se non hanno mai risposto né letto, e anche se il WhatsApp non è mai
    // stato consegnato. Mai nel parcheggio.
    if (eFunnelBlackFriday(funnel)) return 'giro_gdo'
    // Titolare 19/11/2026: il WhatsApp mai consegnato rende il 2%, non va più ai GDO.
    if (isWhatsappMaiConsegnato(botNote)) return 'parcheggia'
    // PO 29/10/2026: chi ha LETTO il messaggio e non ha risposto non si parcheggia più,
    // va ai GDO come i ridati. Chi non l'ha letto (o il bot non lo dice) resta parcheggiato.
    return letto === true ? 'giro_gdo' : 'parcheggia'
}

export type EtichettaInstradato = 'mai_consegnato' | 'letto' | 'black_friday'

/**
 * `metadata.instradato` dell'evento REASSIGNED_FROM_BOT di un NON_RISPOSTO: dice
 * perché il lead ha preso quella strada. 'mai_consegnato' si scrive SEMPRE quando
 * la nota del bot lo dice, anche se il lead viene parcheggiato: è da lì che la
 * scorta (gruppoUscita), il serbatoio e gli script lo riconoscono. 'letto' e
 * 'black_friday' solo quando il lead va al giro dei GDO. null = niente etichetta.
 */
export function etichettaInstradato(
    reason: 'mai_risposto' | 'chat_interrotta' | 'rifiutato_dal_bot',
    botNote: string | null | undefined,
    letto: boolean | null | undefined,
    instradamento: InstradamentoRidato,
): EtichettaInstradato | null {
    if (reason !== 'mai_risposto') return null
    if (isWhatsappMaiConsegnato(botNote)) return 'mai_consegnato'
    if (instradamento !== 'giro_gdo') return null
    return letto === true ? 'letto' : 'black_friday'
}

/** Motivo dell'accantonamento (RIDATO_PARCHEGGIATO) di chi non ha mai risposto al bot. */
export const MOTIVO_MAI_RISPOSTO = 'mai_risposto_al_bot'
/** Motivo dell'accantonamento di un ridato con WhatsApp mai consegnato (titolare 19/11/2026). */
export const MOTIVO_WA_MAI_CONSEGNATO = 'wa_mai_consegnato'
/** I 60 tolti ai GDO il 19/11/2026 (scripts/diretta/togli-wa-mai-consegnato-19-11.ts). */
export const MOTIVO_WA_MAI_CONSEGNATO_19_11 = 'wa_mai_consegnato_19_11'
/** Motivi di accantonamento che vogliono dire "WhatsApp mai consegnato". */
export const MOTIVI_WA_MAI_CONSEGNATO: readonly string[] = [MOTIVO_WA_MAI_CONSEGNATO, MOTIVO_WA_MAI_CONSEGNATO_19_11]

/** Il motivo da scrivere sul RIDATO_PARCHEGGIATO quando il ritorno dal bot parcheggia il lead. */
export function motivoParcheggio(botNote: string | null | undefined): string {
    return isWhatsappMaiConsegnato(botNote) ? MOTIVO_WA_MAI_CONSEGNATO : MOTIVO_MAI_RISPOSTO
}

/**
 * Accantonato che NON va ridato ai GDO in automatico (titolare 19/11/2026):
 * l'ultima restituzione dal bot è un "WhatsApp mai consegnato", o è stato
 * accantonato con quel motivo. I Black Friday restano fuori dalla regola.
 */
export function eMaiConsegnatoDaNonRidare(l: {
    ultimoInstradato: string | null
    motivoAccantonamento: string | null
    funnel?: string | null
}): boolean {
    if (eFunnelBlackFriday(l.funnel)) return false
    return l.ultimoInstradato === 'mai_consegnato'
        || (l.motivoAccantonamento !== null && MOTIVI_WA_MAI_CONSEGNATO.includes(l.motivoAccantonamento))
}
