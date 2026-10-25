// Calendario della citazione del giorno (PO 25/10/2026): giorni lavorativi
// (lun-sab, feste italiane e chiusure dell'ufficio escluse) e occasioni a cui
// legare le citazioni a tema. Solo funzioni pure su date 'YYYY-MM-DD', cioè
// giorni del calendario di Roma: niente orari, niente fusi.

import { easterSunday, getItalianHolidays } from '../workingDaysUtils'

export type DayStr = string

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

function toUtc(day: DayStr): Date {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(d: Date): DayStr {
    return d.toISOString().slice(0, 10)
}

/** true solo per date esistenti nel formato 'YYYY-MM-DD' (scarta 2026-13-01, 2026-02-30). */
export function isValidDay(s: unknown): s is DayStr {
    return typeof s === 'string' && DAY_RE.test(s) && fromUtc(toUtc(s)) === s
}

export function addDays(day: DayStr, n: number): DayStr {
    const d = toUtc(day)
    d.setUTCDate(d.getUTCDate() + n)
    return fromUtc(d)
}

/** Stesso giorno N mesi dopo; se quel mese è più corto si ferma all'ultimo giorno. */
export function addMonths(day: DayStr, n: number): DayStr {
    const [y, m, d] = day.split('-').map(Number)
    const total = y * 12 + (m - 1) + n
    const ny = Math.floor(total / 12)
    const nm = total - ny * 12
    const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
    return fromUtc(new Date(Date.UTC(ny, nm, Math.min(d, lastDay))))
}

/** 0 = domenica … 6 = sabato. */
export function weekdayOf(day: DayStr): number {
    return toUtc(day).getUTCDay()
}

/** Domenica di Pasqua (algoritmo di Gauss/Meeus, calendario gregoriano). */
export function easterDay(year: number): DayStr {
    const e = easterSunday(year)
    return `${year}-${pad(e.month)}-${pad(e.day)}`
}

const holidaysByYear = new Map<number, Set<string>>()

/** Feste nazionali: 1/1, 6/1, Pasqua e Pasquetta, 25/4, 1/5, 2/6, 15/8, 1/11, 8/12, 25/12, 26/12. */
function holidays(year: number): Set<string> {
    let set = holidaysByYear.get(year)
    if (!set) {
        set = new Set(getItalianHolidays(year))
        set.add(easterDay(year))   // sempre domenica, la mettiamo per completezza
        holidaysByYear.set(year, set)
    }
    return set
}

export function isWorkingDay(day: DayStr, closed?: ReadonlySet<string>): boolean {
    if (weekdayOf(day) === 0) return false
    if (holidays(Number(day.slice(0, 4))).has(day)) return false
    return !closed?.has(day)
}

/** Giorni lavorativi da `from` a `to` compresi, in ordine. */
export function workingDaysInRange(from: DayStr, to: DayStr, closed?: ReadonlySet<string>): DayStr[] {
    const out: DayStr[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
        if (isWorkingDay(d, closed)) out.push(d)
    }
    return out
}

function firstWorkingDayFrom(day: DayStr, closed?: ReadonlySet<string>): DayStr {
    let d = day
    while (!isWorkingDay(d, closed)) d = addDays(d, 1)
    return d
}

function nextWorkingDay(day: DayStr, closed?: ReadonlySet<string>): DayStr {
    return firstWorkingDayFrom(addDays(day, 1), closed)
}

function prevWorkingDay(day: DayStr, closed?: ReadonlySet<string>): DayStr {
    let d = addDays(day, -1)
    while (!isWorkingDay(d, closed)) d = addDays(d, -1)
    return d
}

/** Chiusure dell'ufficio salvate come JSON (array di date); il resto si scarta. */
export function parseClosedDays(raw: string | null | undefined): DayStr[] {
    if (!raw) return []
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return [...new Set(parsed.filter(isValidDay))].sort()
    } catch {
        return []
    }
}

// ── Occasioni ──

/** Occasioni "forti": le citazioni che le portano si usano solo lì. */
export const STRONG_OCCASIONS = [
    'natale', 'fine_anno', 'inizio_anno', 'rinascita',
    'festa_lavoro', 'liberazione', 'repubblica', 'ferie', 'rientro',
] as const
export const SEASONS = ['primavera', 'estate', 'autunno', 'inverno'] as const
/** Occasioni "deboli": una preferenza, non un vincolo. */
export const WEAK_OCCASIONS = ['lunedi', 'sabato', ...SEASONS] as const
export const KNOWN_OCCASIONS: ReadonlySet<string> = new Set<string>([...STRONG_OCCASIONS, ...WEAK_OCCASIONS])

const STRONG_SET: ReadonlySet<string> = new Set<string>(STRONG_OCCASIONS)
export function isStrongOccasion(o: string): boolean {
    return STRONG_SET.has(o)
}

export type Season = typeof SEASONS[number]

/** Stagione astronomica approssimata a date fisse (21/3, 21/6, 23/9, 21/12). */
export function seasonOf(day: DayStr): Season {
    const md = day.slice(5)
    if (md >= '03-21' && md < '06-21') return 'primavera'
    if (md >= '06-21' && md < '09-23') return 'estate'
    if (md >= '09-23' && md < '12-21') return 'autunno'
    return 'inverno'
}

export interface OccasionSlot {
    occasion: string
    /** Peso relativo nel periodo: più alto = più probabile che quel giorno abbia la citazione a tema. */
    weight: number
    /** Giorno simbolo (es. primo giorno lavorativo dell'anno): la citazione a tema ci va sempre, se c'è. */
    must: boolean
    strong: boolean
}

/**
 * Occasioni di ciascun giorno lavorativo di `days`.
 * - natale: 1-24/12, con peso che cresce verso la vigilia;
 * - fine_anno: 27-31/12;
 * - inizio_anno: primo giorno lavorativo di gennaio e quello dopo l'Epifania;
 * - rinascita: le due settimane prima di Pasqua (peso crescente) e il primo giorno lavorativo dopo;
 * - liberazione, festa_lavoro, repubblica: l'ultimo giorno lavorativo prima della festa;
 * - ferie: la settimana prima di Ferragosto;
 * - rientro: il primo giorno lavorativo dopo Ferragosto e le prime due settimane di settembre;
 * - lunedi, sabato e stagioni: deboli, su ogni giorno che corrisponde.
 */
export function occasionCalendar(days: readonly DayStr[], closed?: ReadonlySet<string>): Map<DayStr, OccasionSlot[]> {
    const cal = new Map<DayStr, OccasionSlot[]>()
    if (days.length === 0) return cal
    const inRange = new Set(days)

    const put = (day: DayStr, occasion: string, weight: number, must: boolean) => {
        if (!inRange.has(day)) return
        const slots = cal.get(day) ?? []
        const same = slots.find(s => s.occasion === occasion)
        if (same) {
            same.weight = Math.max(same.weight, weight)
            same.must = same.must || must
        } else {
            slots.push({ occasion, weight, must, strong: isStrongOccasion(occasion) })
        }
        cal.set(day, slots)
    }
    // Rampa da 1 a 4 sui giorni di calendario del periodo.
    const ramp = (from: DayStr, to: DayStr, occasion: string) => {
        const span = (toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000
        for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
            put(d, occasion, 1 + 3 * (span > 0 ? i / span : 1), false)
        }
    }
    const flat = (from: DayStr, to: DayStr, occasion: string) => {
        for (let d = from; d <= to; d = addDays(d, 1)) put(d, occasion, 1, false)
    }

    const firstYear = Number(days[0].slice(0, 4))
    const lastYear = Number(days[days.length - 1].slice(0, 4))
    for (let y = firstYear; y <= lastYear; y++) {
        ramp(`${y}-12-01`, `${y}-12-24`, 'natale')
        flat(`${y}-12-27`, `${y}-12-31`, 'fine_anno')
        put(firstWorkingDayFrom(`${y}-01-01`, closed), 'inizio_anno', 1, true)
        put(nextWorkingDay(`${y}-01-06`, closed), 'inizio_anno', 1, true)
        const easter = easterDay(y)
        ramp(addDays(easter, -14), addDays(easter, -1), 'rinascita')
        put(nextWorkingDay(easter, closed), 'rinascita', 1, true)
        put(prevWorkingDay(`${y}-04-25`, closed), 'liberazione', 1, true)
        put(prevWorkingDay(`${y}-05-01`, closed), 'festa_lavoro', 1, true)
        put(prevWorkingDay(`${y}-06-02`, closed), 'repubblica', 1, true)
        flat(`${y}-08-08`, `${y}-08-14`, 'ferie')
        put(nextWorkingDay(`${y}-08-15`, closed), 'rientro', 1, true)
        flat(`${y}-09-01`, `${y}-09-14`, 'rientro')
    }

    for (const d of days) {
        const wd = weekdayOf(d)
        if (wd === 1) put(d, 'lunedi', 1, false)
        if (wd === 6) put(d, 'sabato', 1, false)
        put(d, seasonOf(d), 1, false)
    }
    return cal
}
