'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, TrendingUp, Users, Euro, MousePointerClick, Eye, Target, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
import DateRangePicker, { DateRange } from '@/components/marketing/DateRangePicker'

interface FunnelMeta {
  funnel: string; name: string
  spend: number; impressions: number; clicks: number
  cpm: number; ctr: number; cpc: number; leads_meta: number
  error?: string | null
}

interface AdRow {
  ad_id: string; ad_name: string; adset_name: string
  spend: number; impressions: number; clicks: number
  cpm: number; ctr: number; cpc: number; leads_meta: number
  leads_ac: number; cpl: number
  appointments: number; cpa: number
  confirms: number; cpconf: number
  sales_count: number; revenue: number; cps: number; roas: number
  effective_status: string; post_url: string | null
}

interface FunnelData {
  funnel: string; name: string
  spend: number; impressions: number; clicks: number
  cpm: number; ctr: number; cpc: number
  leads_ac: number; cpl: number
  appointments: number
  confirms: number
  sales_count: number; revenue: number; cps: number; roas: number
  ads: AdRow[]
  error?: string | null
  companyId?: string | null
  companyName?: string | null
}

type AdSortKey = 'spend' | 'impressions' | 'cpm' | 'ctr' | 'cpc' | 'leads_ac' | 'cpl'

function defaultRange(): DateRange {
  const d = new Date(); d.setDate(1)
  return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), label: 'Questo mese' }
}

function fmt(n: number, prefix = '', suffix = '', dec = 2) {
  if (n === 0) return '—'
  return `${prefix}${n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suffix}`
}
function fmtInt(n: number) { return n === 0 ? '—' : n.toLocaleString('it-IT') }

const FUNNEL_BORDER: Record<string, string> = {
  telegram: '#0ea5e9',
  corso10ore: '#8b5cf6',
  jobsimulator: '#f59e0b',
  'telegram-tk': '#06b6d4',
  google: '#10b981',
}
const FUNNEL_BADGE_CLASS: Record<string, string> = {
  telegram: 'badge-sky',
  corso10ore: 'badge-violet',
  jobsimulator: 'badge-amber',
  'telegram-tk': 'badge-muted',
  google: 'badge-muted',
}
const FUNNEL_ACCENT: Record<string, string> = {
  telegram: '#0369a1',
  corso10ore: '#6d28d9',
  jobsimulator: '#b45309',
  'telegram-tk': '#0891b2',
  google: '#059669',
}

const NON_META_FUNNELS: { id: string; name: string }[] = [
  { id: 'telegram-tk', name: 'Telegram TK' },
  { id: 'google', name: 'Google' },
]

function roasColor(roas: number): string {
  if (roas >= 2) return 'var(--ok)'
  if (roas > 0) return 'var(--warn)'
  return 'var(--faint)'
}

function KpiCard({ label, value, sub, icon: Icon, iconColor }: {
  label: string; value: string; sub?: string; icon: React.ElementType; iconColor: string
}) {
  return (
    <div className="kpi">
      <div className="flex items-center justify-between mb-1.5">
        <span className="kpi-label">{label}</span>
        <Icon size={14} style={{ color: iconColor }} />
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

function SortTh({ label, col, sortKey, sortDir, onSort }: {
  label: string; col: AdSortKey; sortKey: AdSortKey; sortDir: 'asc' | 'desc'
  onSort: (k: AdSortKey) => void
}) {
  const active = col === sortKey
  return (
    <th onClick={() => onSort(col)} className="sortable" style={{ textAlign: 'right' }}>
      <span className="inline-flex items-center gap-1 justify-end">
        {label}
        {active
          ? (sortDir === 'asc'
              ? <ArrowUp size={10} style={{ color: 'var(--accent)' }} />
              : <ArrowDown size={10} style={{ color: 'var(--accent)' }} />)
          : <ArrowUpDown size={10} style={{ color: 'var(--faint)' }} />}
      </span>
    </th>
  )
}

function FunnelSection({ data }: { data: FunnelData }) {
  const [sortKey, setSortKey] = useState<AdSortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active'>('all')

  function handleSort(k: AdSortKey) {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const filteredAds = statusFilter === 'active'
    ? data.ads.filter(a => a.effective_status === 'ACTIVE')
    : data.ads

  const sorted = [...filteredAds].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortDir === 'asc' ? diff : -diff
  })

  const activeCount = data.ads.filter(a => a.effective_status === 'ACTIVE').length
  const funnelAccent = FUNNEL_ACCENT[data.funnel] ?? 'var(--text)'
  const borderColor = FUNNEL_BORDER[data.funnel] ?? 'var(--border-soft)'
  const badgeClass = FUNNEL_BADGE_CLASS[data.funnel] ?? 'badge-muted'

  return (
    <div className="card overflow-hidden" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{data.name}</h3>
          {data.companyName && (
            <span className="badge badge-muted" title={data.companyId ?? undefined}>{data.companyName}</span>
          )}
          <span className={`badge ${data.error ? 'badge-err' : badgeClass}`}>
            {data.error ? 'errore' : 'attivo'}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="hidden sm:block">
            <span className="num font-semibold" style={{ color: 'var(--text)' }}>{fmt(data.spend, '€')}</span>
            <span className="ml-1" style={{ color: 'var(--faint)' }}>spend</span>
          </div>
          <div className="hidden sm:block">
            <span className="num font-semibold" style={{ color: 'var(--text)' }}>{fmtInt(data.leads_ac)}</span>
            <span className="ml-1" style={{ color: 'var(--faint)' }}>lead</span>
          </div>
          <div className="hidden sm:block">
            <span className="num font-semibold" style={{ color: 'var(--ok)' }}>{fmtInt(data.sales_count)}</span>
            <span className="ml-1" style={{ color: 'var(--faint)' }}>vendite</span>
          </div>
          <div className="hidden sm:block">
            <span className="num font-semibold" style={{ color: roasColor(data.roas) }}>
              {data.roas > 0 ? `${data.roas.toFixed(2)}x` : '—'}
            </span>
            <span className="ml-1" style={{ color: 'var(--faint)' }}>ROAS</span>
          </div>
          <span className="text-xs" style={{ color: 'var(--faint)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <>
          {data.error && (
            <div className="mx-5 mb-3 alert alert-err">{data.error}</div>
          )}

          <div
            className="grid grid-cols-3 sm:grid-cols-9 gap-px"
            style={{ background: 'var(--border-soft)', borderTop: '1px solid var(--border-soft)' }}
          >
            {[
              { label: 'Spend', value: fmt(data.spend, '€') },
              { label: 'Lead (AC)', value: fmtInt(data.leads_ac) },
              { label: 'CPL', value: fmt(data.cpl, '€'), accent: true },
              { label: 'Vendite', value: fmtInt(data.sales_count), color: 'var(--ok)' },
              { label: 'Revenue', value: fmt(data.revenue, '€'), color: 'var(--ok)' },
              { label: 'CPS', value: fmt(data.cps, '€') },
              { label: 'ROAS', value: data.roas > 0 ? `${data.roas.toFixed(2)}x` : '—', color: roasColor(data.roas) },
              { label: 'CPM', value: fmt(data.cpm, '€') },
              { label: 'CTR', value: fmt(data.ctr, '', '%', 2) },
            ].map(({ label, value, accent, color }) => (
              <div key={label} style={{ background: 'var(--surface)' }} className="px-4 py-3">
                <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>{label}</div>
                <div
                  className="num text-sm font-semibold"
                  style={{ color: color ?? (accent ? funnelAccent : 'var(--text)') }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                Creatività ({sorted.length}{statusFilter === 'active' ? ` attive su ${data.ads.length}` : ''})
              </span>
              <div className="flex items-center gap-3">
                <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--s2)' }}>
                  <button
                    onClick={() => setStatusFilter('all')}
                    className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                    style={{
                      background: statusFilter === 'all' ? 'var(--surface)' : 'transparent',
                      color: statusFilter === 'all' ? 'var(--text)' : 'var(--muted)',
                    }}
                  >
                    Tutte
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                    style={{
                      background: statusFilter === 'active' ? 'var(--ok-soft)' : 'transparent',
                      color: statusFilter === 'active' ? 'var(--ok)' : 'var(--muted)',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--ok)' }} />
                    Attive ({activeCount})
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ad</th>
                    <SortTh label="Spend" col="spend" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Impr." col="impressions" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="CPM" col="cpm" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="CTR" col="ctr" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="CPC" col="cpc" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Lead" col="leads_ac" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="CPL" col="cpl" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((ad, i) => (
                    <tr key={ad.ad_id + i}>
                      <td>
                        <a
                          href={ad.post_url ?? `https://www.facebook.com/ads/library/?id=${ad.ad_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                              style={{ background: ad.effective_status === 'ACTIVE' ? 'var(--ok)' : 'var(--faint)' }}
                            />
                            <div className="font-medium max-w-xs truncate" style={{ color: 'var(--text)' }}>
                              {ad.ad_name}
                            </div>
                            <ExternalLink size={10} style={{ color: 'var(--faint)' }} className="flex-shrink-0" />
                          </div>
                          <div className="truncate max-w-xs pl-3 text-xs" style={{ color: 'var(--faint)' }}>{ad.adset_name}</div>
                        </a>
                      </td>
                      <td className="num text-right">{fmt(ad.spend, '€')}</td>
                      <td className="num text-right">{fmtInt(ad.impressions)}</td>
                      <td className="num text-right">{fmt(ad.cpm, '€')}</td>
                      <td className="num text-right">{fmt(ad.ctr, '', '%', 2)}</td>
                      <td className="num text-right">{fmt(ad.cpc, '€')}</td>
                      <td className="num text-right">{fmtInt(ad.leads_ac)}</td>
                      <td className="num text-right font-medium" style={{ color: funnelAccent }}>{fmt(ad.cpl, '€')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface NonMetaFunnelData {
  id: string
  name: string
  leads_ac: number
  sales_count: number
  revenue: number
  companyId?: string | null
  companyName?: string | null
}

interface PerCompanyBundle {
  funnels: FunnelData[]
  nonMetaFunnels: NonMetaFunnelData[]
  globalSales: number
  globalRevenue: number
  unattributedCount: number
  unattributedRevenue: number
  accountSpend: number
  errors: string[]
}

function NonMetaFunnelCard({ data }: { data: NonMetaFunnelData }) {
  const borderColor = FUNNEL_BORDER[data.id] ?? 'var(--border-soft)'
  const badgeClass = FUNNEL_BADGE_CLASS[data.id] ?? 'badge-muted'
  return (
    <div className="card overflow-hidden" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{data.name}</h3>
          {data.companyName && (
            <span className="badge badge-muted">{data.companyName}</span>
          )}
          <span className={`badge ${badgeClass}`}>non-Meta</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--border-soft)', borderTop: '1px solid var(--border-soft)' }}>
        <div style={{ background: 'var(--surface)' }} className="px-4 py-3">
          <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>Lead (AC)</div>
          <div className="num text-sm font-semibold">{fmtInt(data.leads_ac)}</div>
        </div>
        <div style={{ background: 'var(--surface)' }} className="px-4 py-3">
          <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>Vendite</div>
          <div className="num text-sm font-semibold" style={{ color: 'var(--ok)' }}>{fmtInt(data.sales_count)}</div>
        </div>
        <div style={{ background: 'var(--surface)' }} className="px-4 py-3">
          <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>Revenue</div>
          <div className="num text-sm font-semibold" style={{ color: 'var(--ok)' }}>{fmt(data.revenue, '€')}</div>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [range, setRange] = useState<DateRange>(defaultRange)
  const [funnels, setFunnels] = useState<FunnelData[]>([])
  const [nonMetaFunnels, setNonMetaFunnels] = useState<NonMetaFunnelData[]>([])
  const [globalSales, setGlobalSales] = useState(0)
  const [globalRevenue, setGlobalRevenue] = useState(0)
  const [unattributed, setUnattributed] = useState<{ count: number; revenue: number }>({ count: 0, revenue: 0 })
  const [accountSpend, setAccountSpend] = useState(0)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [acError, setAcError] = useState<string | null>(null)
  const [isAllMode, setIsAllMode] = useState(false)

  const fetchForCompany = useCallback(async (
    r: DateRange,
    companyOverride: string | null,
  ): Promise<PerCompanyBundle> => {
    const baseQs = `from=${r.from}&to=${r.to}`
    const qs = companyOverride ? `${baseQs}&company=${encodeURIComponent(companyOverride)}` : baseQs
    const errors: string[] = []
    try {
      const [metaRes, creativesRes, leadsRaw, salesRes, apptRes, accountSpendRes] = await Promise.all([
        fetch(`/api/marketing/meta/insights?${qs}`).then(r => r.json()).catch(() => []),
        fetch(`/api/marketing/meta/creatives?${qs}`).then(r => r.json()).catch(() => []),
        fetch(`/api/marketing/ac/leads?${qs}`).then(r => ({ ok: r.ok, status: r.status, data: r.json() })),
        fetch(`/api/marketing/ac/sales-contract?${qs}`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/marketing/crm/appointments?${qs}`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/marketing/meta/account-spend?${qs}`).then(r => r.json()).catch(() => ({ spend: 0 })),
      ])
      const leadsRes = await leadsRaw.data
      const apptByFunnelByAd: Record<string, Record<string, number>> = apptRes?.appointments ?? {}
      const confByFunnelByAd: Record<string, Record<string, number>> = apptRes?.confirms ?? {}

      if (!leadsRaw.ok) errors.push(`AC leads: HTTP ${leadsRaw.status}`)

      const leadsMap: Record<string, number> = {}
      const leadsByAdMap: Record<string, Record<string, number>> = {}
      for (const l of Array.isArray(leadsRes) ? leadsRes : []) {
        leadsMap[l.funnel] = l.leads ?? 0
        leadsByAdMap[l.funnel] = l.byAd ?? {}
      }

      const salesMap: Record<string, { count: number; revenue: number }> = {}
      for (const s of salesRes.perFunnel ?? []) {
        salesMap[s.funnel] = { count: s.count ?? 0, revenue: s.revenue ?? 0 }
      }
      const globalSalesTotal = salesRes.total?.count ?? 0
      const globalRevenueTotal = salesRes.total?.revenue ?? 0
      const unattributedSales = salesRes.unattributed?.count ?? 0
      const unattributedRevenue = salesRes.unattributed?.revenue ?? 0

      const attributionPerFunnel: Record<string, Record<string, { count: number; revenue: number }>> = salesRes.byFunnelByAd ?? {}

      const adsMap: Record<string, { ad_id: string; ad_name: string; adset_name: string; spend: number; impressions: number; clicks: number; cpm: number; ctr: number; cpc: number; leads_meta: number; effective_status: string; post_url: string | null }[]> = {}
      for (const f of Array.isArray(creativesRes) ? creativesRes : []) adsMap[f.funnel] = f.ads ?? []

      const metaList: FunnelMeta[] = Array.isArray(metaRes) ? (metaRes as FunnelMeta[]) : []
      const merged: FunnelData[] = metaList.map(m => {
        const leads_ac = leadsMap[m.funnel] ?? 0
        const cpl = leads_ac > 0 ? Math.round((m.spend / leads_ac) * 100) / 100 : 0
        const { count: sales_count, revenue } = salesMap[m.funnel] ?? { count: 0, revenue: 0 }
        const cps = sales_count > 0 ? Math.round((m.spend / sales_count) * 100) / 100 : 0
        const roas = m.spend > 0 && revenue > 0 ? Math.round((revenue / m.spend) * 100) / 100 : 0

        const funnelAds = adsMap[m.funnel] ?? []
        const funnelAdAttribution = attributionPerFunnel[m.funnel] ?? {}
        const funnelLeadsByAd = leadsByAdMap[m.funnel] ?? {}
        const funnelAppts = apptByFunnelByAd[m.funnel] ?? {}
        const funnelConfs = confByFunnelByAd[m.funnel] ?? {}
        const funnelApptTotal = Object.values(funnelAppts).reduce((s, n) => s + n, 0)
        const funnelConfTotal = Object.values(funnelConfs).reduce((s, n) => s + n, 0)

        const ads: AdRow[] = funnelAds.map(ad => {
          const adLeads = funnelLeadsByAd[ad.ad_name.trim()] ?? 0
          const adCpl = adLeads > 0 ? Math.round((ad.spend / adLeads) * 100) / 100 : 0
          const utmMatch = funnelAdAttribution[ad.ad_name.trim()] ?? { count: 0, revenue: 0 }
          const adSales = utmMatch.count
          const adRevenue = utmMatch.revenue
          const adCps = adSales > 0 ? Math.round((ad.spend / adSales) * 100) / 100 : 0
          const adRoas = ad.spend > 0 && adRevenue > 0 ? Math.round((adRevenue / ad.spend) * 100) / 100 : 0
          const adAppts = funnelAppts[ad.ad_name.trim()] ?? 0
          const adCpa = adAppts > 0 ? Math.round((ad.spend / adAppts) * 100) / 100 : 0
          const adConfs = funnelConfs[ad.ad_name.trim()] ?? 0
          const adCpconf = adConfs > 0 ? Math.round((ad.spend / adConfs) * 100) / 100 : 0
          return {
            ...ad,
            leads_ac: adLeads, cpl: adCpl,
            appointments: adAppts, cpa: adCpa,
            confirms: adConfs, cpconf: adCpconf,
            sales_count: adSales, revenue: adRevenue, cps: adCps, roas: adRoas,
            effective_status: ad.effective_status ?? 'UNKNOWN',
            post_url: ad.post_url ?? null,
          }
        })

        return {
          funnel: m.funnel, name: m.name,
          spend: m.spend, impressions: m.impressions, clicks: m.clicks,
          cpm: m.cpm, ctr: m.ctr, cpc: m.cpc,
          leads_ac, cpl, appointments: funnelApptTotal, confirms: funnelConfTotal,
          sales_count, revenue, cps, roas,
          ads, error: m.error,
        }
      })

      const nonMeta: NonMetaFunnelData[] = NON_META_FUNNELS.map((f) => ({
        id: f.id,
        name: f.name,
        leads_ac: leadsMap[f.id] ?? 0,
        sales_count: salesMap[f.id]?.count ?? 0,
        revenue: salesMap[f.id]?.revenue ?? 0,
      }))

      return {
        funnels: merged,
        nonMetaFunnels: nonMeta,
        globalSales: globalSalesTotal,
        globalRevenue: globalRevenueTotal,
        unattributedCount: unattributedSales,
        unattributedRevenue: unattributedRevenue,
        accountSpend: Number(accountSpendRes?.spend ?? 0),
        errors,
      }
    } catch (e) {
      errors.push(String(e))
      return { funnels: [], nonMetaFunnels: [], globalSales: 0, globalRevenue: 0, unattributedCount: 0, unattributedRevenue: 0, accountSpend: 0, errors }
    }
  }, [])

  const fetchData = useCallback(async (r: DateRange) => {
    setLoading(true)
    setAcError(null)
    try {
      const selRes = await fetch('/api/marketing/company/selection').then((res) => res.json()).catch(() => null)
      const mode = selRes?.mode as 'single' | 'all' | null
      const ids: string[] = Array.isArray(selRes?.activeCompanyIds) ? selRes.activeCompanyIds : []
      const displayMap: Record<string, string> = {}
      for (const c of selRes?.companies ?? []) displayMap[c.id] = c.display_name
      setIsAllMode(mode === 'all')

      if (mode !== 'all') {
        const result = await fetchForCompany(r, null)
        setFunnels(result.funnels)
        setNonMetaFunnels(result.nonMetaFunnels)
        setGlobalSales(result.globalSales)
        setGlobalRevenue(result.globalRevenue)
        setUnattributed({ count: result.unattributedCount, revenue: result.unattributedRevenue })
        setAccountSpend(result.accountSpend)
        if (result.errors.length) setAcError(result.errors.join(' · '))
      } else {
        const perCompany = await Promise.all(
          ids.map(async (cid) => ({ cid, data: await fetchForCompany(r, cid) })),
        )
        const allFunnels: FunnelData[] = []
        const allNonMeta: NonMetaFunnelData[] = []
        let sumSales = 0, sumRevenue = 0, sumUnattrCount = 0, sumUnattrRevenue = 0, sumAccountSpend = 0
        const errs: string[] = []
        for (const { cid, data } of perCompany) {
          const cname = displayMap[cid] ?? cid
          for (const f of data.funnels) allFunnels.push({ ...f, companyId: cid, companyName: cname })
          for (const f of data.nonMetaFunnels) allNonMeta.push({ ...f, companyId: cid, companyName: cname })
          sumSales += data.globalSales
          sumRevenue += data.globalRevenue
          sumUnattrCount += data.unattributedCount
          sumUnattrRevenue += data.unattributedRevenue
          sumAccountSpend += data.accountSpend
          for (const e of data.errors) errs.push(`[${cname}] ${e}`)
        }
        setFunnels(allFunnels)
        setNonMetaFunnels(allNonMeta)
        setGlobalSales(sumSales)
        setGlobalRevenue(sumRevenue)
        setUnattributed({ count: sumUnattrCount, revenue: sumUnattrRevenue })
        setAccountSpend(sumAccountSpend)
        if (errs.length) setAcError(errs.join(' · '))
      }
      setLastRefresh(new Date().toLocaleTimeString('it-IT'))
    } finally {
      setLoading(false)
    }
  }, [fetchForCompany])

  useEffect(() => { fetchData(range) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRangeChange(r: DateRange) { setRange(r); fetchData(r) }

  const totals = funnels.reduce((acc, d) => ({
    spend: acc.spend + d.spend,
    leads: acc.leads + d.leads_ac,
    impressions: acc.impressions + d.impressions,
    clicks: acc.clicks + d.clicks,
    salesMeta: acc.salesMeta + d.sales_count,
    revenueMeta: acc.revenueMeta + d.revenue,
  }), { spend: 0, leads: 0, impressions: 0, clicks: 0, salesMeta: 0, revenueMeta: 0 })

  const totalCpl = totals.leads > 0 ? Math.round((totals.spend / totals.leads) * 100) / 100 : 0
  const totalCps = totals.salesMeta > 0 ? Math.round((totals.spend / totals.salesMeta) * 100) / 100 : 0
  const totalRoas = totals.spend > 0 && totals.revenueMeta > 0
    ? Math.round((totals.revenueMeta / totals.spend) * 100) / 100 : 0

  const overallSpend = accountSpend > 0 ? accountSpend : totals.spend
  const overallCustomers = globalSales
  const overallRevenue = globalRevenue
  const overallCac = overallCustomers > 0 ? Math.round((overallSpend / overallCustomers) * 100) / 100 : 0
  const overallRoas = overallSpend > 0 && overallRevenue > 0
    ? Math.round((overallRevenue / overallSpend) * 100) / 100 : 0

  return (
    <div className="p-6 max-w-7xl">
      <div className="page-header mb-6">
        <p className="page-sub">
          Performance marketing
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

      <div className="card mb-4 overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-soft)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Riepilogo complessivo
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'var(--border-soft)' }}>
          <div style={{ background: 'var(--surface)' }} className="px-5 py-3">
            <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>Spend totale</div>
            <div className="num text-lg font-semibold">{fmt(overallSpend, '€')}</div>
          </div>
          <div style={{ background: 'var(--surface)' }} className="px-5 py-3">
            <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>Incasso totale</div>
            <div className="num text-lg font-semibold" style={{ color: 'var(--ok)' }}>{fmt(overallRevenue, '€')}</div>
          </div>
          <div style={{ background: 'var(--surface)' }} className="px-5 py-3">
            <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>CAC</div>
            <div className="num text-lg font-semibold">{overallCac > 0 ? fmt(overallCac, '€') : '—'}</div>
          </div>
          <div style={{ background: 'var(--surface)' }} className="px-5 py-3">
            <div className="text-xs mb-0.5" style={{ color: 'var(--faint)' }}>ROAS</div>
            <div className="num text-lg font-semibold" style={{ color: roasColor(overallRoas) }}>
              {overallRoas > 0 ? `${overallRoas.toFixed(2)}x` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 mb-6">
        <KpiCard label="Spend totale" value={fmt(totals.spend, '€')} icon={Euro} iconColor="var(--accent)" />
        <KpiCard label="Impressioni" value={fmtInt(totals.impressions)} icon={Eye} iconColor="#0369a1" />
        <KpiCard label="Click" value={fmtInt(totals.clicks)} icon={MousePointerClick} iconColor="#6d28d9" />
        <KpiCard label="Lead (AC)" value={fmtInt(totals.leads)} sub={totalCpl > 0 ? `CPL: ${fmt(totalCpl, '€')}` : undefined} icon={Users} iconColor="var(--ok)" />
        <KpiCard label="Vendite" value={fmtInt(totals.salesMeta)} sub={`Revenue: ${fmt(totals.revenueMeta, '€')}`} icon={TrendingUp} iconColor="var(--warn)" />
        <KpiCard label="CPS" value={totalCps > 0 ? fmt(totalCps, '€') : '—'} icon={Target} iconColor="#e11d48" />
        <KpiCard label="ROAS" value={totalRoas > 0 ? `${totalRoas.toFixed(2)}x` : '—'} icon={Target} iconColor={roasColor(totalRoas)} />
      </div>

      {acError && (
        <div className="mb-3 alert alert-err mono">⚠ Errore AC: {acError}</div>
      )}

      {loading && funnels.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--faint)' }}>
          Caricamento dati...
        </div>
      ) : (
        <div className="space-y-4">
          {funnels.map(f => <FunnelSection key={`${f.companyId ?? '_'}:${f.funnel}`} data={f} />)}
        </div>
      )}

      {nonMetaFunnels.length > 0 && (
        <div className="mt-6">
          <div className="px-1 mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Altre fonti
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {nonMetaFunnels.map((f) => (
              <NonMetaFunnelCard key={`${f.companyId ?? '_'}:${f.id}`} data={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
