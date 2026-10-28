// Obiettivi di partenza della pagina /statistiche-fissatore (PO 28/10/2026).
//
// Il valore scritto dall'admin (appSettings 'fissatore_obiettivi') vince
// sempre su questi. La pagina scrive accanto a ogni obiettivo da dove viene:
// 'piano' = dal piano della Direzione Commerciale, 'miglior_mese' = il
// miglior mese del bot, oppure "scritto dall'admin".
//
// Nessuno dei quattro ha un obiettivo nel piano (Piano Direzione Commerciale e
// Doc Paolo, letti il 28/10/2026): vengono dal miglior mese del bot.
//
// TODO(PO): valori segnaposto. I numeri li calcola il coordinatore e vanno
// scritti qui al posto dei null. Finché sono null la pagina mostra
// "da impostare" (o il valore dell'admin, se l'ha scritto).

import type { ObiettiviDefault } from './obiettiviFissatore'

export const OBIETTIVI_FISSATORE_DEFAULT: ObiettiviDefault = {
    /** % dei lead ricevuti che risponde al bot. TODO: miglior mese del bot. */
    risposta: { valore: null, fonte: 'miglior_mese' },
    /** % fissaggio sul totale dei ricevuti. TODO: miglior mese del bot. */
    fissaggioTotale: { valore: null, fonte: 'miglior_mese' },
    /** % fissaggio su chi risponde. TODO: miglior mese del bot. */
    fissaggioRisposti: { valore: null, fonte: 'miglior_mese' },
    /** % restituzioni sui ricevuti (più basso è meglio). TODO: miglior mese del bot. */
    restituzione: { valore: null, fonte: 'miglior_mese' },
}
