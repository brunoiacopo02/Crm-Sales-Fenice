/**
 * Lead Black Friday arrivati da ActiveCampaign (PO 07/11/2026).
 *
 * Il funnel BLACK FRIDAY era nato per chi SCRIVE dal link wa.me dell'email (inbound,
 * dal 9/11, vedi lib/bot-fissatore/leadEntranti). Ma su AC c'e' anche una lista
 * "Black Friday 2026" riempita dalle inserzioni Meta (campagna utm
 * "|CBO| Black Friday - Test Creative - LEAD"), e i primi lead del 07/11 sono entrati
 * col campo Provenienza di AC sbagliato o vuoto (TELEGRAM, SCONOSCIUTO).
 *
 * Decisione PO: questi lead vanno SOLO al bot (mai ai GDO, per ora) e nel funnel
 * BLACK FRIDAY, qualunque cosa dica la Provenienza. Il segno si legge dalla campagna
 * (utm) o dalla lista AC: basta uno dei due.
 *
 * Modulo puro: niente DB, niente rete.
 */
export const BLACK_FRIDAY_FUNNEL = 'BLACK FRIDAY' as const;

/** Nome della lista AC, normalizzato come le altre (trim + lowercase). */
export const BLACK_FRIDAY_LIST_NAME_NORMALIZED = 'black friday 2026';

/** "Black Friday", "black-friday", "BLACKFRIDAY", "Blak Friday"... */
const MARKER = /\bbla(?:c)?k\s*-?\s*fr[iy]day\b/i;

export function haMarkerBlackFriday(t: string | null | undefined): boolean {
    return MARKER.test(t ?? '');
}

/**
 * Il lead AC e' del Black Friday? Si' se la campagna/contenuto/termine utm o la
 * Provenienza nominano il Black Friday, oppure se il contatto e' iscritto (o e'
 * entrato da) una lista AC del Black Friday.
 */
export function isLeadBlackFridayAc(i: {
    provenienza?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    /** Id delle liste AC "Black Friday 2026" (piu' di una se omonime). */
    blackFridayListIds?: ReadonlySet<string> | null;
    /** Lista del payload del webhook. */
    triggerListId?: string | null;
    /** Liste attive del contatto, se gia' lette. */
    activeListIds?: ReadonlySet<string> | null;
}): boolean {
    if ([i.provenienza, i.utmCampaign, i.utmContent, i.utmTerm].some(haMarkerBlackFriday)) return true;
    const bf = i.blackFridayListIds;
    if (!bf || bf.size === 0) return false;
    if (i.triggerListId && bf.has(String(i.triggerListId))) return true;
    if (i.activeListIds) for (const id of i.activeListIds) if (bf.has(id)) return true;
    return false;
}
