export const FIRST_MONTH = '2026-09'
const MONTH_RE = /^\d{4}-\d{2}$/

export function monthsFrom(first: string, current: string): string[] {
    const out: string[] = []
    let [y, m] = current.split('-').map(Number)
    while (`${y}-${String(m).padStart(2, '0')}` >= first) {
        out.push(`${y}-${String(m).padStart(2, '0')}`)
        m -= 1
        if (m === 0) { m = 12; y -= 1 }
    }
    return out
}

export function pickMonth(raw: string | undefined, current: string): string {
    if (!raw || !MONTH_RE.test(raw)) return current
    return raw >= FIRST_MONTH && raw <= current ? raw : current
}

export type SellerMonth = { incassatoCents: number; lordaCents: number; imponibileCents: number; multeCents: number; nettoCents: number; hasCommissionRow: boolean }

/** La commissione la decide il gestionale; il CRM toglie solo le multe. Il netto si mostra com'è, anche negativo. */
export function sellerMonthSummary(
    comm: { totaleIncassatoCents: number; commissioneLordaCents: number; commissioneImponibileCents: number } | undefined,
    multeEur: number,
): SellerMonth {
    const multeCents = Math.round(multeEur * 100)
    const imponibileCents = comm?.commissioneImponibileCents ?? 0
    return {
        incassatoCents: comm?.totaleIncassatoCents ?? 0,
        lordaCents: comm?.commissioneLordaCents ?? 0,
        imponibileCents,
        multeCents,
        nettoCents: imponibileCents - multeCents,
        hasCommissionRow: comm !== undefined,
    }
}

/** Flusso di cassa del mese: ogni riga conta col suo segno, quindi originale + storno negativo = 0. */
export function cashTotalCents(incassi: { data: string | null; importoCents: number }[], mese: string): number {
    return incassi.reduce((s, i) => (i.data && i.data.slice(0, 7) === mese ? s + i.importoCents : s), 0)
}

export function commissionableSumCents(incassi: { contaCommissione: boolean; importoCents: number }[]): number {
    return incassi.reduce((s, i) => (i.contaCommissione ? s + i.importoCents : s), 0)
}

export const AT_RISK_STATES = ['Avvocato', 'Recupero', 'Sollecito', 'Stand-by'] as const

export type AtRiskContract = { id: string; clienteNome: string | null; clienteCognome: string | null; clienteTelefono: string | null; venditoreCode: string | null; salesUserId: string | null; statoPagamento: string | null; dataFirma: string | null }
export type AtRiskRata = { contrattoId: string; scadenza: string | null; importoCents: number; stato: string | null }
export type AtRiskRow = AtRiskContract & { rateScadute: number; scadutoCents: number; residuoCents: number; giorniDallaPiuVecchia: number | null }

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export function classifyAtRisk(contratti: AtRiskContract[], rate: AtRiskRata[], today: string): AtRiskRow[] {
    const byContract = new Map<string, AtRiskRata[]>()
    for (const r of rate) {
        const list = byContract.get(r.contrattoId) ?? []
        list.push(r)
        byContract.set(r.contrattoId, list)
    }
    const rank = (s: string | null) => {
        const i = AT_RISK_STATES.indexOf(s as (typeof AT_RISK_STATES)[number])
        return i === -1 ? AT_RISK_STATES.length : i
    }
    const rows: AtRiskRow[] = []
    for (const c of contratti) {
        const rs = byContract.get(c.id) ?? []
        const scadute = rs.filter(r => r.stato === 'scaduta')
        const inState = rank(c.statoPagamento) < AT_RISK_STATES.length
        if (!inState && scadute.length === 0) continue
        const oldest = scadute.map(r => r.scadenza).filter((d): d is string => !!d).sort()[0]
        rows.push({
            ...c,
            rateScadute: scadute.length,
            scadutoCents: scadute.reduce((s, r) => s + r.importoCents, 0),
            residuoCents: rs.filter(r => r.stato !== 'pagata').reduce((s, r) => s + r.importoCents, 0),
            giorniDallaPiuVecchia: oldest ? daysBetween(oldest, today) : null,
        })
    }
    return rows.sort((a, b) => rank(a.statoPagamento) - rank(b.statoPagamento) || b.scadutoCents - a.scadutoCents)
}

/** Un sync 'running' da oltre 10 minuti e' stato ucciso dalla piattaforma: lo mostriamo come errore. */
export function effectiveRunStatus(
    r: { status: string; startedAt: Date; error: string | null },
    now: Date,
): { status: string; error: string | null } {
    if (r.status === 'running' && now.getTime() - r.startedAt.getTime() > 10 * 60 * 1000) {
        return { status: 'error', error: 'aggiornamento interrotto' }
    }
    return { status: r.status, error: r.error }
}
