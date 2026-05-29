'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Mail, Phone, ExternalLink, Search, Trash2 } from 'lucide-react'
import DateRangePicker, { DateRange } from '@/components/marketing/DateRangePicker'

interface Sale {
  contact_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  revenue: number
  contract_date: string
  lead_date: string
  provenienza_raw: string
  funnel_id: string | null
  ad_name: string | null
  campaign_name: string | null
  adset_name: string | null
  post_url: string | null
  meta_ad_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  companyId?: string | null
  companyName?: string | null
}

const FUNNEL_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  corso10ore: 'Corso 10 Ore',
  jobsimulator: 'Job Simulator',
}

const FUNNEL_BADGE: Record<string, string> = {
  telegram: 'badge-sky',
  corso10ore: 'badge-violet',
  jobsimulator: 'badge-amber',
}

function defaultRange(): DateRange {
  const d = new Date(); d.setDate(1)
  return { from: d.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), label: 'Questo mese' }
}

function fmtMoney(n: number) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n) }

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fullName(s: Sale) {
  const n = `${s.first_name} ${s.last_name}`.trim()
  return n || '(senza nome)'
}

export default function VenditePage() {
  const [range, setRange] = useState<DateRange>(defaultRange)
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [funnelFilter, setFunnelFilter] = useState<string>('all')
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isAllMode, setIsAllMode] = useState(false)

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

      const baseQs = `from=${r.from}&to=${r.to}`
      const activeIds = mode === 'all' ? ids : [null as string | null]

      const results = await Promise.all(
        activeIds.map(async (cid) => {
          const qs = cid ? `${baseQs}&company=${encodeURIComponent(cid)}` : baseQs
          const res = await fetch(`/api/marketing/sales/list?${qs}`)
          const data = await res.json().catch(() => ({ sales: [], error: `HTTP ${res.status}` }))
          return { cid, data }
        }),
      )

      const allSales: Sale[] = []
      const errs: string[] = []
      for (const { cid, data } of results) {
        const cidForTag = cid ?? (selRes?.companyId as string | null) ?? null
        const cname = cidForTag ? (displayMap[cidForTag] ?? cidForTag) : null
        const tag = mode === 'all'
        for (const s of (data.sales as Sale[]) ?? []) {
          allSales.push(tag ? { ...s, companyId: cidForTag, companyName: cname } : s)
        }
        if (data.error) errs.push(cname ? `[${cname}] ${data.error}` : String(data.error))
      }
      allSales.sort((a, b) => (a.contract_date < b.contract_date ? 1 : -1))
      setSales(allSales)
      if (errs.length) setError(errs.join(' · '))
      setLastRefresh(new Date().toLocaleTimeString('it-IT'))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(range) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRangeChange(r: DateRange) { setRange(r); fetchData(r) }

  async function handleDelete(sale: Sale) {
    const name = fullName(sale)
    const value = sale.revenue > 0 ? ` (${fmtMoney(sale.revenue)})` : ''
    const ok = window.confirm(
      `Eliminare la vendita di ${name}${value}?\n\nIl contatto resta in AC, ma viene escluso dai conteggi.`,
    )
    if (!ok) return
    setDeletingId(sale.contact_id)
    const before = sales
    setSales((s) => s.filter((x) => !(x.contact_id === sale.contact_id && (x.companyId ?? null) === (sale.companyId ?? null))))
    try {
      const res = await fetch(`/api/marketing/sales/${sale.contact_id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.error) {
        setSales(before)
        setError(body.error || `Errore HTTP ${res.status}`)
      }
    } catch (e) {
      setSales(before)
      setError(String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = sales
    .filter((s) => funnelFilter === 'all' || s.funnel_id === funnelFilter)
    .filter((s) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        s.first_name.toLowerCase().includes(q) ||
        s.last_name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q) ||
        (s.ad_name ?? '').toLowerCase().includes(q) ||
        (s.campaign_name ?? '').toLowerCase().includes(q) ||
        (s.adset_name ?? '').toLowerCase().includes(q)
      )
    })

  const totalRevenue = filtered.reduce((s, x) => s + x.revenue, 0)

  return (
    <div className="p-6">
      <div className="page-header mb-6">
        <p className="page-sub">
          Vendite chiuse nel periodo
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--faint)' }}>Vendite</div>
          <div className="text-2xl font-semibold mt-1">{filtered.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--faint)' }}>Revenue</div>
          <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--ok)' }}>{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--faint)' }}>Valore medio</div>
          <div className="text-2xl font-semibold mt-1">{filtered.length > 0 ? fmtMoney(totalRevenue / filtered.length) : '—'}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFunnelFilter('all')} className={funnelFilter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}>Tutti i funnel</button>
          {['telegram', 'corso10ore', 'jobsimulator'].map((id) => (
            <button key={id} onClick={() => setFunnelFilter(id)} className={funnelFilter === id ? 'btn btn-primary btn-sm' : 'btn btn-sm'}>
              {FUNNEL_NAMES[id]}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--faint)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca nome, email, telefono, ad..." className="input" style={{ paddingLeft: '2rem', minWidth: 280 }} />
        </div>
      </div>

      {error && <div className="mb-4 alert alert-warn">Errore: {error}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                {isAllMode && <th>Azienda</th>}
                <th>Funnel</th>
                <th style={{ textAlign: 'right' }}>Valore</th>
                <th>Chiusura</th>
                <th>Lead</th>
                <th>Campagna</th>
                <th>Adset</th>
                <th>Creative</th>
                <th style={{ width: 48 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 ? (
                <tr><td colSpan={isAllMode ? 10 : 9} className="text-center py-12" style={{ color: 'var(--faint)' }}>Caricamento dati...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={isAllMode ? 10 : 9} className="text-center py-12" style={{ color: 'var(--faint)' }}>Nessuna vendita nel periodo</td></tr>
              ) : (
                filtered.map((s) => (
                  <tr key={`${s.companyId ?? '_'}:${s.contact_id}`}>
                    <td>
                      <div className="font-medium text-sm" style={{ color: 'var(--text)' }}>{fullName(s)}</div>
                      <div className="flex items-center gap-3 text-xs mt-1 flex-wrap" style={{ color: 'var(--muted)' }}>
                        {s.email && (
                          <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:underline" title={s.email}>
                            <Mail size={11} /><span className="truncate max-w-48">{s.email}</span>
                          </a>
                        )}
                        {s.phone && (
                          <a href={`tel:${s.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 hover:underline">
                            <Phone size={11} />{s.phone}
                          </a>
                        )}
                      </div>
                    </td>
                    {isAllMode && (
                      <td>{s.companyName ? <span className="badge badge-muted">{s.companyName}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    )}
                    <td>
                      {s.funnel_id ? (
                        <span className={`badge ${FUNNEL_BADGE[s.funnel_id] ?? 'badge-muted'}`}>{FUNNEL_NAMES[s.funnel_id] ?? s.funnel_id}</span>
                      ) : <span className="badge badge-muted" title={s.provenienza_raw || ''}>—</span>}
                    </td>
                    <td className="num text-right font-medium" style={{ color: s.revenue > 0 ? 'var(--ok)' : 'var(--faint)' }}>
                      {s.revenue > 0 ? fmtMoney(s.revenue) : '—'}
                    </td>
                    <td className="text-xs">{fmtDate(s.contract_date)}</td>
                    <td className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(s.lead_date)}</td>
                    <td className="text-xs">{s.campaign_name ? <span className="truncate inline-block max-w-56" title={s.campaign_name}>{s.campaign_name}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td className="text-xs">{s.adset_name ? <span className="truncate inline-block max-w-48" title={s.adset_name}>{s.adset_name}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td className="text-xs">
                      {s.ad_name ? (
                        s.post_url ? (
                          <a href={s.post_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline truncate max-w-56" style={{ color: 'var(--accent)' }} title={s.ad_name}>
                            <span className="truncate">{s.ad_name}</span><ExternalLink size={10} className="flex-shrink-0" />
                          </a>
                        ) : <span className="truncate inline-block max-w-56" title={s.ad_name}>{s.ad_name}</span>
                      ) : <span style={{ color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td className="text-right">
                      <button onClick={() => handleDelete(s)} disabled={deletingId === s.contact_id} title="Elimina vendita" className="inline-flex items-center justify-center w-7 h-7 rounded disabled:opacity-40" style={{ color: 'var(--muted)' }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--border-soft)', color: 'var(--faint)' }}>
            {filtered.length} vendite · ordinate per data chiusura più recente
          </div>
        )}
      </div>
    </div>
  )
}
