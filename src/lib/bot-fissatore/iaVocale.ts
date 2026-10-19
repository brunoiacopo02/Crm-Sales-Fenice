/**
 * Lead nuovi ridati dal bot che andavano all'IA vocale (PO 06/10/2026).
 *
 * Dal 06/10 al 19/10/2026 i ridati giravano ai GDO del pool `botReturnIntake`, al
 * massimo MAX_RIDATI_GDO_GIORNO a testa al giorno; quando tutti erano pieni il lead
 * usciva dal CRM dei GDO (assignedToId null, NEW) e finiva nella coda dell'IA
 * vocale, che l'amministrazione scaricava in Excel da /ia-vocale. La coda la
 * riconosce l'evento EVENTO_IA_VOCALE.
 *
 * Dal 19/10/2026 (PO) l'IA vocale non riceve piu' lead e non deve chiamare quelli
 * che ha gia': IA_VOCALE_ATTIVA = false svuota la coda e il foglio che ne dipende.
 * I ridati con chat interrotta vanno tutti ai GDO del giro, senza tetto; quelli
 * che non hanno mai risposto vengono parcheggiati (EVENTO_RIDATO_PARCHEGGIATO).
 */
export const IA_VOCALE_ATTIVA = false
export const MAX_RIDATI_GDO_GIORNO = 20
export const EVENTO_IA_VOCALE = 'IA_VOCALE_IN_CODA'

/**
 * Ridato parcheggiato (PO 19/10/2026): il bot non ha mai avuto risposta, e con
 * tre GDO presenti chiamarlo a mano costa piu' di quanto rende. Resta NEW e non
 * assegnato, fuori da ogni pipeline e dalla coda dell'IA; si ripesca in blocco da
 * /import (redistribuzione, sorgente "non assegnati") quando si decide di lavorarli.
 */
export const EVENTO_RIDATO_PARCHEGGIATO = 'RIDATO_PARCHEGGIATO'
