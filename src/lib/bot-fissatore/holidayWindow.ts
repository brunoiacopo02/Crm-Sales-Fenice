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

export type HolidayWindow = { from: string; until: string };

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
 *   'off'                     → spegne subito la finestra
 *   assente                   → valgono le date del codice
 *
 * Una env malformata viene IGNORATA (warn + default): una stringa scritta male
 * non deve mai far collassare l'intake dei lead.
 */
export function getConfiguredWindow(): HolidayWindow | null {
    const raw = (process.env.BOT_HOLIDAY_WINDOW || '').trim();
    if (!raw) return { from: DEFAULT_FROM, until: DEFAULT_UNTIL };
    if (OFF_VALUES.has(raw.toLowerCase())) return null;

    const [from, until] = raw.split('..').map(s => s.trim());
    if (!DATE_RE.test(from || '') || !DATE_RE.test(until || '') || from >= until) {
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
    return today >= w.from && today < w.until;
}

/**
 * Finestra da mostrare in UI, o null se non è attiva ADESSO.
 * `lastDay` è l'ultimo giorno incluso (until - 1), quello che serve al testo
 * "ferie 8–16 agosto".
 */
export function getActiveHolidayWindow(now: Date = new Date()): (HolidayWindow & { lastDay: string }) | null {
    if (!isBotHolidayWindow(now)) return null;
    const w = getConfiguredWindow()!;
    const untilDate = new Date(`${w.until}T00:00:00Z`);
    untilDate.setUTCDate(untilDate.getUTCDate() - 1);
    return { ...w, lastDay: untilDate.toISOString().slice(0, 10) };
}
