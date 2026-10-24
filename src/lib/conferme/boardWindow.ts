/**
 * In quale colonna della board Conferme sta un appuntamento (PO 24/10/2026).
 *
 * Dal 27/10 le Conferme attaccano alle 9 e le call del mattino si chiamano la
 * mattina stessa. Quindi:
 * - "Oggi": tutti gli appuntamenti di oggi dalle 9 alle 21;
 * - "Domani mattina": gli appuntamenti 9-14 del prossimo giorno lavorativo, ma
 *   solo quelli fissati (o spostati) PRIMA di oggi. Ricevono una prima chiamata
 *   il giorno prima: se il lead conferma è finita, se è NR sparisce da oggi e la
 *   seconda chiamata la fa la mattina stessa. Chi è stato fissato oggi per
 *   domani mattina si chiama direttamente domani.
 *
 * Eccezione: le 9 di domani si chiamano sempre oggi, perché alle 9 le Conferme
 * attaccano e non farebbero in tempo a chiamare prima della call.
 *
 * Pura: niente DB, `now` arriva da fuori. Tutto in ora di Roma.
 */
import { dayBoundsRome, toRomeDateStr } from '../dateUtils';

export type BoardLeadInput = {
    appointmentDate: Date | null;
    appointmentCreatedAt: Date | null;
    appointmentMovedAt: Date | null;
    confCall1At: Date | null;
    confCall2At: Date | null;
    confCall3At: Date | null;
};

export type BoardColumn = 'oggi' | 'domani' | null;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const OGGI_ORE: readonly number[] = range(9, 21);
export const DOMANI_ORE: readonly number[] = range(9, 14);

/** L'ora che legge un italiano (0-23). */
function romeHour(at: Date): number {
    return parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(at), 10) % 24;
}

/** Prossimo giorno lavorativo dopo `now`, 'YYYY-MM-DD' di Roma: la domenica non si lavora. */
export function nextWorkDayRome(now: Date): string {
    const [y, m, d] = toRomeDateStr(now).split('-').map(Number);
    // Mezzogiorno UTC: lontano da ogni mezzanotte, il giorno non slitta col fuso.
    const next = new Date(Date.UTC(y, m - 1, d + 1, 12));
    if (next.getUTCDay() === 0) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}

export function confermeBoardColumn(lead: BoardLeadInput, now: Date): BoardColumn {
    if (!lead.appointmentDate) return null;
    const appt = new Date(lead.appointmentDate);
    const giorno = toRomeDateStr(appt);
    const ora = romeHour(appt);

    if (giorno === toRomeDateStr(now)) {
        return OGGI_ORE.includes(ora) ? 'oggi' : null;
    }

    if (giorno !== nextWorkDayRome(now) || !DOMANI_ORE.includes(ora)) return null;

    const { start: inizioOggi } = dayBoundsRome(now);
    const nrOggi = [lead.confCall1At, lead.confCall2At, lead.confCall3At]
        .some(d => d && new Date(d).getTime() >= inizioOggi.getTime());
    if (nrOggi) return null;

    if (ora === 9) return 'domani';

    // Un lead senza date di fissaggio (righe vecchie) passa: meglio una chiamata
    // in più che una call del mattino che nessuno sente il giorno prima.
    const fissaggi = [lead.appointmentCreatedAt, lead.appointmentMovedAt]
        .filter((d): d is Date => !!d)
        .map(d => new Date(d).getTime());
    if (fissaggi.length === 0) return 'domani';
    return Math.max(...fissaggi) < inizioOggi.getTime() ? 'domani' : null;
}

/**
 * Il pezzo di `.set()` che timbra uno spostamento (migr. 0044): c'è quando la data nuova
 * esiste ed è diversa dalla vecchia, anche se la vecchia era null (lead parcheggiato in
 * "da definire" che riceve una data). Per la board conta come un fissaggio nuovo.
 */
export function appointmentMoveStamp(
    oldDate: Date | null | undefined,
    newDate: Date | null | undefined,
    now: Date = new Date(),
): { appointmentMovedAt?: Date } {
    if (!newDate) return {};
    if (oldDate && new Date(oldDate).getTime() === new Date(newDate).getTime()) return {};
    return { appointmentMovedAt: now };
}
