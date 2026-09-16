import { isLeadLocked } from './contactRequests';
import { LANCIO_BUCKET } from '@/lib/lancio/intake';

/**
 * Ritorno al pool dei lead del lancio Web Developer AI (spec §4.6). Modulo puro:
 * niente DB. `NON_RISPOSTO`/`INTERROTTO` dal bot su un lead del bucket assegnato al
 * bot non fanno round robin verso un GDO ma lo rimettono nel pool di /import, da
 * cui gli admin lo distribuiscono come per Black Summer.
 */

/**
 * Il bucket è quello dell'intake del lancio, non una copia: due costanti con lo
 * stesso valore restano allineate finché qualcuno non rinomina il bucket da una
 * parte sola, e quel giorno i lead smetterebbero di tornare nel pool in silenzio.
 */
export const LANCIO_WEBDEV_BUCKET = LANCIO_BUCKET;

export type LancioReturnMotivo = 'mai_risposto' | 'silenzio_dopo_followup' | 'followup_non_inviato';

/**
 * Il motivo lo dice la nota del bot ("Lancio: mai risposto" / "Lancio: silenzio dopo
 * il follow-up" / "Lancio: follow-up non inviato", spec §5.8 + nota di
 * riconciliazione). Senza nota riconoscibile: NON_RISPOSTO = mai risposto,
 * INTERROTTO = ha interagito e poi è sparito, cioè silenzio.
 *
 * `followup_non_inviato` è un caso a parte e va letto per primo: non è il lead
 * che tace, è il follow-up che non è mai partito. Confonderlo con il silenzio
 * farebbe sembrare freddo un lead a cui non abbiamo mai riscritto.
 */
export function motivoRestituzioneDaNota(
    note: string | null | undefined,
    outcome: 'NON_RISPOSTO' | 'INTERROTTO',
): LancioReturnMotivo {
    const t = (note ?? '').toLowerCase();
    if (/follow-?up non inviato/.test(t)) return 'followup_non_inviato';
    if (/silenzio dopo il follow-?up/.test(t)) return 'silenzio_dopo_followup';
    if (/mai risposto/.test(t)) return 'mai_risposto';
    return outcome === 'INTERROTTO' ? 'silenzio_dopo_followup' : 'mai_risposto';
}

export type LancioReturnLead = {
    launchBucket: string | null;
    assigneeIsBot: boolean;
    status: string;
    presentedAt: Date | null;
    appointmentDate: Date | null;
    /** `chiamata_subito | app_mattina | app_pomeriggio | app_dopodomani | followup` (spec §3.1). */
    lancioScelta?: string | null;
};

export type LancioReturnCheck =
    | { ok: true }
    | { ok: false; reason: 'not_lancio' | 'not_bot' | 'already_rejected' | 'locked_appointment' | 'scelta_fatta' };

/**
 * Guardie, nell'ordine: appartenenza al lancio e al bot; REJECTED (una decisione
 * presa non si annulla, come in reassign.ts); `isLeadLocked` + `appointmentDate`
 * (un lead con una call in agenda o una presenza non torna mai nel pool);
 * `lancioScelta` (ha scelto la sera del 5: è di un venditore o delle Conferme).
 *
 * `not_lancio` è la PRIMA guardia di proposito: tutto il resto del CRM — i lead
 * del bot ordinario compresi — deve uscire di qui senza che nessun altro
 * controllo entri in gioco, e continuare sulla strada di sempre (round robin
 * verso un GDO umano in `reassignBotLeadToHumanPool`).
 */
export function checkLancioReturnToPool(l: LancioReturnLead): LancioReturnCheck {
    if (l.launchBucket !== LANCIO_WEBDEV_BUCKET) return { ok: false, reason: 'not_lancio' };
    if (!l.assigneeIsBot) return { ok: false, reason: 'not_bot' };
    if (l.status === 'REJECTED') return { ok: false, reason: 'already_rejected' };
    if (isLeadLocked(l.status, l.presentedAt) || l.appointmentDate !== null) {
        return { ok: false, reason: 'locked_appointment' };
    }
    // Vicolo cieco VOLUTO: un lead che ha scelto e' di un venditore o delle Conferme,
    // e non torna nel pool nemmeno se il bot ci riprova all'infinito — `scelta_fatta`
    // e' una risposta stabile, non uno stato transitorio da ritentare.
    if (l.lancioScelta) return { ok: false, reason: 'scelta_fatta' };
    return { ok: true };
}

export type LancioAlreadyReturnedLead = {
    launchBucket: string | null;
    assignedToId: string | null;
    status: string;
};

/**
 * Vale la pena pagare la query sull'evento `LANCIO_RETURNED_TO_POOL`?
 *
 * Separata da `isAlreadyReturned` solo per questo: la firma del lead che si
 * legge gratis dal route sta qui, l'evento costa un SELECT e si legge soltanto
 * quando tutto il resto combacia gia'. Cosi' la condizione non e' scritta due
 * volte — nel route e nel modulo puro — con il rischio che una delle due cambi.
 */
export function needsReturnEventCheck(
    l: LancioAlreadyReturnedLead,
    outcome: string,
): boolean {
    if (outcome !== 'NON_RISPOSTO' && outcome !== 'INTERROTTO') return false;
    if (l.launchBucket !== LANCIO_WEBDEV_BUCKET) return false;
    if (l.assignedToId !== null) return false;
    return l.status === 'NEW';
}

/**
 * Il lead del lancio e' GIA' tornato nel pool: questo esito e' un doppione.
 *
 * Serve perche' il ritorno al pool toglie l'assegnatario, e un lead senza
 * assegnatario non supera piu' il controllo di appartenenza del route: il
 * secondo tentativo del bot si prenderebbe un 403 «lead non assegnato a un
 * account bot», che e' falso e per giunta fuorviante — il lead al bot c'e'
 * stato, e il lavoro e' stato fatto. Il cron `lancio-restituzioni` segna
 * `restituito` solo dopo una risposta positiva del CRM: con il 403 ritenterebbe
 * ogni ora per sempre. Qui la risposta e' 200 e non si scrive niente.
 */
export function isAlreadyReturned(
    l: LancioAlreadyReturnedLead & { hasReturnEvent: boolean },
    outcome: string,
): boolean {
    return needsReturnEventCheck(l, outcome) && l.hasReturnEvent;
}
