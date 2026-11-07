/**
 * In quale colonna della board Conferme sta un appuntamento (PO 24/10/2026,
 * esteso al pomeriggio il 07/11/2026).
 *
 * Dal 27/10 le Conferme attaccano alle 9 e le call del mattino si chiamano la
 * mattina stessa. Quindi:
 * - "Oggi": tutti gli appuntamenti di oggi dalle 9 alle 21;
 * - "Domani" (era "Domani mattina", 9-14; dal 07/11 9-21, vedi sotto): gli
 *   appuntamenti del prossimo giorno lavorativo, ma
 *   solo quelli fissati (o spostati) PRIMA di oggi. Ricevono una prima chiamata
 *   il giorno prima: se il lead conferma è finita, se è NR sparisce da oggi e la
 *   seconda chiamata la fa la mattina stessa. Chi è stato fissato oggi per
 *   domani mattina si chiama direttamente domani.
 *
 * Eccezione: le 9 di domani si chiamano sempre oggi, perché alle 9 le Conferme
 * attaccano e non farebbero in tempo a chiamare prima della call.
 *
 * Dal 07/11/2026 (PO) vale lo stesso per il pomeriggio (dalle 15): una call
 * fissata almeno due giorni prima riceve la 1ª chiamata il giorno lavorativo
 * precedente e le altre due il giorno stesso; una call fissata il giorno prima
 * (o il giorno stesso) prende tutte e tre le chiamate il giorno stesso. La
 * colonna "Domani" copre quindi tutto il giorno dopo, 9-21, con un'unica regola.
 * La data di presa è la più recente fra creazione e spostamento: dopo uno
 * spostamento la data che il lead ha in testa è quella nuova, ed è dal giorno
 * dello spostamento che si misura l'anticipo.
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
export const DOMANI_ORE: readonly number[] = range(9, 21);

/** Dalle 15 è pomeriggio (stessa soglia del resto del CRM). */
export const POMERIGGIO_DALLE = 15;

export type FasciaPrimaChiamata = 'mattina' | 'pomeriggio';

/**
 * In quale gruppo della colonna "Domani · 1ª chiamata" sta una call (PO 07/11/2026):
 * le Conferme fanno tutte le prime del mattino e, se riescono, quelle del pomeriggio.
 */
export function fasciaPrimaChiamata(appointmentDate: Date): FasciaPrimaChiamata {
    return romeHour(new Date(appointmentDate)) >= POMERIGGIO_DALLE ? 'pomeriggio' : 'mattina';
}

/** Ore della colonna "Domani" divise nei due gruppi. */
export const DOMANI_ORE_MATTINA: readonly number[] = DOMANI_ORE.filter(h => h < POMERIGGIO_DALLE);
export const DOMANI_ORE_POMERIGGIO: readonly number[] = DOMANI_ORE.filter(h => h >= POMERIGGIO_DALLE);

/** Quanti lead ci sono nei due gruppi della 1ª chiamata. */
export function contaPrimeChiamate(appointmentDates: (Date | null | undefined)[]): Record<FasciaPrimaChiamata, number> {
    const out: Record<FasciaPrimaChiamata, number> = { mattina: 0, pomeriggio: 0 };
    for (const d of appointmentDates) if (d) out[fasciaPrimaChiamata(d)]++;
    return out;
}

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

/** Giorno lavorativo prima di `day` ('YYYY-MM-DD' di Roma): prima del lunedì c'è il sabato. */
export function previousWorkDayRome(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1, 12));
    if (prev.getUTCDay() === 0) prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
}

/**
 * La 1ª chiamata delle Conferme si fa il giorno lavorativo prima della call?
 * Sì se la call è stata presa (o spostata, conta la più recente) prima di quel
 * giorno. Le 9 sempre: la mattina stessa non si fa in tempo. Senza date di
 * fissaggio (righe vecchie) sì: meglio una chiamata in più che una in meno.
 */
export function primaChiamataIlGiornoPrima(
    appointmentDate: Date,
    fissaggi: (Date | null | undefined)[],
): boolean {
    const appt = new Date(appointmentDate);
    const ora = romeHour(appt);
    if (!DOMANI_ORE.includes(ora)) return false;
    if (ora === 9) return true;
    const presi = fissaggi.filter((d): d is Date => !!d).map(d => new Date(d).getTime());
    if (presi.length === 0) return true;
    const giornoPrima = previousWorkDayRome(toRomeDateStr(appt));
    return toRomeDateStr(new Date(Math.max(...presi))) < giornoPrima;
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

    // Fatta la 1ª chiamata oggi (risposto o NR), sparisce da "Domani": le altre
    // due si fanno il giorno della call, nella colonna "Oggi".
    const { start: inizioOggi } = dayBoundsRome(now);
    const chiamatoOggi = [lead.confCall1At, lead.confCall2At, lead.confCall3At]
        .some(d => d && new Date(d).getTime() >= inizioOggi.getTime());
    if (chiamatoOggi) return null;

    return primaChiamataIlGiornoPrima(appt, [lead.appointmentCreatedAt, lead.appointmentMovedAt]) ? 'domani' : null;
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
