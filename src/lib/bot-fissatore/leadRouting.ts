/**
 * A chi va il prossimo lead AC Fenice: al bot fissatore o ai GDO umani.
 *
 * La regola è a ORARIO (Europe/Rome), non a cron: un job di mezzanotte può non
 * partire, partire in ritardo o partire due volte, mentre l'orologio non ha
 * stati. Ogni webhook decide da sé guardando l'istante in cui arriva.
 *
 * Calendario deciso col PO il 2026-08-27 e rivisto il 2026-08-28: il contatore
 * giornaliero del bot NON è più un tetto massimo ma una SOGLIA MINIMA. Il bot
 * deve arrivare a BOT_DAILY_MIN lead al giorno; oltre quella quota non smette
 * di ricevere, semplicemente perde la precedenza sui GDO negli orari umani.
 *
 * Ci sono tre tipi di finestra:
 *
 *   finestre del bot          tutti i lead al bot, senza alcun limite
 *     lun–ven  20:00 → 13:00
 *     sabato   00:00 → 09:00 e 16:30 → 24:00
 *     domenica tutto il giorno
 *
 *   finestra mista            i lead vanno ai GDO, TRANNE finché il bot non ha
 *     lun–ven  13:00 → 20:00  raggiunto BOT_DAILY_MIN lead nel giorno civile di
 *                             Roma: fino a quel punto la precedenza è sua
 *
 *   fascia mista del sabato   dal 17/09/2026 anche il sabato 09:00–16:30 segue
 *     sabato   09:00 → 16:30  la regola mista: il bot passa avanti finché è
 *                             sotto quota, sopra quota resta fuori. Prima era
 *                             l'unica fascia che lo escludeva a prescindere; il
 *                             PO ha chiesto che la precedenza valga SEMPRE fino
 *                             a quota, perché il bot deve scaldare il numero
 *                             nuovo e senza volume non lo scalda.
 *
 * Perché la fascia parte alle 09:00 mentre il turno del sabato comincia alle
 * 10:00: è voluto dal PO. L'ora di scarto serve a far trovare ai GDO una
 * pipeline già piena all'inizio del turno, invece di partire da zero.
 *
 * Il conteggio giornaliero non sta qui: è un predicato SQL per-account nel
 * webhook AC (`underDailyMin` in src/app/api/webhooks/activecampaign/route.ts),
 * perché deve stare nella stessa transazione dell'assegnazione.
 *
 * Modulo puro: niente DB, niente rete. Testato in leadRouting.test.ts.
 * Chi lo usa resta responsabile dei fallback (bot spento, nessun GDO attivo).
 */

/**
 * Soglia MINIMA giornaliera del bot, in lead assegnati nel giorno solare
 * Europe/Rome. Sotto questa quota il bot ha la precedenza anche negli orari
 * dei GDO; sopra, i lead degli orari umani passano ai GDO.
 */
export const BOT_DAILY_MIN = 100;

export type RoutingWindow =
    /** Finestra del bot: tutto al bot, la soglia non si applica. */
    | 'bot_only'
    /** Finestra mista: prima il bot finché è sotto la soglia minima, poi i GDO. */
    | 'bot_first'
    /** Fascia protetta: solo GDO umani, il bot è escluso anche se sotto soglia. */
    | 'gdo_only'
    /**
     * Metà e metà: il bot prende un lead solo se oggi ne ha meno della metà.
     * Tappa intermedia del rientro dopo il flood, non una fascia del calendario.
     */
    | 'bot_half';

/** 'legacy' = interruttore spento, vale il round-robin storico a pool unico. */
export type LeadRouting = RoutingWindow | 'legacy';

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

/**
 * Fascia protetta del sabato, in minuti dalla mezzanotte di Roma.
 * Parte un'ora PRIMA del turno (che comincia alle 10:00): l'ora di scarto
 * accumula lead in pipeline per i GDO che stanno per attaccare.
 */
const SAT_PROTECTED_START = 9 * 60;       // 09:00
const SAT_PROTECTED_END = 16 * 60 + 30;   // 16:30, fine turno
/** Fascia GDO dei feriali. */
const WEEKDAY_GDO_START = 13 * 60;    // 13:00
const WEEKDAY_GDO_END = 20 * 60;      // 20:00

type RomeClock = { weekday: number; minutes: number };

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Giorno della settimana e minuti dalla mezzanotte, a Roma.
 * hourCycle h23 esplicito: senza, alcune implementazioni rendono mezzanotte
 * come "24" e il confronto sui minuti salterebbe di un giorno.
 */
function romeClock(now: Date): RomeClock {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const weekday = WEEKDAY_INDEX[get('weekday')] ?? 1;
    const minutes = Number(get('hour')) * 60 + Number(get('minute'));

    return { weekday, minutes };
}

/** La finestra del calendario, senza guardare l'interruttore. */
export function resolveRoutingWindow(now: Date): RoutingWindow {
    const { weekday, minutes } = romeClock(now);

    if (weekday === 0) return 'bot_only'; // domenica

    if (weekday === 6) {
        // Anche la fascia protetta del sabato ora fa passare il bot finche' e'
        // sotto la soglia: la precedenza vale SEMPRE fino a quota (PO
        // 2026-09-17). Sopra quota il bot resta fuori, che e' il motivo per cui
        // la fascia esiste.
        return minutes >= SAT_PROTECTED_START && minutes < SAT_PROTECTED_END ? 'bot_first' : 'bot_only';
    }

    return minutes >= WEEKDAY_GDO_START && minutes < WEEKDAY_GDO_END ? 'bot_first' : 'bot_only';
}

/**
 * Legge un istante ISO da una env. Un valore illeggibile vale come env assente:
 * una finestra scritta male non deve poter cambiare il routing di nascosto.
 */
function istanteDaEnv(nome: string): number | null {
    const raw = process.env[nome]?.trim();
    if (!raw) return null;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) {
        console.error(`[leadRouting] ${nome}="${raw}" non e' una data ISO: finestra ignorata`);
        return null;
    }
    return t;
}

/**
 * Rientro graduale del bot dopo il flood della lista 133 (PO 2026-09-15).
 *
 * Il numero WhatsApp era sceso a qualita' LOW per un blocco di aperture a
 * freddo su lead database. Si riporta il bot a regime in due tappe, ognuna con
 * la sua scadenza: passata la data la finestra si spegne DA SOLA, senza che
 * nessuno debba ricordarsi di togliere una env.
 *
 *   BOT_FRESH_SUSPENDED_UNTIL  finche' non e' passata: nessun lead fresco al
 *                              bot, vanno tutti ai GDO ('gdo_only')
 *   BOT_HALF_UNTIL             finche' non e' passata: meta' e meta' ('bot_half')
 *
 * La sospensione vince sulla meta': se per errore si sovrappongono, il
 * comportamento e' quello piu' prudente per il numero.
 *
 * ATTENZIONE: queste finestre riguardano solo i lead NUOVI. Il bot continua a
 * rispondere, a gestire gli appuntamenti e a recapitare agende e video: quelli
 * sono messaggi attesi, che al rating fanno bene, non male.
 */
export function finestraRientro(now: Date): 'gdo_only' | 'bot_half' | null {
    const t = now.getTime();
    const sospesoFino = istanteDaEnv('BOT_FRESH_SUSPENDED_UNTIL');
    if (sospesoFino !== null && t < sospesoFino) return 'gdo_only';
    const metaFino = istanteDaEnv('BOT_HALF_UNTIL');
    if (metaFino !== null && t < metaFino) return 'bot_half';
    return null;
}

/**
 * La regola in vigore adesso.
 *
 * Rollback senza deploy con l'env BOT_ROUTING:
 *   'off' (o none/disabled/false/0) → 'legacy', torna il round-robin a pool unico
 *   assente o qualsiasi altro valore → vale il calendario
 *
 * Come per la finestra ferie, un valore scritto male non deve mai poter
 * spegnere l'intake: nel dubbio la regola resta attiva.
 *
 * Il rientro graduale sta DOPO il kill-switch (così BOT_ROUTING=off resta la
 * leva che riporta tutto al comportamento storico) e PRIMA del calendario,
 * perché per i giorni che copre deve vincere sulle fasce orarie.
 */
export function getLeadRouting(now: Date): LeadRouting {
    const raw = process.env.BOT_ROUTING?.trim().toLowerCase();
    if (raw && OFF_VALUES.has(raw)) return 'legacy';
    const rientro = finestraRientro(now);
    if (rientro) return rientro;
    return resolveRoutingWindow(now);
}
