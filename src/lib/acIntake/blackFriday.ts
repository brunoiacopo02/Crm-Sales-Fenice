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
import { readUtmFields, type AcFieldValue, type AcUtmValues } from './utmFields';

export const BLACK_FRIDAY_FUNNEL = 'BLACK FRIDAY' as const;

/** Nome della lista AC, normalizzato come le altre (trim + lowercase). */
export const BLACK_FRIDAY_LIST_NAME_NORMALIZED = 'black friday 2026';

/**
 * "Black Friday", "black-friday", "BLACKFRIDAY", "Blak Friday", "black_friday"...
 * SENZA confini di parola (PO 09/11/2026): la landing manda utm_medium
 * "LancioBlackFriday2026", dove "Black" e "Friday" sono incollati a "Lancio" e a
 * "2026", e col vecchio \b il marker non lo vedeva.
 */
const MARKER = /bla(?:c)?k[\s_-]*fr[iy]day/i;

/** La pagina della landing ("blackfriday2026"), come nome pagina o dentro l'URL. */
const PAGINA_LANDING = /black-?friday-?2026/i;

export function haMarkerBlackFriday(t: string | null | undefined): boolean {
    return MARKER.test(t ?? '');
}

/** La pagina o l'URL della landing del Black Friday, se il campo arriva ad AC. */
export function haPaginaLandingBlackFriday(t: string | null | undefined): boolean {
    return PAGINA_LANDING.test(t ?? '');
}

/**
 * Il lead AC e' del Black Friday? Si' se un utm (source, medium, campagna,
 * contenuto, termine) o la Provenienza nominano il Black Friday, se un altro campo
 * AC porta la pagina della landing ("blackfriday2026"), oppure se il contatto e'
 * iscritto (o e' entrato da) una lista AC del Black Friday.
 */
export function isLeadBlackFridayAc(i: {
    provenienza?: string | null;
    /** La landing scrive "BlackFriday" / "LancioBlackFriday2026" nell'utm_medium (PO 09/11). */
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    /** Id delle liste AC "Black Friday 2026" (piu' di una se omonime). */
    blackFridayListIds?: ReadonlySet<string> | null;
    /** Lista del payload del webhook. */
    triggerListId?: string | null;
    /** Liste attive del contatto, se gia' lette. */
    activeListIds?: ReadonlySet<string> | null;
    /** Gli altri valori dei campi AC: pagina o landing_url "blackfriday2026", se arrivano. */
    altriCampi?: ReadonlyArray<string | null | undefined> | null;
}): boolean {
    if ([i.provenienza, i.utmSource, i.utmMedium, i.utmCampaign, i.utmContent, i.utmTerm].some(haMarkerBlackFriday)) return true;
    if (i.altriCampi?.some(haPaginaLandingBlackFriday)) return true;
    const bf = i.blackFridayListIds;
    if (!bf || bf.size === 0) return false;
    if (i.triggerListId && bf.has(String(i.triggerListId))) return true;
    if (i.activeListIds) for (const id of i.activeListIds) if (bf.has(id)) return true;
    return false;
}

/**
 * I segni BF che si leggono dai campi AC del contatto: i cinque utm e tutti i valori
 * dei campi (per la pagina/landing_url "blackfriday2026", se la landing la manda).
 */
export function segniBlackFridayDaCampi(
    fieldValues: ReadonlyArray<AcFieldValue> | null | undefined,
): AcUtmValues & { altriCampi: string[] } {
    return {
        ...readUtmFields(fieldValues),
        altriCampi: Array.isArray(fieldValues)
            ? fieldValues.map((f) => (f?.value == null ? '' : String(f.value))).filter(Boolean)
            : [],
    };
}

/**
 * Un lead BF che arriva quando il contatto ha GIA' un lead nato nelle ultime 24 ore
 * (PO 09/11/2026). Il 09/11 tre lead della landing BF (Luciani, Abiuso, Bossola)
 * avevano compilato un altro modulo poco prima: il webhook BF trovava il lead di
 * quel modulo nella finestra dei doppioni e usciva senza fare niente, e il lead
 * restava JOB SIMULATOR / TELEGRAM / CORSO 10 ORE.
 *
 * Ora il lead esistente DIVENTA BLACK FRIDAY (niente doppione) e, se e' del bot o
 * puo' diventarlo, riceve l'apertura BF (PO 09/11: "sempre l'apertura BF"):
 *  - 'gia_bf': e' gia' BLACK FRIDAY, non si fa niente (come prima);
 *  - 'push_bot': e' gia' del bot (anche con APPUNTAMENTO del bot) -> funnel BF e push
 *    al bot col funnel BF. L'apertura e l'appuntamento li governa il bot (ed8f0e8:
 *    apertura BF anche su appuntamento, appuntamento intatto; niente se sta scrivendo);
 *  - 'al_bot': aperto (NEW/IN_PROGRESS), senza appuntamento, nessun GDO l'ha
 *    chiamato nelle ultime 24 ore -> segue le regole BF: passa al bot (senza tetti)
 *    col funnel BF, che gli manda l'apertura BF;
 *  - 'solo_funnel': lavoro in mano a una persona (appuntamento fissato da un GDO,
 *    appena chiamato da un GDO) o lead chiuso: cambia solo il funnel. Mandarlo al bot
 *    aprirebbe una seconda trattativa sopra quella del GDO.
 */
export type ConversioneBf = 'gia_bf' | 'al_bot' | 'push_bot' | 'solo_funnel';

export function decidiConversioneBf(l: {
    funnel: string | null;
    status: string | null;
    appointmentDate: Date | string | null;
    callCount: number | null;
    lastCallDate: Date | string | null;
    /** L'assegnatario attuale e' il bot (la chat c'e' gia'). */
    assegnatoAlBot: boolean;
    /** Agenda mandata dal GDO: se e' recente il GDO lo sta fissando (Abiuso 09/11). */
    agendaSentAt?: Date | string | null;
}, now: Date): ConversioneBf {
    if ((l.funnel ?? '').trim().toUpperCase() === BLACK_FRIDAY_FUNNEL) return 'gia_bf';
    const aperto = l.status === 'NEW' || l.status === 'IN_PROGRESS';
    if (l.assegnatoAlBot && (aperto || l.status === 'APPOINTMENT')) return 'push_bot';
    if (!aperto || l.appointmentDate || l.assegnatoAlBot) return 'solo_funnel';
    const recente = (d: Date | string | null | undefined) =>
        !!d && !(now.getTime() - new Date(d).getTime() >= 24 * 60 * 60 * 1000);
    if ((l.callCount ?? 0) > 0 && recente(l.lastCallDate)) return 'solo_funnel';
    if (recente(l.agendaSentAt)) return 'solo_funnel';
    return 'al_bot';
}
