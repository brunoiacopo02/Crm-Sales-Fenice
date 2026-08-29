/** Report strutturato che il bot scrive su leads.botReport (tutti i campi opzionali). */
export interface BotReport {
    summary?: string;
    painPoints?: string[];
    budgetSignal?: string;
    urgency?: string;       // 'alta' | 'media' | 'bassa' (libero, non vincolato a livello tipo)
    objections?: string[];
    levaConsigliata?: string;
}

/** Un lead precedente con lo stesso numero: al bot serve per capire che è la stessa chat. */
export interface PreviousLeadRef {
    leadId: string;
    status: string;
    outcome: string | null;
    createdAt: string;
}

/** Payload inviato al webhook del bot quando un lead viene assegnato all'account bot. */
export interface BotIntakePayload {
    leadId: string;
    name: string | null;
    phone: string;
    email: string | null;
    funnel: string | null;
    companyId: string;
    /**
     * Ultime 10 cifre del telefono normalizzato: la stessa persona ha sempre la
     * stessa chiave, anche quando da noi diventa un lead nuovo. Il fornitore
     * deduplica per numero e non può fare altrimenti — una persona ha una chat
     * sola. Con questa capisce da solo che è la stessa conversazione.
     * `acContactId` non basterebbe: copre il 52% dei casi, gli import manuali
     * e i CSV non ce l'hanno.
     */
    personKey?: string;
    /** I lead precedenti con la stessa personKey, dal più recente. Max 10. */
    previousLeadIds?: PreviousLeadRef[];
}
