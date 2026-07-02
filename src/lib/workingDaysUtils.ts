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

/**
 * Count working days in [start, end] inclusive — Europe/Rome calendar.
 * Sundays off + Italian national holidays (incluso Pasquetta).
 * `start` and `end` are absolute timestamps; the date in Europe/Rome is what counts.
 */
export function workingDaysBetween(start: Date, end: Date): number {
    if (end.getTime() < start.getTime()) return 0;

    // Convert to Europe/Rome calendar dates (YYYY-MM-DD strings) to avoid TZ drift.
    const toRomeDate = (d: Date): { y: number; m: number; day: number } => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
        return { y: parseInt(parts.year, 10), m: parseInt(parts.month, 10), day: parseInt(parts.day, 10) };
    };

    const a = toRomeDate(start);
    const b = toRomeDate(end);

    // Build a calendar cursor in UTC matching Rome local date — same trick used elsewhere in this file.
    const cursor = new Date(Date.UTC(a.y, a.m - 1, a.day));
    const endDate = new Date(Date.UTC(b.y, b.m - 1, b.day));

    let count = 0;
    const holidaysByYear = new Map<number, Set<string>>();

    while (cursor.getTime() <= endDate.getTime()) {
        const y = cursor.getUTCFullYear();
        const m = cursor.getUTCMonth() + 1;
        const d = cursor.getUTCDate();
        const dow = cursor.getUTCDay(); // 0 = Sunday

        if (dow !== 0) {
            if (!holidaysByYear.has(y)) holidaysByYear.set(y, getItalianHolidays(y));
            const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (!holidaysByYear.get(y)!.has(iso)) count++;
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
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

/**
 * 'YYYY-MM-DD' del lunedì della settimana corrente in Europe/Rome.
 *
 * NOTA: non importa `weekBoundsRome` da `@/lib/dateUtils` di proposito —
 * `dateUtils.ts` importa già `parseYearMonth` da questo file, quindi un
 * import inverso creerebbe un ciclo. La logica di calendario Rome è
 * reimplementata qui con lo stesso pattern (Intl formatToParts) usato dalle
 * altre funzioni di questo file.
 */
export function currentWeekStartRome(d: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
    const y = parseInt(parts.year, 10);
    const m = parseInt(parts.month, 10);
    const day = parseInt(parts.day, 10);
    const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const dow = weekdayIndex[parts.weekday] ?? 0;

    // Cursore in UTC che rappresenta la data-calendario Rome (stesso trucco
    // usato in workingDaysBetween) — sottrarre `dow` giorni porta al lunedì.
    const cursor = new Date(Date.UTC(y, m - 1, day));
    cursor.setUTCDate(cursor.getUTCDate() - dow);

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
}
