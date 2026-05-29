// Conversion rates osservati storicamente sul funnel.
// Usati per ROAS projected nella pagina /testing.
export const RATE_APPT_TO_CONF = 0.16
export const RATE_CONF_TO_SALE = 0.4

/**
 * Moltiplicatore di maturazione per ROAS Totale, in base alla durata del
 * range selezionato. Riflette la curva di maturazione vendite:
 *   1.94 → finestra ≤ 7 giorni (≈51% delle vendite osservate)
 *   1.47 → finestra ≤ 14 giorni (≈68%)
 *   1.30 → finestra ≤ 30 giorni (≈77%)
 *   1.00 → > 30 giorni (maturo)
 */
export function roasMultiplier(from: string, to: string): number {
  const fromTs = Date.parse(from)
  const toTs = Date.parse(to)
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) return 1.0
  const days = (toTs - fromTs) / 86_400_000 + 1
  if (days <= 7) return 1.94
  if (days <= 14) return 1.47
  if (days <= 30) return 1.3
  return 1.0
}

export function isTestingCampaign(campaignName: string): boolean {
  return /\b(TEST|ABO)\b/i.test(campaignName)
}

// ROAS coloring (verde ≥ 3.5, giallo 2.8–3.5, rosso < 2.8, grigio se 0).
export function roasColor(roas: number): string {
  if (roas === 0) return 'var(--faint)'
  if (roas >= 3.5) return 'var(--ok)'
  if (roas >= 2.8) return 'var(--warn)'
  return 'var(--err)'
}

// Cost vs target (≤ target verde, ≤ target × 1.3 giallo, > target × 1.3 rosso).
export function costColor(cost: number, target: number): string {
  if (cost <= 0 || target <= 0) return 'var(--faint)'
  if (cost <= target) return 'var(--ok)'
  if (cost <= target * 1.3) return 'var(--warn)'
  return 'var(--err)'
}

export function normalizeAdName(name: string): string {
  return name.trim().replace(/(\s*-\s*Copia(\s+\d+)?\s*)+$/i, '').trim()
}

export interface MarketingTargets {
  aov: number
  cac: number
  cost_app: number
  cost_conf: number
}

export const DEFAULT_TARGETS: MarketingTargets = {
  aov: 2300,
  cac: 600,
  cost_app: 45,
  cost_conf: 225,
}
