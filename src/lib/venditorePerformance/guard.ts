export const MAX_FOLLOW_UPS = 3;

// Regole (solo ruolo VENDITORE; MANAGER/ADMIN esenti a monte):
// - 'Non chiuso' richiede una data di follow-up e non è ammesso oltre il tetto.
// - 'Chiuso' | 'Perso' | 'Sparito' sono terminali, nessun follow-up richiesto.
export function validateOutcomeTransition(input: {
    outcome: string;
    nextFollowUpDate: Date | null;
    priorNonClosedCount: number;
}): { ok: true } | { ok: false; error: string } {
    if (input.outcome === 'Non chiuso') {
        if (input.priorNonClosedCount >= MAX_FOLLOW_UPS) {
            return { ok: false, error: `Raggiunto il numero massimo di follow-up (${MAX_FOLLOW_UPS}). Registra un esito definitivo: Chiuso o Perso.` };
        }
        if (!(input.nextFollowUpDate instanceof Date) || isNaN(input.nextFollowUpDate.getTime())) {
            return { ok: false, error: 'Dopo un "Non chiuso" devi impostare la data del prossimo follow-up.' };
        }
    }
    return { ok: true };
}
