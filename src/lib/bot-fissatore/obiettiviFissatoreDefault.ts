// Obiettivi di partenza della pagina /statistiche-fissatore (PO 28/10/2026).
//
// Il valore scritto dall'admin (appSettings 'fissatore_obiettivi') vince
// sempre su questi. La pagina scrive accanto a ogni obiettivo da dove viene.
// Tutti i numeri sono sui soli lead evergreen (lanci e database esclusi).

import type { ObiettiviDefault } from './obiettiviFissatore'

export const OBIETTIVI_FISSATORE_DEFAULT: ObiettiviDefault = {
    /** Appuntamenti fissati dal bot nel mese. Piano Direzione Commerciale §8.2: mix della base, 457 bot al mese. */
    appuntamenti: { valore: 457, fonte: 'piano' },
    /** % dei lead ricevuti che risponde al bot. Base del piano (1/8-14/9/2026). */
    risposta: { valore: 61.6, fonte: 'base_piano' },
    /** % fissaggio sul totale dei ricevuti. Base del piano (1/8-14/9/2026). */
    fissaggioTotale: { valore: 10, fonte: 'base_piano' },
    /** % fissaggio su chi risponde. Base del piano (1/8-14/9/2026). */
    fissaggioRisposti: { valore: 16.3, fonte: 'base_piano' },
    /** % restituzioni sui ricevuti, più bassa è meglio. Miglior mese del bot: agosto 2026. */
    restituzione: { valore: 64.6, fonte: 'miglior_mese', dettaglio: 'agosto' },
}
