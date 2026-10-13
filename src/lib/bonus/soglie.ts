/**
 * Soglie dei bonus GDO e Conferme ricavate dall'obiettivo di fatturato del mese
 * (PO 2026-10-13). Gli importi restano fissi; le soglie si riproporzionano:
 *
 *   soglia(mese) = round(soglia all'ancora × obiettivo del mese / obiettivo dell'ancora)
 *
 * Ancora = ottobre 2026 (obiettivo €310.000), dove il PO ha fissato GDO 5
 * presenze a settimana e Conferme 20 chiusure di squadra a settimana.
 * L'obiettivo del mese è `monthlyLeadTargets.targetFatturatoMonthly`
 * (Panoramica generale → Numeri mensili).
 *
 * Venditori: bonus in percentuale sull'incasso, non dipende dall'obiettivo.
 */

export const ANCORA_FATTURATO_EUR = 310_000
export const ANCORA_MESE = '2026-10'

const GDO_SOGLIA_ANCORA = 5
const GDO_EURO = 12
const CONFERME_SOGLIA_ANCORA = 20
const CONFERME_EURO = 15

export interface SoglieBonus {
    /** Obiettivo del mese / obiettivo dell'ancora. */
    fattore: number
    /** €12 per ogni presenza oltre la soglia, per persona, a settimana. */
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
        gdo: { soglia: scala(GDO_SOGLIA_ANCORA, fattore), euro: GDO_EURO },
        conferme: { soglia: scala(CONFERME_SOGLIA_ANCORA, fattore), euro: CONFERME_EURO },
    }
}
