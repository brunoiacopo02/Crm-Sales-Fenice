/**
 * Riscaldamento del numero WhatsApp nuovo: lead "immacolati" passati ai GDO che
 * tornano al bot, a scaglioni.
 *
 * Il numero storico e' a qualita' LOW; quello nuovo sta su un WABA diverso — il
 * primo ripiego vero che abbiamo, perche' quando Meta restringe un WABA blocca
 * tutti i numeri che ci stanno dentro. Ma un numero nuovo si scalda solo con
 * traffico, e il flusso ordinario da solo ci mette troppo.
 *
 * Da dove si prendono: i GDO del pool freschi hanno un tetto giornaliero, e
 * l'eccedenza va alle SCORTE. Quei lead sono nuovi di giornata e non li ha
 * ancora toccati nessuno: sono il materiale migliore per scaldare un numero, e
 * toglierli alla scorta non leva lavoro a nessuno.
 *
 * "Immacolato" e' una definizione stretta di proposito (vedi `LEAD_IMMACOLATO`):
 * un lead gia' passato dal bot che ci torna e' una seconda apertura WhatsApp
 * alla stessa persona, cioe' esattamente il comportamento che fa scendere la
 * qualita' di un numero. Quello che stiamo cercando di curare.
 *
 * A scaglioni e non tutti insieme: consegnarne 142 in un colpo e' un picco di
 * aperture indistinguibile da un blast, e su un numero senza storico e' il modo
 * piu' rapido per bruciarlo. Il 15/09 l'abbiamo gia' visto costare 3,7% di
 * messaggi falliti e la qualita' a LOW ([[flood lista 133]]).
 *
 * Modulo puro: niente DB, niente rete. Testato in riscaldamento.test.ts.
 */

/** Quanti lead spostare a ogni giro. */
export const SCAGLIONE_DEFAULT = 50;

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

export interface ConfigRiscaldamento {
    /** false = giro spento (env BOT_WARMUP=off, o assente). */
    attivo: boolean;
    /** Quanti lead per giro. */
    scaglione: number;
    /** Nome del GDO da cui prendere i lead. */
    sorgente: string;
}

/**
 * Un intero positivo da env, o il ripiego. Un valore illeggibile non deve poter
 * spostare mille lead in un colpo: nel dubbio vale il ripiego, e si logga.
 */
function interoDaEnv(nome: string, ripiego: number): number {
    const raw = process.env[nome]?.trim();
    if (!raw) return ripiego;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 500) {
        console.error(`[riscaldamento] ${nome}="${raw}" non e' un intero fra 1 e 500: uso ${ripiego}`);
        return ripiego;
    }
    return n;
}

/**
 * Acceso SOLO con BOT_WARMUP esplicitamente a 'on'/'1'.
 *
 * Al contrario delle altre finestre, qui il default e' spento: questo giro
 * toglie lead a una persona per darli al bot, e non e' una cosa che deve poter
 * partire perche' qualcuno ha dimenticato una env.
 */
export function leggiConfigRiscaldamento(): ConfigRiscaldamento {
    const raw = process.env.BOT_WARMUP?.trim().toLowerCase();
    const attivo = Boolean(raw) && !OFF_VALUES.has(raw!);
    return {
        attivo,
        scaglione: interoDaEnv('BOT_WARMUP_BATCH', SCAGLIONE_DEFAULT),
        sorgente: process.env.BOT_WARMUP_SOURCE?.trim() || 'GDO 114',
    };
}

export interface LeadCandidato {
    id: string;
    /** Il bot ha gia' avuto a che fare con questo lead? */
    toccatoDalBot: boolean;
    /** Appartiene a un'infornata anomala (es. il flood della lista 133)? */
    infornata: string | null;
    status: string;
    callCount: number;
    appointmentDate: Date | null;
    presentedAt: Date | null;
}

/**
 * Un lead e' spostabile al bot?
 *
 * Tutte e cinque le condizioni servono, e nessuna e' ridondante:
 * - mai toccato dal bot: altrimenti e' una seconda apertura alla stessa persona;
 * - fuori dalle infornate anomale: quelli sono lead database gia' decisi;
 * - mai chiamato: se un GDO ci ha gia' parlato, il bot ripartirebbe da zero
 *   dicendo cose che il lead ha gia' sentito;
 * - nessun appuntamento e nessuna presenza: un lead con una data addosso non si
 *   sposta mai, o si riscrive l'attribuzione di chi l'ha fissato.
 */
export function eImmacolato(l: LeadCandidato): boolean {
    return !l.toccatoDalBot
        && l.infornata === null
        && l.status === 'NEW'
        && l.callCount === 0
        && l.appointmentDate === null
        && l.presentedAt === null;
}

export interface PianoRiscaldamento {
    /** Gli id da spostare in questo giro. */
    daSpostare: string[];
    /** Quanti candidati restano fuori, per il giro dopo. */
    residui: number;
    motivo: 'ok' | 'spento' | 'nessun_candidato';
}

/**
 * Cosa spostare adesso. Prende i primi `scaglione` candidati immacolati.
 *
 * L'ordine lo decide il chiamante (la query li porta gia' ordinati): qui conta
 * solo che il taglio sia stabile, cosi' due giri ravvicinati non litigano sugli
 * stessi lead.
 */
export function pianificaRiscaldamento(args: {
    candidati: LeadCandidato[];
    config: ConfigRiscaldamento;
}): PianoRiscaldamento {
    const { candidati, config } = args;
    if (!config.attivo) return { daSpostare: [], residui: 0, motivo: 'spento' };

    const buoni = candidati.filter(eImmacolato);
    if (buoni.length === 0) return { daSpostare: [], residui: 0, motivo: 'nessun_candidato' };

    const daSpostare = buoni.slice(0, config.scaglione).map((l) => l.id);
    return {
        daSpostare,
        residui: Math.max(0, buoni.length - daSpostare.length),
        motivo: 'ok',
    };
}
