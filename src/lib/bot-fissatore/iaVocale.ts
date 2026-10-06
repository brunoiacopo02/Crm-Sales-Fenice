/**
 * Lead nuovi ridati dal bot che vanno all'IA vocale (PO 06/10/2026).
 *
 * I ridati girano ai GDO del pool `botReturnIntake`, al massimo
 * MAX_RIDATI_GDO_GIORNO a testa al giorno (giorno di Roma). Quando tutti sono pieni
 * il lead non resta in un cassetto: esce dal CRM dei GDO (assignedToId null, NEW) e
 * finisce nella coda dell'IA vocale, che l'amministrazione scarica in Excel da
 * /ia-vocale. La coda la riconosce l'evento EVENTO_IA_VOCALE.
 */
export const MAX_RIDATI_GDO_GIORNO = 20
export const EVENTO_IA_VOCALE = 'IA_VOCALE_IN_CODA'
