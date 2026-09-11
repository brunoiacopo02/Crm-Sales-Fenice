/**
 * Ciclo bisettimanale per il target "Presenze GDO".
 *
 * Durata: 14 giorni (lun-dom-lun-dom). `end` è exclusive (primo istante
 * del ciclo successivo), così il pattern Drizzle `gte(start) AND lt(end)`
 * non lascia buchi né duplicati ai bordi.
 *
 * RIALLINEAMENTO 31 AGOSTO 2026
 * -----------------------------
 * La griglia originale era ancorata a lun 4 maggio 2026 e cadeva sfalsata
 * di una settimana rispetto ai cicli con cui i bonus vengono davvero
 * contati (la "settimana 1" è quella partita lunedì 31 agosto 2026).
 * Per non riscrivere lo storico dei cicli già chiusi e pagati, la griglia
 * vecchia resta valida fino al ciclo 7 (10-23 ago) e quella corretta parte
 * dal 31 agosto (indice 8). In mezzo restano 7 giorni di raccordo
 * (24-30 ago) che NON formano un ciclo: non compaiono nello storico e non
 * maturano bonus (decisione PO, 11/09/2026).
 *
 * Gli indici restano un'unica sequenza crescente (0..7 vecchia griglia,
 * 8.. griglia riallineata), così i consumer che salvano `cycleIndex` non
 * vedono discontinuità.
 *
 * Tutti i confini sono mezzanotte Europe/Rome convertita in istante UTC,
 * per non sfasarsi di 1-2h quando il server gira in UTC (Vercel).
 */

/** Ancora della griglia storica: lun 4 mag 2026, 00:00 Rome (indici 0..7). */
const LEGACY_ANCHOR_DATE_STR = '2026-05-04';
/** Numero di cicli maturati sulla griglia storica (0..7 -> 4 mag ... 23 ago). */
const LEGACY_CYCLE_COUNT = 8;

/** Ancora della griglia riallineata: lun 31 ago 2026, 00:00 Rome (indice 8). */
const ANCHOR_DATE_STR = '2026-08-31';
/** Primo indice che usa l'ancora riallineata. */
const FIRST_REALIGNED_INDEX = LEGACY_CYCLE_COUNT;

/** Raccordo fra le due griglie: 7 giorni senza ciclo (nessun bonus). */
const BRIDGE_START_DATE_STR = '2026-08-24';
const BRIDGE_DAYS = 7;
/** Indice sentinella del raccordo: negativo, così lo storico lo salta. */
export const BRIDGE_CYCLE_INDEX = -1;

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

/** Giorno civile Europe/Rome (YYYY-MM-DD) di un istante. */
function romeDateStr(at: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
}

/**
 * Aritmetica sui giorni civili, non sui millisecondi: sommare
 * `n * 86_400_000` sfasa di un'ora i cicli a cavallo del cambio ora.
 */
function addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Giorni civili fra due YYYY-MM-DD (b - a), DST-proof. */
function daysBetween(aDateStr: string, bDateStr: string): number {
    return Math.round(
        (Date.parse(`${bDateStr}T00:00:00Z`) - Date.parse(`${aDateStr}T00:00:00Z`)) / MS_PER_DAY,
    );
}

export interface BiweeklyCycle {
    /** Indice progressivo (0..7 griglia storica, 8.. griglia riallineata). */
    index: number;
    /** Primo istante del ciclo (lunedì 00:00 Europe/Rome). */
    start: Date;
    /** Primo istante del ciclo successivo (exclusive). */
    end: Date;
    /** Etichetta breve es. "4-17 mag" / "31 ago - 13 set". */
    label: string;
    /** YYYY-MM-DD del primo giorno. */
    startDateStr: string;
    /** YYYY-MM-DD dell'ultimo giorno (incluso). */
    endDateStr: string;
    /** True solo per il raccordo 24-30 ago 2026: 7 giorni, nessun bonus. */
    isBridge?: boolean;
}

const MONTHS_IT_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function parseYmd(dateStr: string): { y: number; m: number; day: number } {
    const [y, m, day] = dateStr.split('-').map(Number);
    return { y, m, day };
}

function formatCycleLabel(startDateStr: string, endDateStr: string): string {
    const s = parseYmd(startDateStr);
    const e = parseYmd(endDateStr);
    if (s.m === e.m) {
        return `${s.day}-${e.day} ${MONTHS_IT_SHORT[s.m - 1]}`;
    }
    return `${s.day} ${MONTHS_IT_SHORT[s.m - 1]} - ${e.day} ${MONTHS_IT_SHORT[e.m - 1]}`;
}

function buildFrom(index: number, startDateStr: string, days: number): BiweeklyCycle {
    const endDateStr = addDays(startDateStr, days - 1); // ultimo giorno incluso
    return {
        index,
        start: romeMidnight(startDateStr),
        end: romeMidnight(addDays(startDateStr, days)),
        label: formatCycleLabel(startDateStr, endDateStr),
        startDateStr,
        endDateStr,
    };
}

function buildBridge(): BiweeklyCycle {
    return { ...buildFrom(BRIDGE_CYCLE_INDEX, BRIDGE_START_DATE_STR, BRIDGE_DAYS), isBridge: true };
}

/** Primo giorno del ciclo all'indice dato, scegliendo l'ancora giusta. */
function startDateStrForIndex(index: number): string {
    if (index >= FIRST_REALIGNED_INDEX) {
        return addDays(ANCHOR_DATE_STR, (index - FIRST_REALIGNED_INDEX) * CYCLE_DAYS);
    }
    return addDays(LEGACY_ANCHOR_DATE_STR, index * CYCLE_DAYS);
}

function buildCycle(index: number): BiweeklyCycle {
    if (index === BRIDGE_CYCLE_INDEX) return buildBridge();
    return buildFrom(index, startDateStrForIndex(index), CYCLE_DAYS);
}

/** Ciclo bisettimanale che contiene la data data. */
export function getBiweeklyCycle(at: Date = new Date()): BiweeklyCycle {
    const day = romeDateStr(at);

    const fromAnchor = daysBetween(ANCHOR_DATE_STR, day);
    if (fromAnchor >= 0) {
        return buildCycle(FIRST_REALIGNED_INDEX + Math.floor(fromAnchor / CYCLE_DAYS));
    }

    // 24-30 ago 2026: raccordo fra le due griglie, non è un ciclo pagabile.
    if (daysBetween(BRIDGE_START_DATE_STR, day) >= 0) return buildBridge();

    // Griglia storica. Floor anche per date prima dell'ancora (indici negativi:
    // periodo antecedente al programma, non indirizzabile per indice).
    const legacyIndex = Math.floor(daysBetween(LEGACY_ANCHOR_DATE_STR, day) / CYCLE_DAYS);
    return buildFrom(legacyIndex, startDateStrForIndex(legacyIndex), CYCLE_DAYS);
}

/** Ciclo all'indice `i`. `BRIDGE_CYCLE_INDEX` (-1) ritorna il raccordo. */
export function getBiweeklyCycleByIndex(index: number): BiweeklyCycle {
    return buildCycle(index);
}

/**
 * Ultimi `lookback` cicli **chiusi** (escluso quello corrente),
 * dal più recente al più vecchio. Il raccordo 24-30 ago è escluso per
 * costruzione: ha indice negativo e il ciclo 8 scende direttamente al 7.
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
