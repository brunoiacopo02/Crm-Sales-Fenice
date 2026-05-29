'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, FileText } from 'lucide-react'
import DateRangePicker, { DateRange } from '@/components/marketing/DateRangePicker'
import { SingleCompanyGuard } from '@/components/marketing/SingleCompanyRequired'
import {
  roasMultiplier,
  roasColor,
  costColor,
  DEFAULT_TARGETS,
  MarketingTargets,
} from '@/lib/marketing/projections'

interface AdRow {
  ad_id: string
  ad_name: string
  campaign_name: string
  adset_name: string
  spend: number
  impressions: number
  clicks: number
  cpm: number
  ctr: number
  cpc: number
  leads_meta: number
  leads_ac: number
  appointments: number
  cpa: number
  confirms: number
  cpconf: number
  sales_count: number
  revenue: number
  cpl: number
  cps: number
  roas: number
  roas_totale: number
  funnel: string
  funnelName: string
  effective_status: string
  post_url: string | null
  script: string
  _adset_count?: number
}

type SortKey = keyof AdRow
type SortDir = 'asc' | 'desc'

function defaultRange(): DateRange {
  const d = new Date(); d.setDate(1)
  return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), label: 'Questo mese' }
}

function fmt(n: number, prefix = '', suffix = '', decimals = 2) {
  if (n === 0) return '—'
  return `${prefix}${n.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`
}
function fmtInt(n: number) { return n === 0 ? '—' : n.toLocaleString('it-IT') }

const FUNNEL_BADGE: Record<string, string> = {
  telegram: 'badge-sky', corso10ore: 'badge-violet', jobsimulator: 'badge-amber', other: 'badge-muted',
}

function buildColumns(mult: number): { key: SortKey; label: string; align?: string }[] {
  return [
    { key: 'ad_name', label: 'Ad / Creative', align: 'left' },
    { key: 'funnelName', label: 'Funnel', align: 'left' },
    { key: 'spend', label: 'Spend' },
    { key: 'leads_ac', label: 'Lead' },
    { key: 'cpl', label: 'CPL' },
    { key: 'appointments', label: 'Appt.' },
    { key: 'cpa', label: 'CPA' },
    { key: 'confirms', label: 'Conf.' },
    { key: 'cpconf', label: 'CPConf.' },
    { key: 'sales_count', label: 'Vend.' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'cps', label: 'CPS' },
    { key: 'roas', label: 'ROAS' },
    { key: 'roas_totale', label: `ROAS Tot. ×${mult.toFixed(2)}` },
    { key: 'script', label: 'Script', align: 'left' },
  ]
}

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown size={12} style={{ color: 'var(--faint)' }} />
  return dir === 'asc'
    ? <ArrowUp size={12} style={{ color: 'var(--accent)' }} />
    : <ArrowDown size={12} style={{ color: 'var(--accent)' }} />
}

function normalizeAdName(name: string): string {
  return name.trim().replace(/(\s*-\s*Copia(\s+\d+)?\s*)+$/i, '').trim()
}

export default function CreativePage() {
  const [range, setRange] = useState<DateRange>(defaultRange)
  const [rows, setRows] = useState<AdRow[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [funnelFilter, setFunnelFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active'>('all')
  const [allFunnels, setAllFunnels] = useState<{ id: string; name: string }[]>([])
  const [grouped, setGrouped] = useState(true)
  const [targets, setTargets] = useState<MarketingTargets>(DEFAULT_TARGETS)

  const fetchData = useCallback(async (r: DateRange) => {
    setLoading(true)
    try {
      const qs = `from=${r.from}&to=${r.to}`
      const [creativesRes, leadsRes, salesRes, apptRes, targetsRes, scriptsRes] = await Promise.all([
        fetch(`/api/marketing/meta/creatives?${qs}`).then((r) => r.json()),
        fetch(`/api/marketing/ac/leads?${qs}`).then((r) => r.json()),
        fetch(`/api/marketing/ac/sales-contract?${qs}`).then((r) => r.json()),
        fetch(`/api/marketing/crm/appointments?${qs}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/marketing/targets`).then((r) => r.json()).catch(() => DEFAULT_TARGETS),
        fetch(`/api/marketing/scripts`).then((r) => r.json()).catch(() => ({ scripts: [] })),
      ])
      const scriptsMap: Record<string, string> = {}
      for (const s of (scriptsRes.scripts ?? []) as { ad_name_normalized: string; script: string }[]) {
        scriptsMap[s.ad_name_normalized] = s.script
      }
      setTargets({
        aov: Number(targetsRes?.aov ?? DEFAULT_TARGETS.aov) || DEFAULT_TARGETS.aov,
        cac: Number(targetsRes?.cac ?? DEFAULT_TARGETS.cac) || DEFAULT_TARGETS.cac,
        cost_app: Number(targetsRes?.cost_app ?? DEFAULT_TARGETS.cost_app) || DEFAULT_TARGETS.cost_app,
        cost_conf: Number(targetsRes?.cost_conf ?? DEFAULT_TARGETS.cost_conf) || DEFAULT_TARGETS.cost_conf,
      })
      const apptByFunnelByAd: Record<string, Record<string, number>> = apptRes?.appointments ?? {}
      const confByFunnelByAd: Record<string, Record<string, number>> = apptRes?.confirms ?? {}

      setAllFunnels((creativesRes as { funnel: string; name: string }[]).map((f) => ({ id: f.funnel, name: f.name })))

      const acLeadsByAd: Record<string, Record<string, number>> = {}
      for (const l of leadsRes) acLeadsByAd[l.funnel] = l.byAd ?? {}

      const attributionPerFunnel: Record<string, Record<string, { count: number; revenue: number }>> = salesRes.byFunnelByAd ?? {}

      const mult = roasMultiplier(r.from, r.to)
      const allRows: AdRow[] = []
      for (const funnelData of creativesRes) {
        const funnelAds: {
          ad_id: string; ad_name: string; campaign_name: string; adset_name: string
          spend: number; impressions: number; clicks: number; cpm: number; ctr: number
          cpc: number; leads_meta: number; effective_status: string; post_url: string | null
        }[] = funnelData.ads ?? []

        const funnelLeadsByAd = acLeadsByAd[funnelData.funnel] ?? {}
        const funnelAppts = apptByFunnelByAd[funnelData.funnel] ?? {}
        const funnelConfs = confByFunnelByAd[funnelData.funnel] ?? {}

        for (const ad of funnelAds) {
          const adKey = ad.ad_name.trim()
          const leads_ac = funnelLeadsByAd[adKey] ?? 0
          const cpl = leads_ac > 0 ? Math.round((ad.spend / leads_ac) * 100) / 100 : 0
          const appointments = funnelAppts[adKey] ?? 0
          const cpa = appointments > 0 ? Math.round((ad.spend / appointments) * 100) / 100 : 0
          const confirms = funnelConfs[adKey] ?? 0
          const cpconf = confirms > 0 ? Math.round((ad.spend / confirms) * 100) / 100 : 0

          const funnelAttribution = attributionPerFunnel[funnelData.funnel] ?? {}
          const utmMatch = funnelAttribution[adKey] ?? { count: 0, revenue: 0 }
          const sales_count = utmMatch.count
          const revenue = utmMatch.revenue
          const cps = sales_count > 0 ? Math.round((ad.spend / sales_count) * 100) / 100 : 0
          const roas = ad.spend > 0 && revenue > 0 ? Math.round((revenue / ad.spend) * 100) / 100 : 0
          const roas_totale = ad.spend > 0 && revenue > 0
            ? Math.round((revenue * mult / ad.spend) * 100) / 100 : 0

          allRows.push({
            ...ad,
            leads_ac, cpl, appointments, cpa, confirms, cpconf,
            sales_count, revenue, cps, roas, roas_totale,
            funnel: funnelData.funnel,
            funnelName: funnelData.name,
            effective_status: ad.effective_status ?? 'UNKNOWN',
            post_url: ad.post_url ?? null,
            script: scriptsMap[normalizeAdName(ad.ad_name)] ?? '',
          })
        }
      }

      setRows(allRows)
      setLastRefresh(new Date().toLocaleTimeString('it-IT'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(range) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRangeChange(r: DateRange) { setRange(r); fetchData(r) }
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function aggregateRows(input: AdRow[]): AdRow[] {
    const map = new Map<string, AdRow[]>()
    for (const row of input) {
      const key = `${row.funnel}::${normalizeAdName(row.ad_name)}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.values()).map((group) => {
      const spend = Math.round(group.reduce((s, r) => s + r.spend, 0) * 100) / 100
      const uniqueByName = new Map<string, AdRow>()
      for (const r of group) {
        const k = r.ad_name.trim()
        if (!uniqueByName.has(k)) uniqueByName.set(k, r)
      }
      const unique = Array.from(uniqueByName.values())
      const leads_ac = unique.reduce((s, r) => s + r.leads_ac, 0)
      const appointments = unique.reduce((s, r) => s + r.appointments, 0)
      const confirms = unique.reduce((s, r) => s + r.confirms, 0)
      const sales_count = unique.reduce((s, r) => s + r.sales_count, 0)
      const revenue = unique.reduce((s, r) => s + r.revenue, 0)
      const cpl = leads_ac > 0 ? Math.round((spend / leads_ac) * 100) / 100 : 0
      const cpa = appointments > 0 ? Math.round((spend / appointments) * 100) / 100 : 0
      const cpconf = confirms > 0 ? Math.round((spend / confirms) * 100) / 100 : 0
      const cps = sales_count > 0 ? Math.round((spend / sales_count) * 100) / 100 : 0
      const roas = spend > 0 && revenue > 0 ? Math.round((revenue / spend) * 100) / 100 : 0
      const mult = roasMultiplier(range.from, range.to)
      const roas_totale = spend > 0 && revenue > 0 ? Math.round((revenue * mult / spend) * 100) / 100 : 0
      const isActive = group.some((r) => r.effective_status === 'ACTIVE')
      const display = group.reduce((shortest, r) => (r.ad_name.length < shortest.ad_name.length ? r : shortest), group[0])
      return {
        ...display,
        ad_name: normalizeAdName(display.ad_name),
        spend, leads_ac, appointments, confirms, sales_count, revenue, cpl, cpa, cpconf, cps, roas, roas_totale,
        effective_status: isActive ? 'ACTIVE' : 'PAUSED',
        post_url: group.find((r) => r.post_url)?.post_url ?? null,
        _adset_count: group.length,
      }
    })
  }

  const multiplier = roasMultiplier(range.from, range.to)
  const COLUMNS = buildColumns(multiplier)
  const baseRows = grouped ? aggregateRows(rows) : rows
  const filteredRows = baseRows
    .filter((r) => funnelFilter === 'all' || r.funnel === funnelFilter)
    .filter((r) => statusFilter === 'all' || r.effective_status === 'ACTIVE')

  const sortedRows = [...filteredRows].sort((a, b) => {
    const va = a[sortKey]
    const vb = b[sortKey]
    if (typeof va === 'string' && typeof vb === 'string') {
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    const na = Number(va)
    const nb = Number(vb)
    return sortDir === 'asc' ? na - nb : nb - na
  })

  const funnels = allFunnels.filter((f) => f.id !== 'other')
  const activeCount = baseRows
    .filter((r) => funnelFilter === 'all' || r.funnel === funnelFilter)
    .filter((r) => r.effective_status === 'ACTIVE').length

  return (
    <SingleCompanyGuard requireAc>
      <div className="p-6">
        <div className="page-header mb-6">
          <p className="page-sub">
            Performance per singolo ad
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

        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setFunnelFilter('all')} className={funnelFilter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}>Tutti i funnel</button>
            {funnels.map((f) => (
              <button key={f.id} onClick={() => setFunnelFilter(f.id)} className={funnelFilter === f.id ? 'btn btn-primary btn-sm' : 'btn btn-sm'}>
                {f.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--s2)' }}>
              <button onClick={() => setGrouped(true)} className="px-3 py-1 rounded-md text-xs font-medium" style={{ background: grouped ? 'var(--surface)' : 'transparent', color: grouped ? 'var(--text)' : 'var(--muted)' }}>Raggruppato</button>
              <button onClick={() => setGrouped(false)} className="px-3 py-1 rounded-md text-xs font-medium" style={{ background: !grouped ? 'var(--surface)' : 'transparent', color: !grouped ? 'var(--text)' : 'var(--muted)' }}>Per adset</button>
            </div>
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--s2)' }}>
              <button onClick={() => setStatusFilter('all')} className="px-3 py-1 rounded-md text-xs font-medium" style={{ background: statusFilter === 'all' ? 'var(--surface)' : 'transparent', color: statusFilter === 'all' ? 'var(--text)' : 'var(--muted)' }}>Tutte</button>
              <button onClick={() => setStatusFilter('active')} className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium" style={{ background: statusFilter === 'active' ? 'var(--ok-soft)' : 'transparent', color: statusFilter === 'active' ? 'var(--ok)' : 'var(--muted)' }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--ok)' }} />
                Solo attive ({activeCount})
              </button>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key} onClick={() => toggleSort(col.key)} className="sortable" style={{ textAlign: col.align === 'left' ? 'left' : 'right' }}>
                      <span className="flex items-center gap-1.5 justify-end">
                        {col.align === 'left' && <SortIcon col={col.key} sortKey={sortKey} dir={sortDir} />}
                        {col.label}
                        {col.align !== 'left' && <SortIcon col={col.key} sortKey={sortKey} dir={sortDir} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && sortedRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="text-center py-12" style={{ color: 'var(--faint)' }}>Caricamento dati...</td></tr>
                ) : sortedRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="text-center py-12" style={{ color: 'var(--faint)' }}>Nessun dato per il periodo selezionato</td></tr>
                ) : (
                  sortedRows.map((row, i) => (
                    <tr key={row.ad_id + i}>
                      <td>
                        <a href={row.post_url ?? `https://www.facebook.com/ads/library/?id=${row.ad_id}`} target="_blank" rel="noopener noreferrer" className="group block">
                          <div className="flex items-center gap-1.5">
                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: row.effective_status === 'ACTIVE' ? 'var(--ok)' : 'var(--faint)' }} />
                            <div className="font-medium text-xs leading-snug max-w-60 truncate flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                              {row.ad_name}
                              {row._adset_count && row._adset_count > 1 && (
                                <span className="flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-normal" style={{ color: 'var(--muted)', background: 'var(--s2)' }}>{row._adset_count} adset</span>
                              )}
                            </div>
                            <ExternalLink size={11} style={{ color: 'var(--faint)' }} className="flex-shrink-0" />
                          </div>
                        </a>
                      </td>
                      <td><span className={`badge ${FUNNEL_BADGE[row.funnel] ?? 'badge-muted'}`}>{row.funnelName}</span></td>
                      <td className="num text-right">{fmt(row.spend, '€')}</td>
                      <td className="num text-right">{fmtInt(row.leads_ac)}</td>
                      <td className="num text-right">{fmt(row.cpl, '€')}</td>
                      <td className="num text-right font-medium" style={{ color: '#0369a1' }}>{row.appointments > 0 ? fmtInt(row.appointments) : '—'}</td>
                      <td className="num text-right" style={{ color: row.appointments > 0 ? costColor(row.cpa, targets.cost_app) : undefined }}>{row.appointments > 0 ? fmt(row.cpa, '€') : '—'}</td>
                      <td className="num text-right font-medium" style={{ color: '#6d28d9' }}>{row.confirms > 0 ? fmtInt(row.confirms) : '—'}</td>
                      <td className="num text-right" style={{ color: row.confirms > 0 ? costColor(row.cpconf, targets.cost_conf) : undefined }}>{row.confirms > 0 ? fmt(row.cpconf, '€') : '—'}</td>
                      <td className="num text-right">{fmtInt(row.sales_count)}</td>
                      <td className="num text-right">{fmt(row.revenue, '€')}</td>
                      <td className="num text-right" style={{ color: row.sales_count > 0 ? costColor(row.cps, targets.cac) : undefined }}>{row.sales_count > 0 ? fmt(row.cps, '€') : '—'}</td>
                      <td className="num text-right font-medium" style={{ color: roasColor(row.roas) }}>{row.roas > 0 ? `${row.roas.toFixed(2)}x` : '—'}</td>
                      <td className="num text-right font-medium" style={{ color: roasColor(row.roas_totale) }}>{row.roas_totale > 0 ? `${row.roas_totale.toFixed(2)}x` : '—'}</td>
                      <td style={{ maxWidth: '280px' }}>
                        {row.script ? (
                          <details>
                            <summary className="flex items-center gap-1 cursor-pointer text-xs truncate" style={{ color: 'var(--text)', maxWidth: '280px' }} title={row.script}>
                              <FileText size={11} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                              <span className="truncate">{row.script}</span>
                            </summary>
                            <div className="text-xs mt-1 p-2 rounded" style={{ background: 'var(--s2)', color: 'var(--text)', whiteSpace: 'pre-wrap', maxWidth: '420px', maxHeight: '200px', overflowY: 'auto' }}>{row.script}</div>
                          </details>
                        ) : <span style={{ color: 'var(--faint)' }}>—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SingleCompanyGuard>
  )
}
