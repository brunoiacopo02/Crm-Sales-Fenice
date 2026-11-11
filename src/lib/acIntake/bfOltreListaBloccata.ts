/**
 * Iscritti VERI al Black Friday che stanno anche in una lista bloccata senza
 * eccezioni (PO 11/11/2026).
 *
 * La lista AC 137 resta bloccata (PO 09/11/2026): il marketing ci carica in massa
 * ~30.000 contatti per le email e nessuno di loro deve entrare nel CRM o ricevere un
 * WhatsApp dal bot. Ma chi di loro compila DAVVERO la landing Black Friday (o
 * un'inserzione BF) e' un lead BF come gli altri: il 09-11/11 30 persone cosi' sono
 * rimaste fuori, perche' il blocco della 137 veniva prima di tutto.
 *
 * Come si distinguono (misurato sugli scarti `blocked_list:137` del 09-11/11, 26.064
 * contatti):
 *  - caricamento di massa: evento `subscribe` CON lista del payload = 137 (25.930 su
 *    26.064), campi utm senza traccia del Black Friday (una sola eccezione, gia' lead BF);
 *  - iscrizione BF vera: evento `subscribe` dalla lista "Black Friday 2026" (136)
 *    oppure `update` del contatto gia' noto (lista 0), e negli utm del contatto c'e'
 *    il segno della campagna ("LancioBlackFriday2026" o "|CBO| Black Friday ...")
 *    (118 contatti, tutti con il segno).
 *
 * Regola: il blocco senza eccezioni si scavalca SOLO se tutte e tre valgono:
 *  1. l'evento NON viene dalla lista bloccata (un `subscribe` alla 137 resta sempre
 *     fuori: e' esattamente il caricamento di massa);
 *  2. il contatto e' nella lista Black Friday (lista dell'evento o iscrizione attiva);
 *  3. i campi del contatto portano il segno del Black Friday (utm o Provenienza o la
 *     pagina della landing): un'aggiunta in blocco a una lista non scrive gli utm.
 * Evento diverso da subscribe/update (es. unsubscribe): mai.
 *
 * Modulo puro: niente DB, niente rete.
 */

export type BfOltreBloccoInput = {
    /** `type` del payload AC (subscribe, update, unsubscribe...). */
    eventType: string;
    /** Lista del payload (`list` / `list[id]`), null o '0' se assente. */
    triggerListId: string | null;
    /** La lista bloccata senza eccezioni trovata fra le iscrizioni del contatto. */
    listaBloccata: string;
    /** Le liste bloccate senza eccezioni (oggi solo 137). */
    listeBloccateSenzaEccezioni: ReadonlySet<string>;
    /** Gli id della lista "Black Friday 2026" (null se AC non la risolve). */
    listeBlackFriday: ReadonlySet<string> | null;
    /** Iscrizioni attive del contatto. */
    listeAttive: ReadonlySet<string>;
    /** I campi del contatto portano il segno del Black Friday (isLeadBlackFridayAc sui soli campi). */
    segnoBfNeiCampi: boolean;
};

export type BfOltreBloccoEsito =
    | { passa: true }
    | { passa: false; motivo: 'evento' | 'evento_dalla_lista_bloccata' | 'lista_bf_sconosciuta' | 'non_in_lista_bf' | 'senza_segno_bf' };

export function bfOltreListaBloccata(i: BfOltreBloccoInput): BfOltreBloccoEsito {
    if (i.eventType !== 'subscribe' && i.eventType !== 'update') return { passa: false, motivo: 'evento' };
    const trigger = i.triggerListId ? String(i.triggerListId) : null;
    if (trigger && (i.listeBloccateSenzaEccezioni.has(trigger) || trigger === i.listaBloccata)) {
        return { passa: false, motivo: 'evento_dalla_lista_bloccata' };
    }
    const bf = i.listeBlackFriday;
    if (!bf || bf.size === 0) return { passa: false, motivo: 'lista_bf_sconosciuta' };
    const inListaBf = (trigger !== null && bf.has(trigger)) || [...bf].some((id) => i.listeAttive.has(id));
    if (!inListaBf) return { passa: false, motivo: 'non_in_lista_bf' };
    if (!i.segnoBfNeiCampi) return { passa: false, motivo: 'senza_segno_bf' };
    return { passa: true };
}
