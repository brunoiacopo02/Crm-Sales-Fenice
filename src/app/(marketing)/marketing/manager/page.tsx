'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Crown } from 'lucide-react'
import DateRangePicker, { DateRange } from '@/components/marketing/DateRangePicker'
import { roasColor } from '@/lib/marketing/projections'

interface FunnelMeta { funnel: string; name: string; spend: number }
interface LeadEntry { funnel: string; leads: number; error?: string | null }
interface SaleEntry { funnel: string; count: number; revenue: number }

interface FunnelKPI {
  funnel: string; name: string; spend: number; leads: number; revenue: number
  cpl: number; roas: number
  companyId?: string | null; companyName?: string | null
}

interface NonMetaFunnelKPI {
  funnel: string; name: string; leads: number; sales: number; revenue: number
  companyId?: string | null; companyName?: string | null
}

const NON_META_FUNNELS: { id: string; name: string }[] = [
  { id: 'telegram-tk', name: 'Telegram TK' },
  { id: 'google', name: 'Google' },
]

const FUNNEL_BORDER: Record<string, string> = {
  telegram: '#0ea5e9', corso10ore: '#8b5cf6', jobsimulator: '#f59e0b',
  'telegram-tk': '#06b6d4', google: '#10b981', org: '#64748b',
}
const FUNNEL_BADGE_CLASS: Record<string, string> = {
  telegram: 'badge-sky', corso10ore: 'badge-violet', jobsimulator: 'badge-amber',
  'telegram-tk': 'badge-muted', google: 'badge-muted', org: 'badge-muted',
}

function defaultRange(): DateRange {
  const d = new Date(); d.setDate(1)
  return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), label: 'Questo mese' }
}

function fmt(n: number, prefix = '', suffix = '', dec = 2) {
  if (n === 0) return '—'
  return `${prefix}${n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suffix}`
}
function fmtInt(n: number) { return n === 0 ? '—' : n.toLocaleString('it-IT') }

interface PerCompanyManagerData {
  funnels: FunnelKPI[]
  nonMeta: NonMetaFunnelKPI[]
  account: { spend: number; leads: number; sales: number; revenue: number }
  totals: { spend: number; leads: number; revenue: number }
}

export default function ManagerPage() {
  const [range, setRange] = useState<DateRange>(defaultRange)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [funnels, setFunnels] = useState<FunnelKPI[]>([])
  const [totals, setTotals] = useState({ spend: 0, leads: 0, revenue: 0, cpl: 0, roas: 0 })
  const [account, setAccount] = useState({ spend: 0, leads: 0, sales: 0, revenue: 0, cpl: 0, roas: 0 })
  const [nonMeta, setNonMeta] = useState<NonMetaFunnelKPI[]>([])
  const [isAllMode, setIsAllMode] = useState(false)

  const fetchForCompany = useCallback(async (
    r: DateRange,
    companyOverride: string | null,
  ): Promise<PerCompanyManagerData> => {
    const baseQs = `from=${r.from}&to=${r.to}`
    const qs = companyOverride ? `${baseQs}&company=${encodeURIComponent(companyOverride)}` : baseQs
    const [metaRes, leadsRes, salesRes, accountSpendRes, acTotalsRes] = await Promise.all([
      fetch(`/api/marketing/meta/insights?${qs}`).then((res) => res.json()).catch(() => []),
      fetch(`/api/marketing/ac/leads?${qs}`).then((res) => res.json()).catch(() => []),
      fetch(`/api/marketing/ac/sales-contract?${qs}`).then((res) => res.json()).catch(() => ({})),
      fetch(`/api/marketing/meta/account-spend?${qs}`).then((res) => res.json()).catch(() => ({ spend: 0 })),
      fetch(`/api/marketing/ac/totals?${qs}`).then((res) => res.json()).catch(() => ({ leads: 0, sales: 0, revenue: 0 })),
    ])

    const leadsMap: Record<string, number> = {}
    for (const l of Array.isArray(leadsRes) ? (leadsRes as LeadEntry[]) : []) leadsMap[l.funnel] = l.leads ?? 0

    const salesMap: Record<string, { count: number; revenue: number }> = {}
    for (const s of Array.isArray(salesRes?.perFunnel) ? (salesRes.perFunnel as SaleEntry[]) : []) {
      salesMap[s.funnel] = { count: s.count ?? 0, revenue: s.revenue ?? 0 }
    }

    const metaList: FunnelMeta[] = Array.isArray(metaRes) ? (metaRes as FunnelMeta[]) : []
    const merged: FunnelKPI[] = metaList.map((m) => {
      const leads = leadsMap[m.funnel] ?? 0
      const revenue = salesMap[m.funnel]?.revenue ?? 0
      const cpl = leads > 0 ? Math.round((m.spend / leads) * 100) / 100 : 0
      const roas = m.spend > 0 && revenue > 0 ? Math.round((revenue / m.spend) * 100) / 100 : 0
      return {
        funnel: m.funnel, name: m.name,
        spend: Math.round(m.spend * 100) / 100, leads,
        revenue: Math.round(revenue * 100) / 100, cpl, roas,
      }
    })

    const nm: NonMetaFunnelKPI[] = NON_META_FUNNELS.map((f) => {
      const leads = leadsMap[f.id] ?? 0
      const s = salesMap[f.id] ?? { count: 0, revenue: 0 }
      return { funnel: f.id, name: f.name, leads, sales: s.count, revenue: Math.round(s.revenue * 100) / 100 }
    })

    const totSpend = merged.reduce((s, f) => s + f.spend, 0)
    const totLeads = merged.reduce((s, f) => s + f.leads, 0)
    const totRevenue = merged.reduce((s, f) => s + f.revenue, 0)

    return {
      funnels: merged, nonMeta: nm,
      account: {
        spend: Math.round(Number(accountSpendRes?.spend ?? 0) * 100) / 100,
        leads: Number(acTotalsRes?.leads ?? 0),
        sales: Number(acTotalsRes?.sales ?? 0),
        revenue: Math.round(Number(acTotalsRes?.revenue ?? 0) * 100) / 100,
      },
      totals: { spend: Math.round(totSpend * 100) / 100, leads: totLeads, revenue: Math.round(totRevenue * 100) / 100 },
    }
  }, [])

  const fetchData = useCallback(async (r: DateRange) => {
    setLoading(true)
    setError(null)
    try {
      const selRes = await fetch('/api/marketing/company/selection').then((res) => res.json()).catch(() => null)
      const mode = selRes?.mode as 'single' | 'all' | null
      const ids: string[] = Array.isArray(selRes?.activeCompanyIds) ? selRes.activeCompanyIds : []
      const displayMap: Record<string, string> = {}
      for (const c of selRes?.companies ?? []) displayMap[c.id] = c.display_name
      setIsAllMode(mode === 'all')

      const activeIds = mode === 'all' ? ids : [null as string | null]
      const results = await Promise.all(activeIds.map(async (cid) => ({ cid, data: await fetchForCompany(r, cid) })))

      const allFunnels: FunnelKPI[] = []
      const allNonMeta: NonMetaFunnelKPI[] = []
      let accSpend = 0, accLeads = 0, accSales = 0, accRevenue = 0
      let totSpend = 0, totLeads = 0, totRevenue = 0

      for (const { cid, data } of results) {
        const cidForTag = cid ?? (selRes?.companyId as string | null) ?? null
        const cnameForTag = cidForTag ? (displayMap[cidForTag] ?? cidForTag) : null
        const tag = mode === 'all'
        for (const f of data.funnels) allFunnels.push({ ...f, companyId: tag ? cidForTag : null, companyName: tag ? cnameForTag : null })
        for (const f of data.nonMeta) allNonMeta.push({ ...f, companyId: tag ? cidForTag : null, companyName: tag ? cnameForTag : null })
        accSpend += data.account.spend
        accLeads += data.account.leads
        accSales += data.account.sales
        accRevenue += data.account.revenue
        totSpend += data.totals.spend
        totLeads += data.totals.leads
        totRevenue += data.totals.revenue
      }

      setFunnels(allFunnels)
      setNonMeta(allNonMeta)

      const cpl = totLeads > 0 ? Math.round((totSpend / totLeads) * 100) / 100 : 0
      const roas = totSpend > 0 && totRevenue > 0 ? Math.round((totRevenue / totSpend) * 100) / 100 : 0
      setTotals({ spend: Math.round(totSpend * 100) / 100, leads: totLeads, revenue: Math.round(totRevenue * 100) / 100, cpl, roas })

      const accCpl = accLeads > 0 ? Math.round((accSpend / accLeads) * 100) / 100 : 0
      const accRoas = accSpend > 0 && accRevenue > 0 ? Math.round((accRevenue / accSpend) * 100) / 100 : 0
      setAccount({
        spend: Math.round(accSpend * 100) / 100, leads: accLeads, sales: accSales,
        revenue: Math.round(accRevenue * 100) / 100, cpl: accCpl, roas: accRoas,
      })

      setLastRefresh(new Date().toLocaleTimeString('it-IT'))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [fetchForCompany])

  useEffect(() => { fetchData(range) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRangeChange(r: DateRange) { setRange(r); fetchData(r) }

  return (
    <div className="p-6">
      <div className="page-header mb-6">
        <div className="flex items-center gap-2">
          <Crown size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="page-title">Panoramica Manager</h1>
        </div>
        <p className="page-sub">
          KPI sintetici manager. ROAS, CPL e lead per funnel e totali.
          {isAllMode && <span className="ml-2 badge badge-muted">vista multi-azienda</span>}
          {lastRefresh && <span className="ml-2" style={{ color: 'var(--faint)' }}>· aggiornato alle {lastRefresh}</span>}
        </p>
        <div className="flex items-center gap-3">
          <DateRangePicker value={range} onChange={handleRangeChange} />
          <button onClick={() => fetchData(range)} disabled={loading} className="btn btn-primary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Caricamento...' : 'Aggiorna'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Totali account</h2>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Spesa Meta</div><div className="text-2xl font-semibold">{fmt(account.spend, '€', '', 0)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Lead totali</div><div className="text-2xl font-semibold">{fmtInt(account.leads)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Vendite totali</div><div className="text-2xl font-semibold">{fmtInt(account.sales)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Revenue</div><div className="text-2xl font-semibold">{fmt(account.revenue, '€', '', 0)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>CPL</div><div className="text-2xl font-semibold">{fmt(account.cpl, '€')}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>ROAS</div><div className="text-2xl font-semibold" style={{ color: roasColor(account.roas) }}>{account.roas > 0 ? `${account.roas.toFixed(2)}x` : '—'}</div></div>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Totali attribuiti per funnel</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Spend totale</div><div className="text-2xl font-semibold">{fmt(totals.spend, '€', '', 0)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>Lead totali</div><div className="text-2xl font-semibold">{fmtInt(totals.leads)}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>CPL totale</div><div className="text-2xl font-semibold">{fmt(totals.cpl, '€')}</div></div>
        <div className="card p-4"><div className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--faint)' }}>ROAS totale</div><div className="text-2xl font-semibold" style={{ color: roasColor(totals.roas) }}>{totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'}</div></div>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Per funnel</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {funnels.map((f) => (
          <div key={`${f.companyId ?? '_'}:${f.funnel}`} className="card p-4" style={{ borderLeft: `3px solid ${FUNNEL_BORDER[f.funnel] ?? 'var(--border-soft)'}` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`badge ${FUNNEL_BADGE_CLASS[f.funnel] ?? 'badge-muted'}`}>{f.name}</span>
                {f.companyName && <span className="badge badge-muted">{f.companyName}</span>}
              </div>
              <span className="text-xs" style={{ color: 'var(--faint)' }}>{fmt(f.spend, '€', '', 0)} spesi</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>Lead</div><div className="text-lg font-semibold">{fmtInt(f.leads)}</div></div>
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>CPL</div><div className="text-lg font-semibold">{fmt(f.cpl, '€')}</div></div>
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>ROAS</div><div className="text-lg font-semibold" style={{ color: roasColor(f.roas) }}>{f.roas > 0 ? `${f.roas.toFixed(2)}x` : '—'}</div></div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 mt-6" style={{ color: 'var(--muted)' }}>Altre fonti</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {nonMeta.map((f) => (
          <div key={`${f.companyId ?? '_'}:${f.funnel}`} className="card p-4" style={{ borderLeft: `3px solid ${FUNNEL_BORDER[f.funnel] ?? 'var(--border-soft)'}` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`badge ${FUNNEL_BADGE_CLASS[f.funnel] ?? 'badge-muted'}`}>{f.name}</span>
                {f.companyName && <span className="badge badge-muted">{f.companyName}</span>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>Lead</div><div className="text-lg font-semibold">{fmtInt(f.leads)}</div></div>
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>Vendite</div><div className="text-lg font-semibold">{fmtInt(f.sales)}</div></div>
              <div><div className="text-[10px] uppercase mb-0.5" style={{ color: 'var(--faint)' }}>Revenue</div><div className="text-lg font-semibold">{fmt(f.revenue, '€', '', 0)}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
