// Eventi window della Diretta. `diretta_appointment` parte SOLO dopo che il
// server ha registrato l'esito APPUNTAMENTO (GdoQuickActions, OutcomeModal):
// la home lo usa per far avanzare il contatore senza aspettare il prossimo
// aggiornamento. Non dipende dalle animazioni: il numero va avanzato anche a
// chi le ha spente. Con `delta: -1` dice che un altro esito ha tolto un
// appuntamento: contatore e saldo si rileggono subito.

export const DIRETTA_APPUNTAMENTO = 'diretta_appointment'

export interface DirettaAppuntamentoDetail {
    leadId: string
    at: number
    /** +1 appuntamento fissato, -1 appuntamento tolto da un altro esito (collaudo 25/10/2026). */
    delta: 1 | -1
}

export function emettiAppuntamentoDiretta(leadId: string, delta: 1 | -1 = 1): void {
    if (typeof window === 'undefined') return
    try {
        window.dispatchEvent(new CustomEvent<DirettaAppuntamentoDetail>(DIRETTA_APPUNTAMENTO, {
            detail: { leadId, at: Date.now(), delta },
        }))
    } catch { /* un evento perso non deve bloccare l'esito */ }
}

/** Il segno dell'evento: chi lo ascolta tratta tutto ciò che non è -1 come un fissato (compatibile con prima). */
export function deltaAppuntamento(e: Event): 1 | -1 {
    const d = (e as CustomEvent<Partial<DirettaAppuntamentoDetail>>).detail
    return d?.delta === -1 ? -1 : 1
}
