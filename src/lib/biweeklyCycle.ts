/**
 * Ciclo bisettimanale per il target "Presenze GDO".
 *
 * Ancora: lunedì 4 maggio 2026 00:00 Europe/Rome.
 * Durata: 14 giorni (lun-dom-lun-dom). `end` è exclusive (primo istante
 * del ciclo successivo), così il pattern Drizzle `gte(start) AND lt(end)`
 * non lascia buchi né duplicati ai bordi.
 *
 * Convertito in istante UTC tenendo conto dell'offset Europe/Rome per
 * non sfasare i confini di 1-2h quando il server gira in UTC (Vercel).
 */

const ANCHOR_DATE_STR = '2026-05-04'; // lun 4 mag 2026, 00:00 Rome
const CYCLE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/** Offset Europe/Rome (es. "+02:00") per la data data. */
function romeOffset(at: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset',
    }).formatToParts(at);
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    return tz.replace('GMT', '') || '+01:00';
}

/** Istante UTC del 00:00 Europe/Rome del dato YYYY-MM-DD. */
function romeMidnight(dateStr: string): Date {
    // Mezzogiorno UTC per derivare l'offset stabile (gestisce DST)
    const noon = new Date(`${dateStr}T12:00:00Z`);
    const off = romeOffset(noon);
    return new Date(`${dateStr}T00:00:00${off}`);
}

export interface BiweeklyCycle {
    /** Indice progressivo a partire dall'ancora (0, 1, 2, ...). */
    index: number;
    /** Primo istante del ciclo (lunedì 00:00 Europe/Rome). */
    start: Date;
    /** Primo istante del ciclo successivo (exclusive). */
    end: Date;
    /** Etichetta breve es. "4-17 mag" / "1-14 giu". */
    label: string;
    /** YYYY-MM-DD del primo giorno. */
    startDateStr: string;
    /** YYYY-MM-DD dell'ultimo giorno (incluso). */
    endDateStr: string;
}

const MONTHS_IT_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function romeYmd(d: Date): { y: number; m: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return { y: Number(get('year')), m: Number(get('month')), day: Number(get('day')) };
}

function formatCycleLabel(start: Date, endInclusive: Date): string {
    const s = romeYmd(start);
    const e = romeYmd(endInclusive);
    if (s.m === e.m) {
        return `${s.day}-${e.day} ${MONTHS_IT_SHORT[s.m - 1]}`;
    }
    return `${s.day} ${MONTHS_IT_SHORT[s.m - 1]} - ${e.day} ${MONTHS_IT_SHORT[e.m - 1]}`;
}

function buildCycle(index: number): BiweeklyCycle {
    const anchor = romeMidnight(ANCHOR_DATE_STR);
    const start = new Date(anchor.getTime() + index * CYCLE_DAYS * MS_PER_DAY);
    const end = new Date(start.getTime() + CYCLE_DAYS * MS_PER_DAY);
    // last day (inclusive) per la label = end - 1 giorno
    const endInclusive = new Date(end.getTime() - MS_PER_DAY);
    const sYmd = romeYmd(start);
    const eYmd = romeYmd(endInclusive);
    const startDateStr = `${sYmd.y}-${String(sYmd.m).padStart(2, '0')}-${String(sYmd.day).padStart(2, '0')}`;
    const endDateStr = `${eYmd.y}-${String(eYmd.m).padStart(2, '0')}-${String(eYmd.day).padStart(2, '0')}`;
    return {
        index,
        start,
        end,
        label: formatCycleLabel(start, endInclusive),
        startDateStr,
        endDateStr,
    };
}

/** Ciclo bisettimanale che contiene la data data. */
export function getBiweeklyCycle(at: Date = new Date()): BiweeklyCycle {
    const anchor = romeMidnight(ANCHOR_DATE_STR);
    const delta = at.getTime() - anchor.getTime();
    // Floor — anche per delta negative (date prima dell'ancora).
    const index = Math.floor(delta / (CYCLE_DAYS * MS_PER_DAY));
    return buildCycle(index);
}

/** Ciclo all'indice `i` (relativo all'ancora). */
export function getBiweeklyCycleByIndex(index: number): BiweeklyCycle {
    return buildCycle(index);
}

/**
 * Ultimi `lookback` cicli **chiusi** (escluso quello corrente),
 * dal più recente al più vecchio. Se l'ancora è nel futuro o
 * non sono ancora maturati cicli chiusi, ritorna array vuoto.
 */
export function getRecentClosedCycles(lookback: number, at: Date = new Date()): BiweeklyCycle[] {
    const current = getBiweeklyCycle(at);
    const out: BiweeklyCycle[] = [];
    for (let i = 1; i <= lookback; i++) {
        const idx = current.index - i;
        if (idx < 0) break;
        out.push(buildCycle(idx));
    }
    return out;
}
