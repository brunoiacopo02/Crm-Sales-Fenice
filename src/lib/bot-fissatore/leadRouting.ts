/**
 * A chi va il prossimo lead AC Fenice: al bot fissatore o ai GDO umani.
 *
 * La regola è a ORARIO (Europe/Rome), non a cron: un job di mezzanotte può non
 * partire, partire in ritardo o partire due volte, mentre l'orologio non ha
 * stati. Ogni webhook decide da sé guardando l'istante in cui arriva.
 *
 * Calendario deciso col PO il 2026-08-27 e rivisto il 2026-08-28: il contatore
 * giornaliero del bot NON è più un tetto massimo ma una SOGLIA MINIMA. Il bot
 * deve arrivare a BOT_DAILY_MIN lead al giorno; oltre quella quota non smette
 * di ricevere, semplicemente perde la precedenza sui GDO negli orari umani.
 *
 * Ci sono tre tipi di finestra:
 *
 *   finestre del bot          tutti i lead al bot, senza alcun limite
 *     lun–ven  20:00 → 13:00
 *     sabato   00:00 → 09:00 e 16:30 → 24:00
 *     domenica tutto il giorno
 *
 *   finestra mista            i lead vanno ai GDO, TRANNE finché il bot non ha
 *     lun–ven  13:00 → 20:00  raggiunto BOT_DAILY_MIN lead nel giorno civile di
 *                             Roma: fino a quel punto la precedenza è sua
 *
 *   fascia protetta GDO       solo umani, il bot è escluso a prescindere —
 *     sabato   09:00 → 16:30  anche se è ancora sotto BOT_DAILY_MIN. È l'unica
 *                             fascia della settimana in cui il bot non compare.
 *
 * Perché la fascia protetta parte alle 09:00 mentre il turno del sabato comincia
 * alle 10:00: è voluto dal PO. L'ora di scarto serve a far trovare ai GDO una
 * pipeline già piena all'inizio del turno, invece di partire da zero.
 *
 * Il conteggio giornaliero non sta qui: è un predicato SQL per-account nel
 * webhook AC (`underDailyMin` in src/app/api/webhooks/activecampaign/route.ts),
 * perché deve stare nella stessa transazione dell'assegnazione.
 *
 * Modulo puro: niente DB, niente rete. Testato in leadRouting.test.ts.
 * Chi lo usa resta responsabile dei fallback (bot spento, nessun GDO attivo).
 */

/**
 * Soglia MINIMA giornaliera del bot, in lead assegnati nel giorno solare
 * Europe/Rome. Sotto questa quota il bot ha la precedenza anche negli orari
 * dei GDO; sopra, i lead degli orari umani passano ai GDO.
 */
export const BOT_DAILY_MIN = 150;

export type RoutingWindow =
    /** Finestra del bot: tutto al bot, la soglia non si applica. */
    | 'bot_only'
    /** Finestra mista: prima il bot finché è sotto la soglia minima, poi i GDO. */
    | 'bot_first'
    /** Fascia protetta: solo GDO umani, il bot è escluso anche se sotto soglia. */
    | 'gdo_only';

/** 'legacy' = interruttore spento, vale il round-robin storico a pool unico. */
export type LeadRouting = RoutingWindow | 'legacy';

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

/**
 * Fascia protetta del sabato, in minuti dalla mezzanotte di Roma.
 * Parte un'ora PRIMA del turno (che comincia alle 10:00): l'ora di scarto
 * accumula lead in pipeline per i GDO che stanno per attaccare.
 */
const SAT_PROTECTED_START = 9 * 60;       // 09:00
const SAT_PROTECTED_END = 16 * 60 + 30;   // 16:30, fine turno
/** Fascia GDO dei feriali. */
const WEEKDAY_GDO_START = 13 * 60;    // 13:00
const WEEKDAY_GDO_END = 20 * 60;      // 20:00

type RomeClock = { weekday: number; minutes: number };

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Giorno della settimana e minuti dalla mezzanotte, a Roma.
 * hourCycle h23 esplicito: senza, alcune implementazioni rendono mezzanotte
 * come "24" e il confronto sui minuti salterebbe di un giorno.
 */
function romeClock(now: Date): RomeClock {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const weekday = WEEKDAY_INDEX[get('weekday')] ?? 1;
    const minutes = Number(get('hour')) * 60 + Number(get('minute'));

    return { weekday, minutes };
}

/** La finestra del calendario, senza guardare l'interruttore. */
export function resolveRoutingWindow(now: Date): RoutingWindow {
    const { weekday, minutes } = romeClock(now);

    if (weekday === 0) return 'bot_only'; // domenica

    if (weekday === 6) {
        return minutes >= SAT_PROTECTED_START && minutes < SAT_PROTECTED_END ? 'gdo_only' : 'bot_only';
    }

    return minutes >= WEEKDAY_GDO_START && minutes < WEEKDAY_GDO_END ? 'bot_first' : 'bot_only';
}

/**
 * La regola in vigore adesso.
 *
 * Rollback senza deploy con l'env BOT_ROUTING:
 *   'off' (o none/disabled/false/0) → 'legacy', torna il round-robin a pool unico
 *   assente o qualsiasi altro valore → vale il calendario
 *
 * Come per la finestra ferie, un valore scritto male non deve mai poter
 * spegnere l'intake: nel dubbio la regola resta attiva.
 */
export function getLeadRouting(now: Date): LeadRouting {
    const raw = process.env.BOT_ROUTING?.trim().toLowerCase();
    if (raw && OFF_VALUES.has(raw)) return 'legacy';
    return resolveRoutingWindow(now);
}
