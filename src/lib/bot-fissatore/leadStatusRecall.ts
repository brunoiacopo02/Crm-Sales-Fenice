/**
 * Esito Conferme + richiamo come li serve /api/bot/lead-status.
 * "Scartato vince": un lead parcheggiato (da rifissare) poi scartato dalle
 * Conferme non deve uscire come da_rifissare, né col suo richiamo, altrimenti il
 * bot scriverebbe a un lead scartato. `recallAt` esce solo con 'da_rifissare'.
 */
export function serveConfermeOutcome(
    needsReschedule: boolean | null,
    outcome: string | null,
    recallDate: Date | null,
): { confermeOutcome: string | null; recallAt: string | null } {
    const parked = !!needsReschedule && outcome !== 'scartato';
    return {
        confermeOutcome: parked ? 'da_rifissare' : outcome,
        recallAt: parked && recallDate ? recallDate.toISOString() : null,
    };
}
