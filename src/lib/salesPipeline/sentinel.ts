/**
 * La sentinella degli appuntamenti autofissati dal venditore.
 *
 * Vive in `leads.confirmationsOutcome` e non e' un esito delle Conferme: e' il
 * segno che quell'appuntamento le Conferme non lo devono vedere e nessuno lo
 * deve contare come conferma.
 *
 * Perche' funziona senza toccare il codice Conferme: nel CRM ci sono due
 * famiglie di lettori di quella colonna, e 'autofissato' cade dalla parte
 * giusta di entrambe.
 *  - "da lavorare dalle Conferme" e' sempre `IS NULL` (board confermeActions,
 *    avviso bloccante richiami, riepilogo azienda): la sentinella non e' NULL,
 *    quindi esce da tutte;
 *  - "e' una conferma" e' sempre `= 'confermato'` (funnelStages, confermeKpi,
 *    gdoPerformance, achievements): la sentinella non e' 'confermato', quindi
 *    non viene contata da nessuna.
 *
 * NON cambiare questa stringa: e' scritta sulle righe gia' in produzione.
 */
export const SELF_BOOKED_OUTCOME = 'autofissato' as const

export function isSelfBooked(outcome: string | null | undefined): boolean {
    return outcome === SELF_BOOKED_OUTCOME
}
