/**
 * Campi Conferme da azzerare quando un GDO (ri)fissa un appuntamento su un
 * lead già scartato dalle Conferme (QA Conferme 2026-06-12): il vecchio
 * scarto non deve restare appeso al nuovo appuntamento — il lead rientra
 * nel board Conferme come fresco e il ciclo NR riparte da zero.
 */
export const CONFERME_DISCARD_RESET = {
    confirmationsOutcome: null,
    confirmationsDiscardReason: null,
    confirmationsUserId: null,
    confirmationsTimestamp: null,
    confCall1At: null,
    confCall2At: null,
    confCall3At: null,
    confCall1Duration: null,
    confCall2Duration: null,
    confCall3Duration: null,
    confVslSeen: false,
    confNeedsReschedule: false,
    confSnoozeAt: null,
    confRecallNotes: null,
} as const
