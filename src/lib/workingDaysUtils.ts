/**
 * Working days calculator — Italy.
 * Weekends: only Sundays are off (Saturdays are working days).
 * Holidays: standard Italian public holidays including Easter Monday (mobile).
 */

// Computus — Meeus/Jones/Butcher algorithm for Gregorian Easter Sunday.
function easterSunday(year: number): { month: number; day: number } {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { month, day };
}

/**
 * Returns the Italian national holidays for a given year as "YYYY-MM-DD" strings.
 * Festa della Repubblica, Liberazione, Ferragosto, Natale, etc. + Pasquetta (mobile).
 */
export function getItalianHolidays(year: number): Set<string> {
    const easter = easterSunday(year);
    const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
    const pasquettaDate = new Date(easterDate.getTime() + 24 * 60 * 60 * 1000); // Monday after Easter

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

    return new Set<string>([
        fmt(year, 1, 1),   // Capodanno
        fmt(year, 1, 6),   // Epifania
        fmt(pasquettaDate.getUTCFullYear(), pasquettaDate.getUTCMonth() + 1, pasquettaDate.getUTCDate()),
        fmt(year, 4, 25),  // Festa della Liberazione
        fmt(year, 5, 1),   // Festa del Lavoro
        fmt(year, 6, 2),   // Festa della Repubblica
        fmt(year, 8, 15),  // Ferragosto
        fmt(year, 11, 1),  // Ognissanti
        fmt(year, 12, 8),  // Immacolata
        fmt(year, 12, 25), // Natale
        fmt(year, 12, 26), // Santo Stefano
    ]);
}

/** Count working days in the given month (Europe/Rome calendar). */
export function countWorkingDaysInMonth(year: number, month: number): number {
    const holidays = getItalianHolidays(year);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let count = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(Date.UTC(year, month - 1, day));
        const dow = date.getUTCDay(); // 0 = Sunday
        if (dow === 0) continue; // Sundays off
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (holidays.has(iso)) continue;
        count++;
    }
    return count;
}

/**
 * Count working days elapsed from the 1st of the given month up to and including `asOf`.
 * If `asOf` is after month end, returns the full month working days.
 * If `asOf` is before month start, returns 0.
 */
export function countWorkingDaysElapsed(year: number, month: number, asOf: Date): number {
    const holidays = getItalianHolidays(year);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Convert asOf to its Europe/Rome calendar date (YYYY-MM-DD)
    const asOfParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(asOf).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
    const asOfY = parseInt(asOfParts.year, 10);
    const asOfM = parseInt(asOfParts.month, 10);
    const asOfD = parseInt(asOfParts.day, 10);

    // If asOf month/year is before target month → 0
    if (asOfY < year || (asOfY === year && asOfM < month)) return 0;
    // If asOf month/year is after target month → full month
    const lastDay = (asOfY > year || (asOfY === year && asOfM > month)) ? daysInMonth : asOfD;

    let count = 0;
    for (let day = 1; day <= Math.min(lastDay, daysInMonth); day++) {
        const date = new Date(Date.UTC(year, month - 1, day));
        const dow = date.getUTCDay();
        if (dow === 0) continue;
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (holidays.has(iso)) continue;
        count++;
    }
    return count;
}

/** Current yearMonth ('YYYY-MM') in Europe/Rome timezone. */
export function currentYearMonthRome(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit'
    }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
    return `${parts.year}-${parts.month}`;
}

/** Parse 'YYYY-MM' into numeric year/month. */
export function parseYearMonth(yearMonth: string): { year: number; month: number } {
    const [y, m] = yearMonth.split('-').map(Number);
    return { year: y, month: m };
}
