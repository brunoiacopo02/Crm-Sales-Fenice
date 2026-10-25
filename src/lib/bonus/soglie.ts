/**
 * Soglie dei bonus GDO e Conferme.
 *
 * GDO: soglia FISSA a 4 presenze a settimana per decisione del PO del
 * 25/10/2026 (restyle "Diretta"): €12 lordi per ogni presenza dalla 5ª in poi,
 * senza tetto. Non scala più con l'obiettivo di fatturato del mese ed è lo
 * stesso valore di `presenzeSogliaEuro` / `euroPerPresenza` nella
 * configurazione della Diretta (src/lib/diretta/config.ts).
 *
 * Conferme: la soglia si ricava ancora dall'obiettivo di fatturato del mese
 * (PO 2026-10-13). Gli importi restano fissi; la soglia si riproporziona:
 *
 *   soglia(mese) = round(soglia all'ancora × obiettivo del mese / obiettivo dell'ancora)
 *
 * Ancora = ottobre 2026 (obiettivo €310.000), dove il PO ha fissato Conferme
 * 20 chiusure di squadra a settimana. L'obiettivo del mese è
 * `monthlyLeadTargets.targetFatturatoMonthly` (Panoramica generale → Numeri mensili).
 *
 * Venditori: bonus in percentuale sull'incasso, non dipende dall'obiettivo.
 */

export const ANCORA_FATTURATO_EUR = 310_000
export const ANCORA_MESE = '2026-10'

/** Soglia fissa GDO (PO 25/10/2026): le presenze OLTRE la 4ª valgono euro. */
export const GDO_SOGLIA_FISSA = 4
const GDO_EURO = 12
const CONFERME_SOGLIA_ANCORA = 20
const CONFERME_EURO = 15

/** Bonus GDO: uguale ogni mese, con o senza obiettivo di fatturato. */
export const BONUS_GDO = { soglia: GDO_SOGLIA_FISSA, euro: GDO_EURO } as const

export interface SoglieBonus {
    /** Obiettivo del mese / obiettivo dell'ancora. */
    fattore: number
    /** €12 per ogni presenza oltre la soglia (fissa a 4), per persona, a settimana. */
    gdo: { soglia: number; euro: number }
    /** €15 per ogni chiusura di squadra oltre la soglia, a settimana, a ciascuno. */
    conferme: { soglia: number; euro: number }
}

const scala = (base: number, fattore: number) => Math.max(1, Math.round(base * fattore))

export function calcolaSoglieBonus(obiettivoFatturatoEur: number | null | undefined): SoglieBonus | null {
    if (!obiettivoFatturatoEur || obiettivoFatturatoEur <= 0) return null
    const fattore = obiettivoFatturatoEur / ANCORA_FATTURATO_EUR
    return {
        fattore,
        gdo: { ...BONUS_GDO },
        conferme: { soglia: scala(CONFERME_SOGLIA_ANCORA, fattore), euro: CONFERME_EURO },
    }
}
