/**
 * Finestra ferie GDO: dall'8 al 16 agosto 2026 nessun GDO umano è al lavoro
 * (rientrano a fissare il 17), quindi tutti i lead AC Fenice in ingresso vanno
 * al bot e il suo cap giornaliero è sospeso.
 *
 * È volutamente una regola a DATA e non un cron: un job a mezzanotte può non
 * partire, partire in ritardo o partire due volte, mentre una data non ha stati.
 * La finestra si apre e si chiude da sola alla prima richiesta utile.
 *
 * Modulo puro: niente DB, niente rete. Testato in holidayWindow.test.ts.
 */

/** Estremi di default, in date solari Europe/Rome. `until` è ESCLUSO. */
const DEFAULT_FROM = '2026-08-08';
const DEFAULT_UNTIL = '2026-08-17'; // il 16 è dentro, il 17 no

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

/** `until` a null = finestra APERTA: non scade da sola, si spegne solo a mano. */
export type HolidayWindow = { from: string; until: string | null };

/** Data solare corrente in Europe/Rome come 'YYYY-MM-DD'. */
function romeDay(now: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

/**
 * Estremi configurati, o null se la finestra è disattivata.
 *
 * Override senza deploy via env BOT_HOLIDAY_WINDOW:
 *   '2026-08-08..2026-08-20'  → sposta le date (ferie allungate)
 *   '2026-09-09..'            → APERTA: nessuna scadenza, finche' non si spegne
 *   'off'                     → spegne subito la finestra
 *   assente                   → valgono le date del codice
 *
 * La forma aperta esiste perche' l'alternativa era mettere una data finta molto
 * in la': il codice si comporterebbe uguale, ma la UI prometterebbe un rientro
 * dei GDO in un giorno che nessuno ha deciso. Meglio dire che scadenza non ce
 * n'e'. Attenzione: '2026-09-09' SENZA i due punti resta malformata, cosi' una
 * data scritta a meta' non diventa per sbaglio una finestra eterna.
 *
 * Una env malformata viene IGNORATA (warn + default): una stringa scritta male
 * non deve mai far collassare l'intake dei lead.
 */
export function getConfiguredWindow(): HolidayWindow | null {
    const raw = (process.env.BOT_HOLIDAY_WINDOW || '').trim();
    if (!raw) return { from: DEFAULT_FROM, until: DEFAULT_UNTIL };
    if (OFF_VALUES.has(raw.toLowerCase())) return null;

    const punti = raw.indexOf('..');
    if (punti === -1) {
        console.warn(`[bot-fissatore] BOT_HOLIDAY_WINDOW malformata ("${raw}"): uso il default ${DEFAULT_FROM}..${DEFAULT_UNTIL}`);
        return { from: DEFAULT_FROM, until: DEFAULT_UNTIL };
    }
    const from = raw.slice(0, punti).trim();
    const untilRaw = raw.slice(punti + 2).trim();

    // until vuoto = finestra aperta. Va distinto da until malformato, che deve
    // continuare a ricadere sul default invece di diventare "per sempre".
    const until = untilRaw === '' ? null : untilRaw;

    const fromOk = DATE_RE.test(from);
    const untilOk = until === null || (DATE_RE.test(until) && from < until);
    if (!fromOk || !untilOk) {
        console.warn(`[bot-fissatore] BOT_HOLIDAY_WINDOW malformata ("${raw}"): uso il default ${DEFAULT_FROM}..${DEFAULT_UNTIL}`);
        return { from: DEFAULT_FROM, until: DEFAULT_UNTIL };
    }
    return { from, until };
}

/** True se `now` cade nella finestra ferie (confronto sulla data solare Europe/Rome). */
export function isBotHolidayWindow(now: Date = new Date()): boolean {
    const w = getConfiguredWindow();
    if (!w) return false;
    const today = romeDay(now);
    return today >= w.from && (w.until === null || today < w.until);
}

/**
 * Finestra da mostrare in UI, o null se non è attiva ADESSO.
 * `lastDay` è l'ultimo giorno incluso (until - 1), quello che serve al testo
 * "ferie 8–16 agosto" — ed è null su una finestra aperta, dove un ultimo
 * giorno non esiste e la UI non deve inventarne uno.
 */
export function getActiveHolidayWindow(now: Date = new Date()): (HolidayWindow & { lastDay: string | null }) | null {
    if (!isBotHolidayWindow(now)) return null;
    const w = getConfiguredWindow()!;
    if (w.until === null) return { ...w, lastDay: null };
    const untilDate = new Date(`${w.until}T00:00:00Z`);
    untilDate.setUTCDate(untilDate.getUTCDate() - 1);
    return { ...w, lastDay: untilDate.toISOString().slice(0, 10) };
}
