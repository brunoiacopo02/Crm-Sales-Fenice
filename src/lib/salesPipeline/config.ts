/**
 * Configurazione della pipeline autonoma del venditore.
 *
 * Vive in `appSettings` (tabella chiave-valore gia' usata per il CPL), non in
 * una env: il PO deve poterla spegnere da una pagina, senza deploy.
 *
 * Puro: qui dentro non si tocca il DB. Il lettore sta in
 * `salesPipelineConfigActions.ts`.
 */

export const SALES_PIPELINE_CONFIG_KEY = 'sales_pipeline.config'

export interface SalesPipelineConfig {
    enabled: boolean
    /** Il venditore a cui e' accesa la pipeline. Uno solo, per ora. */
    salesUserId: string | null
    /** Quanti lead freschi in arrivo da AC dirottargli, in tutto. */
    freshCap: number
}

const DEFAULT_FRESH_CAP = 5

export const DEFAULT_SALES_PIPELINE_CONFIG: SalesPipelineConfig = {
    enabled: false,
    salesUserId: null,
    freshCap: DEFAULT_FRESH_CAP,
}

/**
 * Qualunque cosa non sia una config valida e accesa su un venditore vero
 * ricade su "spenta". Una config rotta non deve poter dirottare lead a
 * nessuno: il fallimento va verso il comportamento di sempre.
 */
export function parseSalesPipelineConfig(raw: string | null | undefined): SalesPipelineConfig {
    if (!raw) return DEFAULT_SALES_PIPELINE_CONFIG
    let obj: unknown
    try {
        obj = JSON.parse(raw)
    } catch {
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return DEFAULT_SALES_PIPELINE_CONFIG
    const o = obj as Record<string, unknown>

    const salesUserId = typeof o.salesUserId === 'string' && o.salesUserId.trim() !== ''
        ? o.salesUserId.trim()
        : null
    const capRaw = o.freshCap
    const freshCap = typeof capRaw === 'number' && Number.isFinite(capRaw) && capRaw >= 0
        ? Math.floor(capRaw)
        : DEFAULT_FRESH_CAP

    // Accesa senza venditore non e' uno stato: e' spenta.
    const enabled = o.enabled === true && salesUserId !== null

    return { enabled, salesUserId, freshCap }
}

/** Si dirotta solo se la pipeline e' accesa e il tetto non e' ancora pieno. */
export function canDivertFresh(cfg: SalesPipelineConfig, diverted: number): boolean {
    return cfg.enabled && cfg.salesUserId !== null && diverted < cfg.freshCap
}
