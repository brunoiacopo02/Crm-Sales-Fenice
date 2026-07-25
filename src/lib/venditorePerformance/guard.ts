export const MAX_FOLLOW_UPS = 3;

// Regole (solo ruolo VENDITORE; MANAGER/ADMIN esenti a monte):
// - 'Non chiuso' è sempre ammesso; il follow-up è FACOLTATIVO (decisione PO 2026-07-08).
// - Un NUOVO follow-up non è ammesso oltre il tetto di MAX_FOLLOW_UPS: l'esito
//   passa comunque, ma senza pianificare l'ennesimo richiamo.
// - 'Chiuso' | 'Sparito' sono terminali, nessun follow-up richiesto.
// - 'Perso' è stato rimosso (era un doppione di 'Non chiuso' e veniva mostrato
//   come "Sparito" in Conferme + escluso dai presenziati).
export function validateOutcomeTransition(input: {
    outcome: string;
    nextFollowUpDate: Date | null;
    priorNonClosedCount: number;
}): { ok: true } | { ok: false; error: string } {
    if (input.outcome === 'Perso') {
        return { ok: false, error: `L'esito "Perso" non esiste più: usa "Non chiuso" (con o senza follow-up).` };
    }
    if (input.outcome === 'Non chiuso' && input.nextFollowUpDate !== null) {
        if (!(input.nextFollowUpDate instanceof Date) || isNaN(input.nextFollowUpDate.getTime())) {
            return { ok: false, error: 'Data follow-up non valida.' };
        }
        if (input.priorNonClosedCount >= MAX_FOLLOW_UPS) {
            return { ok: false, error: `Raggiunto il numero massimo di follow-up (${MAX_FOLLOW_UPS}): registra l'esito senza pianificare un nuovo follow-up.` };
        }
    }
    return { ok: true };
}

// Conta i 'Non chiuso' del CICLO CORRENTE: dopo una riapertura dallo Storico
// (leads.salesCycleStartAt valorizzato) il tetto MAX_FOLLOW_UPS riparte,
// contando solo gli attempt con outcomeAt >= cycleStartAt. cycleStartAt null
// = nessuna riapertura = comportamento storico (conta tutto).
export function countCycleNonClosed(
    attempts: Array<{ outcome: string; outcomeAt: Date | null }>,
    cycleStartAt: Date | null,
): number {
    return attempts.filter(a =>
        a.outcome === 'Non chiuso'
        && (!cycleStartAt || (a.outcomeAt !== null && a.outcomeAt >= cycleStartAt))
    ).length;
}

// Occasione a cui si riferisce un salvataggio di esito:
// - 'new'     → il venditore sta lavorando il lead in una NUOVA occasione
//               (esito di un follow-up pianificato, chiusura diretta dallo Storico):
//               nasce un tentativo in più. È il default = comportamento storico.
// - 'current' → il salvataggio riguarda l'esito già registrato per l'occasione in
//               corso: è una CORREZIONE, non un nuovo tentativo.
export type OutcomeOccasion = 'new' | 'current';

type AttemptRef = { id: string; outcome: string; outcomeAt: Date | null; attemptNumber: number };

// Decide se il salvataggio di un esito deve creare un nuovo salesAttempt o
// correggere quello esistente.
//
// Il bug che questa funzione chiude: saveVenditoreOutcome inseriva SEMPRE un
// nuovo attempt, quindi ogni ri-registrazione o correzione di un esito
// duplicava il tentativo e — sulle chiusure — contava due volte il fatturato
// in tutte le viste che leggono salesAttempts.
//
// Invariante di dominio applicata sempre, a prescindere dall'occasione
// dichiarata: UN SOLO 'Chiuso' per ciclo. Un lead firma una volta sola; una
// rifirma dello stesso cliente va su un altro lead (pattern Ligozzi/Laudazzi).
// È questa regola a rendere impossibile il doppio conteggio del fatturato
// anche se un chiamante sbaglia a dichiarare l'occasione.
export function resolveAttemptWrite(input: {
    attempts: AttemptRef[];
    outcome: string;
    cycleStartAt: Date | null;
    leadHasOutcome: boolean;
    occasion: OutcomeOccasion;
}): { mode: 'insert'; attemptNumber: number } | { mode: 'update'; id: string } {
    const insert = { mode: 'insert' as const, attemptNumber: input.attempts.length };
    const inCycle = input.attempts.filter(a =>
        !input.cycleStartAt || (a.outcomeAt !== null && a.outcomeAt >= input.cycleStartAt)
    );

    // 1. Una sola chiusura per ciclo: la seconda è sempre una correzione.
    if (input.outcome === 'Chiuso') {
        const alreadyClosed = inCycle.filter(a => a.outcome === 'Chiuso');
        if (alreadyClosed.length) {
            return { mode: 'update', id: alreadyClosed.reduce((b, a) => (a.attemptNumber > b.attemptNumber ? a : b)).id };
        }
    }

    // 2. Niente da correggere: primo esito del ciclo, oppure ciclo riaperto e
    //    non ancora esitato (reopenNegotiation azzera salespersonOutcome).
    if (!inCycle.length || !input.leadHasOutcome) return insert;

    // 3. Nuova occasione dichiarata dal chiamante → tentativo in più.
    if (input.occasion === 'new') return insert;

    // 4. Correzione dell'esito in corso: riscrive l'ultimo tentativo del ciclo.
    return { mode: 'update', id: inCycle.reduce((b, a) => (a.attemptNumber > b.attemptNumber ? a : b)).id };
}

// Ultimo attempt 'Non chiuso' del ciclo corrente, scelto per attemptNumber
// massimo (deterministico anche con outcomeAt retrodatati o null — stesso
// criterio del Monitor Vendite).
export function findLastCycleNonClosed<T extends { outcome: string; outcomeAt: Date | null; attemptNumber: number }>(
    attempts: T[],
    cycleStartAt: Date | null,
): T | null {
    const inCycle = attempts.filter(a =>
        a.outcome === 'Non chiuso'
        && (!cycleStartAt || (a.outcomeAt !== null && a.outcomeAt >= cycleStartAt))
    );
    if (!inCycle.length) return null;
    return inCycle.reduce((best, a) => (a.attemptNumber > best.attemptNumber ? a : best));
}
