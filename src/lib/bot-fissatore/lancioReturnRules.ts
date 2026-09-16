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
    if (l.lancioScelta) return { ok: false, reason: 'scelta_fatta' };
    return { ok: true };
}
