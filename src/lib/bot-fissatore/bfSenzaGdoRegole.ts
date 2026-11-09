// Regola pura di bfSenzaGdo.ts (testabile senza DB).

export interface CandidatoBf {
    assignedToId: string | null
    status: string
    appointmentDate: Date | null
    presentedAt: Date | null
    confirmationsUserId: string | null
    reservedSalespersonId: string | null
    isTest: boolean
    /** Ha un REASSIGNED_FROM_BOT o un RIDATO_PARCHEGGIATO: è passato dal bot ed è tornato. */
    tornatoDalBot: boolean
}

/** Il BF va ripreso e dato a un GDO? Aperto, di nessuno, non in Conferme/venditori, tornato dal bot. */
export function bfDaRiprendere(l: CandidatoBf): boolean {
    return l.assignedToId === null
        && (l.status === 'NEW' || l.status === 'IN_PROGRESS')
        && !l.appointmentDate
        && !l.presentedAt
        && !l.confirmationsUserId
        && !l.reservedSalespersonId
        && !l.isTest
        && l.tornatoDalBot
}
