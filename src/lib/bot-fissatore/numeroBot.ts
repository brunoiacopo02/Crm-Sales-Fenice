/**
 * Quale dei due numeri del bot deve aprire la chat di un lead.
 *
 * Il PO li chiama **bot 1** (il numero storico, +393520413199) e **bot 2** (il
 * numero nuovo sul WABA separato, +393522070047). Bot 2 deve ricevere al massimo
 * un numero fisso di lead nuovi al giorno; tutto il resto va a bot 1.
 *
 * Perche' il tetto sta anche qui e non solo lato bot: il bot ha il suo controllo
 * ed e' quello che conta davvero (e' l'ultimo prima di Twilio), ma mandargli
 * lead che verrebbero comunque dirottati significa non sapere, guardando il CRM,
 * dove un lead e' finito. Due controlli d'accordo fra loro sono leggibili; uno
 * solo, in fondo alla catena, no.
 *
 * Modulo puro: niente DB, niente rete. Il conteggio lo passa il chiamante.
 */

export const TETTO_BOT2_DEFAULT = 150;

/** Il tetto giornaliero di bot 2, da `BOT2_DAILY_CAP`. */
export function tettoBot2(): number {
    const raw = process.env.BOT2_DAILY_CAP?.trim();
    if (!raw) return TETTO_BOT2_DEFAULT;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
        console.error(`[numeroBot] BOT2_DAILY_CAP="${raw}" non e' un intero fra 0 e 10000: uso ${TETTO_BOT2_DEFAULT}`);
        return TETTO_BOT2_DEFAULT;
    }
    return n;
}

/**
 * Il numero da usare, dato quanti lead ha gia' preso bot 2 oggi.
 *
 * `giaOggi` negativo o non finito significa "non lo so": in quel caso si torna
 * 1. Un lead in piu' sul numero storico non fa danno, un lead in piu' su bot 2
 * quando il conteggio e' rotto e' esattamente il modo in cui si brucia un
 * numero senza accorgersene.
 */
export function numeroBotPerNuovoLead(giaOggi: number, tetto: number = tettoBot2()): 1 | 2 {
    if (!Number.isFinite(giaOggi) || giaOggi < 0) return 1;
    return giaOggi < tetto ? 2 : 1;
}
