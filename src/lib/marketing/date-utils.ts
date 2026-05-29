// src/lib/marketing/date-utils.ts
// Date helpers specifici per il porting dal marketing CRM. Solo le funzioni
// NON presenti in src/lib/dateUtils.ts. Per i bounds Europe/Rome (weekBoundsRome,
// monthBoundsRome, etc.) usare direttamente `@/lib/dateUtils`.

// "Today" anchored to Europe/Rome — matches the timezone the dashboard users live in.
// A day is considered consolidated (and therefore cacheable) once it's no longer "today" in Rome.
export function todayInRome(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

// Iterate dates inclusive [from, to] as YYYY-MM-DD strings. Uses UTC math but the result is
// just calendar dates, so DST changes don't affect the output.
export function* dateRange(from: string, to: string): Generator<string> {
    const start = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        yield d.toISOString().slice(0, 10);
    }
}

// ISO 8601 week: lunedì è il primo giorno, week 1 contiene il primo giovedì dell'anno.
export function isoWeek(dateStr: string): { year: number; week: number; from: string; to: string } {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - day);
    const year = thursday.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const firstMonday = new Date(jan4);
    firstMonday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    const diffDays = Math.round((thursday.getTime() - firstMonday.getTime()) / 86_400_000);
    const week = Math.floor(diffDays / 7) + 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
        year,
        week,
        from: monday.toISOString().slice(0, 10),
        to: sunday.toISOString().slice(0, 10),
    };
}

export interface IsoWeekWindow {
    iso: string;
    from: string;
    to: string;
    isCurrent: boolean;
}

// Ultime N settimane ISO terminanti in (e inclusa) la settimana di `anchor`.
// Per la settimana corrente, `to` viene capped a `anchor` stesso (non a domenica futura).
export function lastNIsoWeeks(n: number, anchor: string): IsoWeekWindow[] {
    const cur = isoWeek(anchor);
    const mondayCur = new Date(cur.from + 'T00:00:00Z');
    const out: IsoWeekWindow[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const monday = new Date(mondayCur);
        monday.setUTCDate(mondayCur.getUTCDate() - i * 7);
        const wk = isoWeek(monday.toISOString().slice(0, 10));
        const isCurrent = i === 0;
        out.push({
            iso: `${wk.year}-W${String(wk.week).padStart(2, '0')}`,
            from: wk.from,
            to: isCurrent ? anchor : wk.to,
            isCurrent,
        });
    }
    return out;
}
