/**
 * Avviso (NON bloccante) sulla data scelta dal GDO per fissare un appuntamento
 * (PO 24/10/2026): dalle Conferme che chiamano la mattina stessa, si fissa per il
 * prossimo giorno lavorativo o quello dopo, dalle 10:00 alle 21:00. Le 9:00 solo
 * in emergenza. La domenica non si lavora e non conta come giorno.
 *
 * `dateStr` è il valore di un <input type="datetime-local"> ('2026-10-27T10:00'),
 * già in ora di Roma: anno/mese/giorno/ora si leggono dalla stringa, senza
 * conversioni. `now` si porta in Roma (non dipende dal fuso del browser).
 */
import { toRomeDateStr } from '../dateUtils';
import { nextWorkDayRome } from './boardWindow';

/**
 * Regola TEMPORANEA: lunedì 26/10/2026 le Conferme attaccano alle 13, quindi le
 * call del mattino non si possono confermare. Togliere dopo il 27/10 (stessa
 * regola del bot in lib/booking-slots.ts).
 */
export const MATTINE_PRENOTABILI_DAL = '2026-10-27';

export function appointmentSlotWarning(dateStr: string, now: Date): string | null {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dateStr || '');
    if (!m) return null;
    const day = m[1];
    const h = parseInt(m[2], 10) + parseInt(m[3], 10) / 60;

    const [y, mo, d] = day.split('-').map(Number);
    if (new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay() === 0) {
        return "La domenica non si fissano appuntamenti: fissa per domani o dopodomani, dalle 10:00 alle 21:00.";
    }

    const today = toRomeDateStr(now);
    if (day <= today) return "Data nel passato o per oggi: fissa per domani o dopodomani, dalle 10:00 alle 21:00.";

    const day1 = nextWorkDayRome(now);
    // Mezzogiorno UTC: il giorno di Roma coincide con quello UTC.
    const day2 = nextWorkDayRome(new Date(`${day1}T12:00:00Z`));
    if (day !== day1 && day !== day2) return "Data troppo lontana: fissa per domani o dopodomani, dalle 10:00 alle 21:00.";

    if (day < MATTINE_PRENOTABILI_DAL && h < 15) return "Lunedì 26 le Conferme attaccano alle 13: fissa dalle 15:00 alle 21:00.";

    if (h >= 10 && h <= 21) return null;
    if (h >= 9 && h < 10) return "Le 9:00 solo se il lead non può in nessun altro orario: la fascia giusta è dalle 10:00 alle 21:00.";
    return "Orario fuori finestra: l'appuntamento va dalle 10:00 alle 21:00.";
}
