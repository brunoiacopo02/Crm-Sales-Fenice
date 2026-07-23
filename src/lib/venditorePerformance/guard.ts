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
