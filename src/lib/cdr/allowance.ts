/**
 * Quanto tempo di lavoro si riconosce fra una chiamata e la successiva.
 *
 * Prima esisteva una soglia sola per tutti (2 minuti): sotto era lavoro,
 * sopra interruzione. Era troppo generosa, e il committente l'ha
 * contestata con l'argomento giusto — dopo uno squillo a vuoto non c'è
 * niente da scrivere, quindi due minuti non sono giustificabili.
 *
 * L'abbuono dipende quindi da COSA C'ERA DA SCRIVERE, cioè dall'esito che
 * quella telefonata ha prodotto nel CRM. Valori fissati dal committente il
 * 2026-08-26:
 *
 *   - nessuno ha risposto            ->  9 secondi (nessuna nota, solo l'esito)
 *   - risposta, appuntamento preso   -> 80 secondi (data, ora, indirizzo, note)
 *   - risposta, richiamo fissato     -> 30 secondi (quando richiamare, due righe)
 *   - risposta, ma non se ne fa nulla ->  9 secondi (scarto o non interessato)
 *
 * Il tempo entro l'abbuono è lavoro e non si giudica. Quello oltre l'abbuono
 * è tempo fermo, e viene classificato in base alla lunghezza del buco
 * (interruzione breve o pausa vera) da productivityActions.ts.
 *
 * Modulo puro: nessuna dipendenza da database o da Next.
 */

/** Esiti registrabili su una telefonata nel CRM (colonna callLogs.outcome). */
export type CallOutcome = 'APPUNTAMENTO' | 'RICHIAMO' | 'NON_RISPOSTO' | 'DA_SCARTARE'

/** Nessuno ha risposto, oppure ha risposto ma non se ne è fatto nulla: c'è solo l'esito da mettere. */
export const ALLOWANCE_NO_VALUE_SEC = 9

/** Richiamo fissato: va annotato quando richiamare, e di solito due righe di contesto. */
export const ALLOWANCE_RICHIAMO_SEC = 30

/** Appuntamento preso: data, ora, indirizzo, note per chi conferma. È l'unico esito che richiede tempo vero. */
export const ALLOWANCE_APPUNTAMENTO_SEC = 80

/**
 * Secondi di lavoro riconosciuti dopo una telefonata.
 *
 * `billsec` = secondi di conversazione effettiva: 0 significa che nessuno ha
 * risposto, e in quel caso l'esito registrato non cambia l'abbuono (non c'è
 * stata alcuna conversazione da annotare, qualunque cosa sia stata messa nel
 * CRM). `outcome` null = nessun esito ritrovato per quella telefonata: si usa
 * l'abbuono minimo, come per gli esiti che non producono valore.
 */
export function workAllowanceSec(billsec: number, outcome: CallOutcome | string | null): number {
    if (billsec <= 0) return ALLOWANCE_NO_VALUE_SEC
    switch (outcome) {
        case 'APPUNTAMENTO': return ALLOWANCE_APPUNTAMENTO_SEC
        case 'RICHIAMO': return ALLOWANCE_RICHIAMO_SEC
        default: return ALLOWANCE_NO_VALUE_SEC
    }
}
