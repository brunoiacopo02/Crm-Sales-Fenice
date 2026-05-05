/**
 * Date utilities — Europe/Rome esplicito.
 *
 * Sostituisce 19 ricalcoli sparsi di startOfMonth/endOfMonth/startOfDay
 * usando date-fns server-locale (UTC su Vercel) o Date.UTC(...) — entrambi
 * sfasavano il "primo giorno del mese" quando il fuso italiano e' avanti
 * di 1-2 ore rispetto a UTC. Tutti i bounds qui sono semantica
 * "calendar Europe/Rome", convertiti in istanti UTC per query Drizzle.
 *
 * Tutte le funzioni restituiscono `{ start, end }` dove:
 *   start = primo istante del periodo (inclusive)
 *   end   = primo istante del periodo successivo (exclusive)  ← uso `lt`
 *
 * Il pattern `gte(start) AND lt(end)` evita gli off-by-one millisecond.
 */

import { parseYearMonth } from "./workingDaysUtils";

/** Restituisce l'offset Europe/Rome (es. "+02:00") per la data data. */
function romeOffset(at: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset',
    }).formatToParts(at);
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const off = tz.replace('GMT', '');
    return off || '+01:00';
}

/** Date a "YYYY-MM-DD" come la legge Europe/Rome. */
export function toRomeDateStr(at: Date): string {
    return at.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

/** Bounds del giorno (Europe/Rome) contenente `at`. */
export function dayBoundsRome(at: Date): { start: Date; end: Date } {
    const dateStr = toRomeDateStr(at);
    const offset = romeOffset(at);
    const start = new Date(`${dateStr}T00:00:00${offset}`);
    // end = start del giorno successivo (exclusive)
    const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end: next };
}

/** Bounds del mese "YYYY-MM" Europe/Rome. */
export function monthBoundsRome(yearMonth: string): { start: Date; end: Date } {
    const { year, month } = parseYearMonth(yearMonth);
    // Mezzogiorno UTC del 1° → calcoliamo l'offset corretto per quel giorno
    // (gestisce DST a fine ottobre/marzo).
    const noonStart = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
    const offsetStart = romeOffset(noonStart);
    const start = new Date(`${yearMonth}-01T00:00:00${offsetStart}`);

    // End = primo giorno del mese successivo (exclusive).
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYM = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
    const noonEnd = new Date(Date.UTC(nextYear, nextMonth - 1, 1, 12, 0, 0));
    const offsetEnd = romeOffset(noonEnd);
    const end = new Date(`${nextYM}-01T00:00:00${offsetEnd}`);

    return { start, end };
}

/**
 * Bounds della settimana ISO (lun-dom) contenente `at`, Europe/Rome.
 * weekStart = lunedì 00:00, weekEnd = lunedì successivo 00:00 (exclusive).
 */
export function weekBoundsRome(at: Date): { start: Date; end: Date } {
    const dateStr = toRomeDateStr(at);
    const offset = romeOffset(at);
    // Mezzogiorno locale del giorno per derivare il weekday Rome
    const noon = new Date(`${dateStr}T12:00:00${offset}`);
    // getUTCDay sull'istante UTC del mezzogiorno Rome ≈ getDay() di Rome
    const dow = (noon.getUTCDay() + 6) % 7; // lun=0, mar=1, ..., dom=6
    const monday = new Date(noon.getTime() - dow * 24 * 60 * 60 * 1000);
    const mondayStr = toRomeDateStr(monday);
    const start = new Date(`${mondayStr}T00:00:00${offset}`);
    const nextMonday = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start, end: nextMonday };
}

/** "YYYY-MM" del mese precedente rispetto al given. */
export function previousYearMonth(yearMonth: string): string {
    const { year, month } = parseYearMonth(yearMonth);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/** "YYYY-MM" del mese successivo rispetto al given. */
export function nextYearMonth(yearMonth: string): string {
    const { year, month } = parseYearMonth(yearMonth);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}
