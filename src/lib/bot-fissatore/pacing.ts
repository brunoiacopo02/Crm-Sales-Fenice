/**
 * Quando parte il prossimo push di un lotto verso l'intake del bot.
 *
 * Modulo puro estratto da `pushLeadsToBotPaced`: la decisione "aspetto quanto,
 * e mi fermo?" e' l'unica parte del push a lotti che si puo' sbagliare in
 * silenzio, e sbagliarla significa o superare il tetto del fornitore o troncare
 * un lotto senza dichiarare il resto. Qui e' testabile senza rete ne' DB.
 */

export interface ProssimoInvio {
    /** Quanto dormire prima di questo invio. Mai negativo. */
    attesaMs: number;
    /** True se partire sforerebbe il budget: il lotto si ferma e dichiara il resto. */
    fuoriBudget: boolean;
}

/**
 * `indice` e' la posizione nel lotto (0-based), `elapsedMs` il tempo passato
 * dall'inizio del lotto.
 *
 * La cadenza e' ancorata all'ISTANTE DI PARTENZA, non all'ultimo invio: l'invio
 * numero `i` e' atteso a `i * intervallo`. Se un push e' stato lento — un timeout
 * dell'intake costa fino a 15 secondi — il successivo parte subito invece di
 * sommare la propria attesa al ritardo gia' accumulato. Cosi' la media resta
 * sotto il tetto senza che un lotto si allunghi all'infinito.
 */
export function prossimoInvio(args: {
    indice: number;
    elapsedMs: number;
    intervalloMs: number;
    budgetMs: number;
}): ProssimoInvio {
    const { indice, elapsedMs, intervalloMs, budgetMs } = args;
    const attesaMs = Math.max(0, indice * intervalloMs - elapsedMs);
    return { attesaMs, fuoriBudget: elapsedMs + attesaMs > budgetMs };
}
