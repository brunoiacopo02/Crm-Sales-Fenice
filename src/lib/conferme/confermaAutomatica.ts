// Conferme automatiche del lancio (PO 29/10/2026).
//
// Il bot del lancio (account GDO 201) scrive `confirmationsOutcome='confermato'`
// da solo quando prenota la videocall o passa una "chiamata subito" al
// venditore (src/lib/lancio/booking.ts, `confirmationsUserId = botUserId`).
// Nessuno delle Conferme ha toccato quei lead: nelle viste delle Conferme non
// devono gonfiare il merito del team (confermati, presenze, chiusure), e si
// mostrano a parte.
//
// Regola: confermato + chi ha confermato è un account con ruolo GDO. Un GDO
// umano non può confermare (il pulsante è delle Conferme e degli admin), quindi
// oggi l'unico GDO che firma una conferma è il bot. Verificato sui dati di
// settembre-ottobre 2026: 40 conferme firmate da GDO 201, tutte senza evento
// `conferme_outcome_set`; tutte le altre hanno l'evento.

export interface ConfermaRef {
    confirmationsOutcome: string | null
    confirmationsUserId: string | null
}

export function isConfermaAutomatica(r: ConfermaRef, confermantiAutomatici: ReadonlySet<string>): boolean {
    return r.confirmationsOutcome === 'confermato'
        && !!r.confirmationsUserId
        && confermantiAutomatici.has(r.confirmationsUserId)
}
