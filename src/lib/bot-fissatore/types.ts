/** Report strutturato che il bot scrive su leads.botReport (tutti i campi opzionali). */
export interface BotReport {
    summary?: string;
    painPoints?: string[];
    budgetSignal?: string;
    urgency?: string;       // 'alta' | 'media' | 'bassa' (libero, non vincolato a livello tipo)
    objections?: string[];
    levaConsigliata?: string;
}

/** Payload inviato al webhook del bot quando un lead viene assegnato a gdo205. */
export interface BotIntakePayload {
    leadId: string;
    name: string | null;
    phone: string;
    email: string | null;
    funnel: string | null;
    companyId: string;
}
