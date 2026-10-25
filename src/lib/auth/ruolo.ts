// Regola pura del controllo di ruolo sulla tabella users (vedi ./ruoloDb.ts).

export interface RigaRuolo {
    role: string
    isActive: boolean
}

/** Ammesso se la riga c'è, l'account è attivo e il ruolo è fra quelli richiesti. */
export function ruoloAmmesso(riga: RigaRuolo | null | undefined, ruoli: readonly string[]): boolean {
    return !!riga && riga.isActive && ruoli.includes(riga.role)
}
