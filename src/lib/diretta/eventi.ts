// Eventi window della Diretta. `diretta_appointment` parte SOLO dopo che il
// server ha registrato l'esito APPUNTAMENTO (GdoQuickActions, OutcomeModal):
// la home lo usa per far avanzare il contatore senza aspettare il prossimo
// aggiornamento. Non dipende dalle animazioni: il numero va avanzato anche a
// chi le ha spente.

export const DIRETTA_APPUNTAMENTO = 'diretta_appointment'

export interface DirettaAppuntamentoDetail {
    leadId: string
    at: number
}

export function emettiAppuntamentoDiretta(leadId: string): void {
    if (typeof window === 'undefined') return
    try {
        window.dispatchEvent(new CustomEvent<DirettaAppuntamentoDetail>(DIRETTA_APPUNTAMENTO, {
            detail: { leadId, at: Date.now() },
        }))
    } catch { /* un evento perso non deve bloccare l'esito */ }
}
