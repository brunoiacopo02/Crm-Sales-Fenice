/**
 * Soglia del bonus presenze dei GDO.
 *
 * GDO: soglia FISSA a 4 presenze a settimana per decisione del PO del
 * 25/10/2026 (restyle "Diretta"): €12 lordi per ogni presenza dalla 5ª in poi,
 * senza tetto. Non scala con l'obiettivo di fatturato del mese ed è lo stesso
 * valore di `presenzeSogliaEuro` / `euroPerPresenza` nella configurazione della
 * Diretta (src/lib/diretta/config.ts).
 *
 * Conferme: dal 25/10/2026 anche la loro soglia è fissa (16 chiusure di
 * squadra a settimana, poi €12 a testa) e vive nella configurazione del bonus
 * Conferme (src/lib/conferme/bonus.ts, /admin/diretta/conferme): non si
 * riproporziona più sull'obiettivo di fatturato.
 *
 * Venditori: bonus in percentuale sull'incasso, non dipende dall'obiettivo.
 */

/** Soglia fissa GDO (PO 25/10/2026): le presenze OLTRE la 4ª valgono euro. */
export const GDO_SOGLIA_FISSA = 4
const GDO_EURO = 12

/** Bonus GDO: uguale ogni mese, con o senza obiettivo di fatturato. */
export const BONUS_GDO = { soglia: GDO_SOGLIA_FISSA, euro: GDO_EURO } as const
