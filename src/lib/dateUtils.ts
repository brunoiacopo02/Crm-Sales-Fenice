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
export function romeOffset(at: Date): string {
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

/**
 * ISO 8601 con offset Europe/Rome esplicito — es. '2026-07-31T15:00:00+02:00'.
 *
 * È il formato che il fornitore bot già pretende da noi in ingresso su
 * /api/bot/outcome ("date deve includere il fuso orario"), quindi lo usiamo
 * anche in uscita: `Z` sarebbe altrettanto non ambiguo, ma con l'offset locale
 * l'ora dell'appuntamento si legge a occhio nei log di entrambe le parti.
 */
export function toRomeIso(at: Date): string {
    return `${toRomeDatetimeLocal(at)}:00${romeOffset(at)}`;
}

/**
 * Data/ora in italiano, pronta da inserire in un messaggio al lead —
 * es. 'venerdì 31 luglio alle 15:00'.
 *
 * Serve a chi riceve l'appuntamento da noi (il bot) per non doverlo
 * riformattare: è lì che storicamente nascono gli orari sfalsati di un'ora.
 */
export function formatRomeAppointmentLabel(at: Date): string {
    const d = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        weekday: 'long', day: 'numeric', month: 'long',
    }).format(at);
    const h = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at);
    return `${d} alle ${h}`;
}

/**
 * Mezzanotte Europe/Rome del giorno (y, m, d), con `d` che può sforare il mese
 * (Date.UTC normalizza: 2026-10-32 → 2026-11-01).
 *
 * Due passaggi, e servono entrambi. Il primo usa l'offset di MEZZOGIORNO del
 * giorno di destinazione (come `monthBoundsRome`): mezzogiorno non cade mai
 * dentro un salto d'ora, quindi dà sempre un istante nel giorno giusto. Ma nei
 * giorni di cambio ora mezzanotte e mezzogiorno hanno offset DIVERSI — il
 * 25/10/2026 mezzanotte è +02:00 e mezzogiorno è già +01:00 — quindi il
 * secondo passaggio rilegge l'offset all'istante trovato e ricalcola. Da lì in
 * poi è stabile: il risultato è la mezzanotte vera di quel giorno.
 */
function romeMidnight(y: number, m: number, d: number): Date {
    const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dateStr = noon.toISOString().slice(0, 10);
    const primoTentativo = new Date(`${dateStr}T00:00:00${romeOffset(noon)}`);
    return new Date(`${dateStr}T00:00:00${romeOffset(primoTentativo)}`);
}

/**
 * Bounds del giorno (Europe/Rome) contenente `at`.
 *
 * Fix 2026-09-19 (cambi d'ora): prima l'offset veniva preso dall'ISTANTE `at` e
 * applicato alla mezzanotte del giorno di destinazione, e la fine era
 * `start + 24h`. Nei due weekend di cambio ora sbagliava di un'ora:
 *  - 29/03/2026 (giorno da 23h): la mezzanotte è ancora +01:00, ma un `at`
 *    pomeridiano è già +02:00 → lo start partiva un'ora prima;
 *  - 25/10/2026 (giorno da 25h): la mezzanotte è +02:00 e un `at` pomeridiano
 *    è +01:00 → lo start partiva un'ora dopo, e con `at` prima delle 03:00 era
 *    la fine a cadere un'ora prima.
 * Ora entrambi gli estremi sono mezzanotti vere di Roma, ciascuna col proprio
 * offset: il giorno dura 23h o 25h quando deve.
 */
export function dayBoundsRome(at: Date): { start: Date; end: Date } {
    const [y, m, d] = toRomeDateStr(at).split('-').map(Number);
    // end = mezzanotte del giorno successivo (exclusive)
    return { start: romeMidnight(y, m, d), end: romeMidnight(y, m, d + 1) };
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
    // Mezzogiorno locale del giorno per derivare il weekday Rome. Qui l'offset
    // di `at` va benissimo: un'ora di scarto non sposta mezzogiorno di giorno.
    const noon = new Date(`${dateStr}T12:00:00${romeOffset(at)}`);
    // getUTCDay sull'istante UTC del mezzogiorno Rome ≈ getDay() di Rome
    const dow = (noon.getUTCDay() + 6) % 7; // lun=0, mar=1, ..., dom=6
    const mondayStr = toRomeDateStr(new Date(noon.getTime() - dow * 24 * 60 * 60 * 1000));
    const [y, m, d] = mondayStr.split('-').map(Number);
    // Stesso fix di dayBoundsRome (2026-09-19): gli estremi sono mezzanotti
    // vere di Roma, non "lunedì + 7 giorni esatti". Nella settimana del cambio
    // ora il vecchio calcolo chiudeva la settimana un'ora prima o un'ora dopo.
    return { start: romeMidnight(y, m, d), end: romeMidnight(y, m, d + 7) };
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

/**
 * Parsa il valore di `<input type="datetime-local">` (formato 'YYYY-MM-DDTHH:MM'
 * oppure 'YYYY-MM-DDTHH:MM:SS') interpretandolo SEMPRE come Europe/Rome.
 *
 * Senza questo wrapper, `new Date(s)` su quel formato e' parsato in browser
 * local timezone, che funziona per chi e' in Italia ma diverge per server
 * UTC e per chi sta connettendosi da un'altra TZ. Allineamento esplicito
 * a Europe/Rome elimina l'ambiguita' (es. chiusura registrata sabato 23:00
 * non finisce nella settimana sbagliata).
 */
export function parseRomeDatetimeLocal(s: string | null | undefined): Date | null {
    if (!s) return null;
    // Normalizza al formato 'YYYY-MM-DDTHH:MM:SS'
    let normalized = s.length === 16 ? `${s}:00` : s;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
        // formato non riconosciuto — fallback al parsing nativo
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    // Calcola l'offset Europe/Rome per il giorno indicato (gestisce DST)
    const dateOnly = normalized.slice(0, 10);
    const noonProbe = new Date(`${dateOnly}T12:00:00Z`);
    const offset = romeOffset(noonProbe);
    return new Date(`${normalized}${offset}`);
}

/**
 * Format inverso: prende un Date e restituisce 'YYYY-MM-DDTHH:MM' interpretato
 * in Europe/Rome — utile per pre-popolare un `<input type="datetime-local">`.
 */
export function toRomeDatetimeLocal(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
