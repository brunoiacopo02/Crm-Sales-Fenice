/**
 * Quante call ci sono già in ogni ora di un giorno, e quando un'ora è "affollata"
 * (PO 09/11/2026: martedì 10/11 alle 10:00 c'erano 19 appuntamenti su 89, il doppio
 * di qualunque altra ora; Conferme e venditori non reggono picchi così).
 *
 * Le stesse regole servono a due posti:
 * - al bot, che chiede le ore occupate a /api/bot/ore-occupate e quando propone lui
 *   un orario sceglie fra le ore meno piene;
 * - al GDO, che fissando a un'ora affollata vede un avviso (mai un blocco).
 *
 * Si contano tutti gli appuntamenti vivi del CRM, di bot e GDO: status APPOINTMENT,
 * tolti quelli già scartati dalle Conferme (quella call non si farà).
 *
 * La soglia sta in appSettings, chiave `ora_affollata_soglia` (un numero intero):
 * un'ora è affollata quando ha già almeno quel numero di appuntamenti. Senza la
 * chiave vale SOGLIA_ORA_AFFOLLATA_DEFAULT.
 */
import { toRomeDatetimeLocal } from '../dateUtils';

export const CHIAVE_SOGLIA_ORA_AFFOLLATA = 'ora_affollata_soglia';

/** 8: martedì 10/11 la media era 7,4 call per ora; dalle 8 in su l'ora è sopra la media di una giornata piena. */
export const SOGLIA_ORA_AFFOLLATA_DEFAULT = 8;

/** Ore (Roma) in cui si fissa: le 9 solo in emergenza, poi dalle 10 alle 21. */
export const ORE_APPUNTAMENTO: readonly number[] = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/** Ore che si propongono: le 9 mai (vedi appointmentSlotWarning). */
const ORE_DA_PROPORRE: readonly number[] = ORE_APPUNTAMENTO.filter((h) => h >= 10);

/** Conteggio per ora di Roma (9…21). Le ore senza call valgono 0. */
export type ContaOre = Record<number, number>;

/** La soglia scritta in appSettings, o il default se manca o non è un intero positivo. */
export function parseSogliaOraAffollata(raw: string | null | undefined): number {
    const t = (raw ?? '').trim();
    if (!/^\d+$/.test(t)) return SOGLIA_ORA_AFFOLLATA_DEFAULT;
    const n = Number(t);
    return n > 0 ? n : SOGLIA_ORA_AFFOLLATA_DEFAULT;
}

/** Il giorno e l'ora di Roma di un istante: ['2026-11-10', 10]. */
export function giornoOraRoma(at: Date): [string, number] {
    const s = toRomeDatetimeLocal(at);
    return [s.slice(0, 10), Number(s.slice(11, 13))];
}

/**
 * Conta le call per giorno e ora. Ogni giorno chiesto c'è sempre, con tutte le ore
 * dalle 9 alle 21 (anche a 0); le call fuori da quelle ore non contano.
 */
export function contaPerOra(date: readonly (Date | null)[], giorni: readonly string[]): Record<string, ContaOre> {
    const out: Record<string, ContaOre> = {};
    for (const g of giorni) {
        out[g] = Object.fromEntries(ORE_APPUNTAMENTO.map((h) => [h, 0]));
    }
    for (const d of date) {
        if (!d || isNaN(d.getTime())) continue;
        const [g, h] = giornoOraRoma(d);
        const conta = out[g];
        if (conta && h in conta) conta[h] += 1;
    }
    return out;
}

export function oraAffollata(conta: ContaOre, ora: number, soglia: number): boolean {
    return (conta[ora] ?? 0) >= soglia;
}

/**
 * Le `quante` ore meno piene fra 10 e 21, escluse `tranne`, in ordine di ora.
 * A parità vince l'ora più vicina al centro della giornata: con l'agenda vuota non si
 * ricade sulle 10, che è proprio l'ora che si riempiva.
 */
export function oreMenoPiene(conta: ContaOre, quante: number, tranne: readonly number[] = []): number[] {
    return ORE_DA_PROPORRE
        .filter((h) => !tranne.includes(h))
        .map((h) => ({ h, n: conta[h] ?? 0 }))
        .sort((a, b) => a.n - b.n || Math.abs(a.h - 15.5) - Math.abs(b.h - 15.5) || a.h - b.h)
        .slice(0, quante)
        .map((x) => x.h)
        .sort((a, b) => a - b);
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Avviso per il GDO che sta fissando `dateStr` (valore di un datetime-local, già in
 * ora di Roma): null se l'ora non è affollata. Non blocca niente: se il lead può
 * solo a quell'ora, si fissa lì.
 */
export function avvisoOraAffollata(dateStr: string, conta: ContaOre | null | undefined, soglia: number): string | null {
    const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):\d{2}/.exec(dateStr || '');
    if (!m || !conta) return null;
    const ora = Number(m[1]);
    if (!oraAffollata(conta, ora, soglia)) return null;
    const n = conta[ora] ?? 0;
    const libere = oreMenoPiene(conta, 3, [ora]).map(hh).join(', ');
    return `Alle ${hh(ora)} ci sono già ${n} appuntamenti. Se il lead può, proponi un'altra ora (più libere: ${libere}); se può solo a quell'ora, fissa pure.`;
}
