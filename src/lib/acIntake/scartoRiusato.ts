/**
 * Righe di scarto del webhook AC (`acIntakeFailures`) riusate invece di crearne una
 * nuova (liste bloccate, liste non leggibili, interruttore di sovraccarico).
 *
 * Il riuso serve contro le raffiche: lo stesso contatto che arriva dieci volte in un
 * minuto deve lasciare UNA riga. Ma senza limite di tempo una riga vecchia assorbiva
 * per sempre i blocchi nuovi (PO 11/11/2026): cinque persone che il 9-10/11 hanno
 * compilato la landing Black Friday e sono state fermate dalla lista 137 non
 * comparivano da nessuna parte, perché il loro contatto aveva già una riga
 * "blocked_list:133" del 15/09 ancora aperta. Il blocco nuovo aggiornava solo il
 * payload di quella riga: data e motivo restavano di due mesi prima.
 *
 * Regola: si riusa solo una riga aperta nata nelle ultime 24 ore. Oltre, il contatto
 * che si ripresenta lascia una riga nuova, con la sua data e la sua lista.
 *
 * Modulo puro: niente DB, niente rete.
 */
export const FINESTRA_RIUSO_SCARTO_MS = 24 * 60 * 60 * 1000;

/** Le righe aperte nate da questo istante in poi si riusano; le più vecchie no. */
export function inizioRiusoScarto(now: Date): Date {
    return new Date(now.getTime() - FINESTRA_RIUSO_SCARTO_MS);
}
