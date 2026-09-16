/**
 * Interruttore di sovraccarico sull'ingresso lead da ActiveCampaign.
 *
 * Nasce dal 15/09/2026: un'automazione AC ha riversato una lista di lead
 * database nel CRM a ~140 lead al minuto. Il filtro per nome della lista
 * l'avrebbe fermata, ma quel filtro conosce solo le liste che qualcuno si è
 * ricordato di scrivere in configurazione — e una lista nuova, o rinominata,
 * non la conosce nessuno finché il danno non è fatto.
 *
 * Questo controllo non guarda DA DOVE arrivano i lead: guarda QUANTI ne
 * arrivano. È la sola difesa che funziona anche contro la lista di domani, che
 * oggi non sappiamo nemmeno che esisterà.
 *
 * Per dare la misura: il traffico normale è ~300 lead al giorno, cioè 2 ogni
 * 10 minuti; il flood ne faceva ~1.400 ogni 10 minuti.
 *
 * Modulo puro: niente DB, niente rete. Il conteggio lo fa il chiamante, che sa
 * interrogare il database; qui si decide solo cosa farne.
 */

/** Quanti lead in finestra fanno scattare l'interruttore. */
export const BURST_LIMIT_DEFAULT = 100;
/** Ampiezza della finestra di osservazione, in minuti. */
export const BURST_WINDOW_MIN_DEFAULT = 10;

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);

/**
 * Un intero positivo da env, o il valore di ripiego. Un valore illeggibile non
 * deve poter alzare la soglia all'infinito né azzerarla: nel dubbio vale il
 * ripiego, e lo si dice nei log.
 */
function interoDaEnv(nome: string, ripiego: number): number {
    const raw = process.env[nome]?.trim();
    if (!raw) return ripiego;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        console.error(`[burstGuard] ${nome}="${raw}" non è un intero positivo: uso ${ripiego}`);
        return ripiego;
    }
    return n;
}

export interface BurstConfig {
    /** false = interruttore spento (env AC_INTAKE_BURST=off). */
    attivo: boolean;
    limite: number;
    finestraMinuti: number;
}

export function leggiBurstConfig(): BurstConfig {
    const raw = process.env.AC_INTAKE_BURST?.trim().toLowerCase();
    return {
        attivo: !(raw && OFF_VALUES.has(raw)),
        limite: interoDaEnv('AC_INTAKE_BURST_LIMIT', BURST_LIMIT_DEFAULT),
        finestraMinuti: interoDaEnv('AC_INTAKE_BURST_WINDOW_MIN', BURST_WINDOW_MIN_DEFAULT),
    };
}

export interface BurstDecision {
    /** true = questo lead NON entra: siamo oltre la soglia. */
    blocca: boolean;
    motivo: string | null;
}

/**
 * Decide se fermare l'ingresso, dato quanti lead sono entrati nella finestra.
 *
 * `esente` serve ai flussi che hanno una raffica VOLUTA e programmata — il
 * lancio, o un import deciso da un manager: lì un picco è il funzionamento
 * previsto, non un guasto, e bloccarlo farebbe perdere i lead di una campagna
 * pagata.
 */
export function decidiBurst(args: {
    conteggioInFinestra: number;
    config: BurstConfig;
    esente?: boolean;
}): BurstDecision {
    const { conteggioInFinestra, config, esente } = args;
    if (!config.attivo || esente) return { blocca: false, motivo: null };
    if (conteggioInFinestra < config.limite) return { blocca: false, motivo: null };
    return {
        blocca: true,
        motivo: `burst_guard:${conteggioInFinestra}_in_${config.finestraMinuti}min`,
    };
}
