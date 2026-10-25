// Interruttore della Diretta cambiato a sessione aperta (revisione del 25/10/2026).
//
// Nella navigazione lato client il layout (cornice, barra, menu, data-ui sul
// div radice) non si ridisegna, la pagina sì: dopo un cambio dell'interruttore
// una pagina nuova può nascere con la veste opposta alla cornice. La veste
// della cornice è l'attributo data-ui del div radice del layout (unica fonte):
// se la pagina non coincide, si chiede un router.refresh() e layout e pagina
// tornano a leggere l'interruttore insieme.

/** Attributo che segna il div radice del layout della dashboard. */
export const RADICE_DASHBOARD = 'data-radice-dashboard'

/** Al massimo un refresh ogni 10 secondi: un disallineamento che non si risolve non diventa un giro. */
export const PAUSA_RIALLINEO_MS = 10_000

/**
 * Vero se la pagina è nata con una veste diversa da quella della cornice
 * (`uiLayout` = data-ui del div radice) e l'ultimo refresh è abbastanza lontano.
 */
export function serveRiallineare(p: {
    uiLayout: string | null
    paginaDiretta: boolean
    ultimoRefresh: number
    adesso: number
}): boolean {
    const layoutDiretta = p.uiLayout === 'diretta'
    if (layoutDiretta === p.paginaDiretta) return false
    return p.adesso - p.ultimoRefresh >= PAUSA_RIALLINEO_MS
}
