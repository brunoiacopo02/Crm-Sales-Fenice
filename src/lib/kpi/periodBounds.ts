import { dayBoundsRome, monthBoundsRome, weekBoundsRome, toRomeDateStr } from '@/lib/dateUtils';

export type OperativaPeriod = 'OGGI' | 'MESE' | 'TRIMESTRE';
export type LeaderboardPeriodKey = 'today' | 'week' | 'month';

/** Giorni indietro coperti dal periodo TRIMESTRE (oltre a oggi). */
const TRIMESTRE_GIORNI = 90;

/**
 * Bounds Europe/Rome del periodo di /operativa-team.
 *
 * Prima erano calcolati con `new Date()` + `setHours(0,0,0,0)`, cioe' nel
 * fuso del server: su Vercel (UTC) il "1° del mese" cadeva alle 02:00
 * italiane, quindi le prime due ore di ogni mese finivano nel mese
 * precedente e le ultime due sconfinavano in quello dopo. Stessa classe di
 * bug che `src/lib/dateUtils.ts` ha gia' chiuso altrove.
 *
 * `end` e' sempre **esclusivo**: usare `lt(end)`, non `lte`.
 */
export function operativaPeriodBounds(
    period: OperativaPeriod,
    now: Date = new Date(),
): { start: Date; end: Date } {
    const oggi = dayBoundsRome(now);

    if (period === 'OGGI') return oggi;

    if (period === 'MESE') {
        return monthBoundsRome(toRomeDateStr(now).slice(0, 7));
    }

    // TRIMESTRE: 90 giorni indietro + oggi. Il giorno di partenza si ricava
    // riportando indietro l'istante e ricalcolandone i bounds, cosi' il
    // cambio di ora legale nel mezzo non sposta la mezzanotte.
    const inizio = dayBoundsRome(new Date(now.getTime() - TRIMESTRE_GIORNI * 86_400_000));
    return { start: inizio.start, end: oggi.end };
}

/**
 * Bounds Europe/Rome delle classifiche (oggi / settimana ISO lun-dom / mese).
 *
 * Lo stesso blocco era ricopiato quattro volte in `leaderboardActions.ts`
 * su `date-fns` in fuso server, sotto il commento "assuming timezone offset
 * is already correctly handled": non lo era. La settimana e' lun-dom
 * italiana, non lun-dom UTC.
 *
 * `end` e' **esclusivo**: usare `lt(end)`, non `lte`.
 */
export function leaderboardPeriodBounds(
    period: LeaderboardPeriodKey,
    now: Date = new Date(),
): { start: Date; end: Date } {
    if (period === 'today') return dayBoundsRome(now);
    if (period === 'week') return weekBoundsRome(now);
    return monthBoundsRome(toRomeDateStr(now).slice(0, 7));
}
