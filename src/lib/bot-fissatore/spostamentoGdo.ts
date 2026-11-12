/**
 * Il bot sposta da solo la call di un lead GDO (PO 28/10/2026, contratto v1.8, esito
 * `SPOSTAMENTO`).
 *
 * Dal 25/09 il bot non spostava più nessuna call: lo spostamento usciva come nota
 * "SPOSTAMENTO CHIESTO" e lo facevano le Conferme. Sui lead GDO la nota con la data rende
 * il 18% di confermati, quella senza il 4%, e le Conferme si sentivano dire «ho già
 * spostato col bot». Adesso, solo sui lead dei GDO, il bot fa scegliere giorno e ora al
 * lead e la data cambia davvero qui.
 *
 * Qui solo le regole, senza DB: chi le chiama porta il lead e l'ora. Tutto in ora di Roma.
 *
 * Dal 29/10/2026 (PO) vale anche per le call fissate dal bot (lead assegnato all'account
 * bot), con le stesse regole e la stessa nota. `origine` le distingue negli eventi: la
 * misura dello spostamento sui lead GDO (4/11, 11/11) non deve mescolarle.
 *
 * «IL BOT SPOSTA SEMPRE» (PO 12/11/2026; corpo e risposte dell'esito SPOSTAMENTO invariati). Dal 29/10 al 12/11: 43
 * spostamenti veri → 26% di confermati sugli esitati; 46 lead rimasti con la sola nota
 * («SPOSTAMENTO CHIESTO») → 0 presenti. Sui dati del bot il ramo più grosso della sola
 * nota era il lead già SCARTATO dalle Conferme (quasi sempre dopo le tre chiamate senza
 * risposta) che in chat chiede un altro giorno: il CRM rispondeva 409 `scartato`. Poi la
 * call già PASSATA (409 `call_passata`). Da adesso:
 * - lo scartato dalle Conferme si sposta e lo scarto si riapre (`riapreScarto`), con lo
 *   stesso CONFERME_DISCARD_RESET del rifissaggio in chat sui lead del bot: non è una
 *   policy nuova, è quella del 20/10 portata anche qui;
 * - la call passata da non più di `SPOSTAMENTO_CALL_PASSATA_MAX_GIORNI` giorni si sposta.
 *
 * Quando ancora NON si sposta (e il bot ripiega sulla nota di sempre):
 * - non c'è un appuntamento, o la call è passata da più di 60 giorni;
 * - le Conferme l'hanno confermato (c'è un venditore in calendario, l'incidente del
 *   25/09), autofissato, o parcheggiato da rifissare;
 * - si è già presentato o il venditore ha già un esito;
 * - il bot l'ha già spostato una volta: si sposta una volta sola.
 */
import { toRomeDateStr } from '../dateUtils';
import { nextWorkDayRome } from '../conferme/boardWindow';

/** Quanti giorni lavorativi avanti si può spostare (la domenica non conta). */
export const SPOSTAMENTO_GIORNI = 3;
/** Fascia ammessa, in minuti dalla mezzanotte di Roma: 9:00-21:00, estremi inclusi.
 *  Le 9 sono l'emergenza: il bot le propone mai, le accetta se il lead insiste. */
export const SPOSTAMENTO_MIN_DA = 9 * 60;
export const SPOSTAMENTO_MIN_A = 21 * 60;

/** Il trigger scritto negli eventi: serve anche a contare "una volta sola". */
export const SPOSTAMENTO_TRIGGER = 'bot_sposta_gdo';

export type SpostamentoLead = {
    status: string;
    assigneeIsBot: boolean;
    appointmentDate: Date | null;
    confirmationsOutcome: string | null;
    confNeedsReschedule: boolean;
    salespersonUserId: string | null;
    salespersonAssigned: string | null;
    salespersonOutcome: string | null;
    presentedAt: Date | null;
};

/** Di chi è la call spostata: di un GDO (bot postino) o fissata dal bot stesso. */
export type OrigineSpostamento = 'gdo' | 'bot';

export function origineSpostamento(assigneeIsBot: boolean): OrigineSpostamento {
    return assigneeIsBot ? 'bot' : 'gdo';
}

export type MotivoRifiutoSpostamento =
    | 'senza_appuntamento'
    | 'call_passata'
    | 'confermato'
    | 'esito_conferme'
    | 'parcheggiato'
    | 'gia_presentato'
    | 'gia_spostato'
    | 'data_passata'
    | 'domenica'
    | 'fuori_finestra'
    | 'fuori_fascia'
    | 'stessa_data';

export type SpostamentoCheck = { ok: true } | { ok: false; motivo: MotivoRifiutoSpostamento };

/** I giorni ('YYYY-MM-DD' di Roma) in cui si può spostare: i prossimi 3 lavorativi. */
export function giorniSpostamento(now: Date): string[] {
    const giorni: string[] = [];
    let cursore = now;
    for (let i = 0; i < SPOSTAMENTO_GIORNI; i++) {
        const g = nextWorkDayRome(cursore);
        giorni.push(g);
        // Mezzogiorno UTC: il giorno di Roma coincide con quello UTC.
        cursore = new Date(`${g}T12:00:00Z`);
    }
    return giorni;
}

function minutiRoma(at: Date): number {
    const parti = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at);
    const h = parseInt(parti.find(p => p.type === 'hour')?.value ?? '0', 10) % 24;
    const m = parseInt(parti.find(p => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
}

/**
 * Una call passata da più di così non si sposta più: è un lead vecchio, già lavorato.
 * 60 giorni e non 7 per il caso «in questi giorni non posso, riscrivo io» (PO 12/11/2026,
 * chat 25906: voleva la settimana del 23/11, tre settimane dopo): il bot non sposta, gli
 * dice di riscrivere quando sa la data e lo sposta in quel momento, anche a call ormai
 * passata. La soglia stretta la tiene il bot (`lib/gdo-spostamento.ts`): 7 giorni di
 * norma, 60 solo se il lead doveva riscrivere; lui sa quale dei due casi è, qui no.
 */
export const SPOSTAMENTO_CALL_PASSATA_MAX_GIORNI = 60;
const CALL_PASSATA_MAX_MS = SPOSTAMENTO_CALL_PASSATA_MAX_GIORNI * 24 * 60 * 60 * 1000;

/** Lo spostamento riapre uno scarto delle Conferme? (PO 12/11/2026) */
export function riapreScarto(lead: Pick<SpostamentoLead, 'confirmationsOutcome'>): boolean {
    return lead.confirmationsOutcome === 'scartato';
}

/** Il lead si può spostare dal bot? Non guarda la data nuova. */
export function checkLeadSpostabile(lead: SpostamentoLead, giaSpostato: boolean, now: Date): SpostamentoCheck {
    if (lead.status !== 'APPOINTMENT' || !lead.appointmentDate) return { ok: false, motivo: 'senza_appuntamento' };
    // Passata da poco si sposta (PO 12/11/2026): il lead l'ha saltata e chiede un altro giorno.
    if (lead.appointmentDate.getTime() < now.getTime() - CALL_PASSATA_MAX_MS) return { ok: false, motivo: 'call_passata' };
    if (lead.presentedAt || lead.salespersonOutcome) return { ok: false, motivo: 'gia_presentato' };
    // Confermato vuol dire un venditore già in calendario: lo sposta chi l'ha confermato.
    if (lead.confirmationsOutcome === 'confermato' || lead.salespersonUserId || lead.salespersonAssigned) {
        return { ok: false, motivo: 'confermato' };
    }
    // Scartato dalle Conferme: si sposta e lo scarto si riapre (vedi `riapreScarto`).
    if (lead.confirmationsOutcome && !riapreScarto(lead)) return { ok: false, motivo: 'esito_conferme' };
    if (lead.confNeedsReschedule) return { ok: false, motivo: 'parcheggiato' };
    if (giaSpostato) return { ok: false, motivo: 'gia_spostato' };
    return { ok: true };
}

/** La data nuova va bene? Prossimi 3 giorni lavorativi, 9:00-21:00, diversa dalla vecchia. */
export function checkDataSpostamento(nuova: Date, vecchia: Date | null, now: Date): SpostamentoCheck {
    if (nuova.getTime() <= now.getTime()) return { ok: false, motivo: 'data_passata' };
    if (vecchia && Math.abs(vecchia.getTime() - nuova.getTime()) < 60_000) return { ok: false, motivo: 'stessa_data' };
    const giorno = toRomeDateStr(nuova);
    if (new Date(`${giorno}T12:00:00Z`).getUTCDay() === 0) return { ok: false, motivo: 'domenica' };
    if (!giorniSpostamento(now).includes(giorno)) return { ok: false, motivo: 'fuori_finestra' };
    const minuti = minutiRoma(nuova);
    if (minuti < SPOSTAMENTO_MIN_DA || minuti > SPOSTAMENTO_MIN_A) return { ok: false, motivo: 'fuori_fascia' };
    return { ok: true };
}

/** "mar 27/10 alle 18:00": la data come la leggono le Conferme nella nota. */
export function formatSpostamento(at: Date): string {
    const giorno = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: '2-digit', month: '2-digit' }).format(at);
    const ora = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
    return `${giorno} alle ${ora}`;
}

/** La nota per la tab Note delle Conferme. */
export function notaSpostamento(vecchia: Date, nuova: Date, extra?: string | null): string {
    const base = `Spostato dal bot: da ${formatSpostamento(vecchia)} a ${formatSpostamento(nuova)}. Il lead ha scelto lui giorno e ora in chat.`;
    const coda = extra && extra.trim() ? ` ${extra.trim()}` : '';
    return `${base}${coda}`;
}
