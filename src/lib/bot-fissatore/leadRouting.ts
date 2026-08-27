/**
 * A chi va il prossimo lead AC Fenice: al bot fissatore o ai GDO umani.
 *
 * La regola è a ORARIO (Europe/Rome), non a cron: un job di mezzanotte può non
 * partire, partire in ritardo o partire due volte, mentre l'orologio non ha
 * stati. Ogni webhook decide da sé guardando l'istante in cui arriva.
 *
 * Calendario deciso col PO il 2026-08-27, sui volumi reali (~240 lead/giorno,
 * di cui ~150 fuori dall'orario dei GDO):
 *
 *   lun–ven  20:00 → 13:00   tutto al bot, tetto ignorato
 *   lun–ven  13:00 → 20:00   il bot ha la precedenza finché è sotto BOT_DAILY_CAP,
 *                            poi round-robin sui GDO umani
 *   sabato   10:00 → 16:30   round-robin GDO (turno del sabato), bot escluso
 *                            anche se è sotto quota: è la sola fascia in cui
 *                            gli umani vincono sempre
 *   sabato   resto           tutto al bot
 *   domenica sempre          tutto al bot
 *
 * Modulo puro: niente DB, niente rete. Testato in leadRouting.test.ts.
 * Chi lo usa resta responsabile dei fallback (bot spento, nessun GDO attivo).
 */

/** Tetto giornaliero del bot, in lead assegnati nel giorno solare Europe/Rome. */
export const BOT_DAILY_CAP = 100;

export type RoutingWindow =
    /** Solo il bot. */
    | 'bot_only'
    /** Prima il bot finché è sotto il tetto, poi i GDO umani. */
    | 'bot_first'
    /** Solo i GDO umani. */
    | 'gdo_only';

/** 'legacy' = interruttore spento, vale il round-robin storico a pool unico. */
export type LeadRouting = RoutingWindow | 'legacy';

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

/** Turno GDO del sabato, in minuti dalla mezzanotte di Roma. */
const SAT_SHIFT_START = 10 * 60;      // 10:00
const SAT_SHIFT_END = 16 * 60 + 30;   // 16:30
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
        return minutes >= SAT_SHIFT_START && minutes < SAT_SHIFT_END ? 'gdo_only' : 'bot_only';
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
