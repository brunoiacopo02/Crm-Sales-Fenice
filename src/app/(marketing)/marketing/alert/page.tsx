'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, AlertCircle, CheckCircle2, RefreshCw, Info } from 'lucide-react'
import { SingleCompanyGuard } from '@/components/marketing/SingleCompanyRequired'

type AlertStatus = 'ok' | 'pre-alert' | 'alert'

interface DayPoint {
  date: string
  actual: number
  proportionalTarget: number
  deviation: number | null
  belowThreshold: boolean
}

interface LeadBlock {
  key: string
  label: string
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  daysInMonthSoFar: number
  totalDaysInMonth: number
  proportionalTargetToday: number
  actualToday: number
  deviationToday: number | null
  series: DayPoint[]
}

interface RoasBlock {
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  spendMTD: number
  revenueMTD: number
  roasToday: number | null
  deviationToday: number | null
  series: (DayPoint & { spend: number; revenue: number; roas: number | null })[]
}

interface AlertsResponse {
  monthStart: string
  today: string
  daysInMonthSoFar: number
  totalDaysInMonth: number
  thresholds: { lead: number; roas: number; consecutiveDaysForAlert: number }
  leads: LeadBlock[]
  roas: RoasBlock
}

function fmtInt(n: number) { return n.toLocaleString('it-IT') }
function fmtMoney(n: number) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n) }
function fmtPct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return '—'
  const v = n * 100
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}
function fmtDayShort(iso: string) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}

function StatusBadge({ status }: { status: AlertStatus }) {
  if (status === 'alert') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
        style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
        <AlertTriangle size={12} /> ALERT
      </span>
    )
  }
  if (status === 'pre-alert') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
        style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
        <AlertCircle size={12} /> PRE-ALERT
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
      <CheckCircle2 size={12} /> OK
    </span>
  )
}

function devColor(deviation: number | null, threshold: number): string {
  if (deviation === null) return 'var(--faint)'
  if (deviation < threshold) return '#ef4444'
  if (deviation < 0) return '#f59e0b'
  return 'var(--ok)'
}

const PROMEMORIA = [
  { title: 'CPL/Lead in fase di lancio', body: 'Se CPL > -15% o lead < -10% ogni 2 giorni → intervenire.' },
  { title: 'Task non gestite dal team', body: 'Se membri del reparto non svolgono task per ≥ 3 volte → richiamare.' },
  { title: 'Membro del team in uscita', body: 'Da segnalare appena saputo. Tracciato manualmente.' },
  { title: 'Crash dei sistemi', body: 'Crash > 6h → escalation immediata.' },
]

export default function AlertPage() {
  const [data, setData] = useState<AlertsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/marketing/alerts')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setData(j as AlertsResponse)
      setLastRefresh(new Date().toLocaleTimeString('it-IT'))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <SingleCompanyGuard requireAc>
      <div className="p-6">
        <div className="page-header mb-6">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} style={{ color: 'var(--accent)' }} />
              <h1 className="page-title">Alert</h1>
            </div>
            <p className="page-sub">
              Stato del mese corrente vs target. Lead &lt; −10% per ≥ 7 giorni consecutivi → <strong>ALERT</strong>.
              {lastRefresh && <span className="ml-2" style={{ color: 'var(--faint)' }}>· aggiornato alle {lastRefresh}</span>}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="btn btn-primary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Caricamento...' : 'Aggiorna'}
          </button>
        </div>

        {error && <div className="alert alert-error mb-4">{error}</div>}

        {data && (
          <>
            <section className="mb-8">
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text)' }}>
                Flusso Lead — questo mese ({data.daysInMonthSoFar}/{data.totalDaysInMonth} giorni)
              </h2>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Funnel</th>
                        <th>Stato</th>
                        <th style={{ textAlign: 'right' }}>Target mensile</th>
                        <th style={{ textAlign: 'right' }}>Target proporz. oggi</th>
                        <th style={{ textAlign: 'right' }}>Lead MTD</th>
                        <th style={{ textAlign: 'right' }}>Scostamento</th>
                        <th style={{ textAlign: 'right' }}>Giorni sotto −10%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leads.map((b) => (
                        <tr key={b.key}>
                          <td className="font-medium">{b.label}</td>
                          <td>{b.monthlyTarget > 0 ? <StatusBadge status={b.status} /> : <span className="text-xs" style={{ color: 'var(--faint)' }}>target non impostato</span>}</td>
                          <td className="num text-right">{fmtInt(b.monthlyTarget)}</td>
                          <td className="num text-right" style={{ color: 'var(--muted)' }}>{b.monthlyTarget > 0 ? b.proportionalTargetToday.toFixed(1) : '—'}</td>
                          <td className="num text-right font-semibold">{fmtInt(b.actualToday)}</td>
                          <td className="num text-right font-semibold" style={{ color: devColor(b.deviationToday, data.thresholds.lead) }}>{fmtPct(b.deviationToday)}</td>
                          <td className="num text-right">
                            <span style={{
                              color: b.consecutiveDaysBelow >= data.thresholds.consecutiveDaysForAlert ? '#ef4444' : b.consecutiveDaysBelow > 0 ? '#f59e0b' : 'var(--faint)',
                            }}>
                              {b.consecutiveDaysBelow}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text)' }}>
                ROAS Complessivo Marketing — questo mese
              </h2>
              <div className="card p-4 mb-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">Stato:</span>
                    {data.roas.monthlyTarget > 0 ? <StatusBadge status={data.roas.status} /> : <span className="text-xs" style={{ color: 'var(--faint)' }}>ROAS target non impostato</span>}
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>Target</div>
                      <div className="font-semibold">{data.roas.monthlyTarget.toFixed(2)}x</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>ROAS MTD</div>
                      <div className="font-semibold">{data.roas.roasToday !== null ? `${data.roas.roasToday.toFixed(2)}x` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>Scostamento</div>
                      <div className="font-semibold" style={{ color: devColor(data.roas.deviationToday, data.thresholds.roas) }}>{fmtPct(data.roas.deviationToday)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>Spend MTD</div>
                      <div className="font-semibold">{fmtMoney(data.roas.spendMTD)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>Revenue MTD</div>
                      <div className="font-semibold" style={{ color: 'var(--ok)' }}>{fmtMoney(data.roas.revenueMTD)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Giorno</th>
                        <th style={{ textAlign: 'right' }}>Spend MTD</th>
                        <th style={{ textAlign: 'right' }}>Revenue MTD</th>
                        <th style={{ textAlign: 'right' }}>ROAS</th>
                        <th style={{ textAlign: 'right' }}>Scostamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.roas.series.slice(-14).map((p) => (
                        <tr key={p.date}>
                          <td className="text-xs">{fmtDayShort(p.date)}</td>
                          <td className="num text-right text-xs">{fmtMoney(p.spend)}</td>
                          <td className="num text-right text-xs" style={{ color: 'var(--ok)' }}>{fmtMoney(p.revenue)}</td>
                          <td className="num text-right text-xs font-medium">{p.roas !== null ? `${p.roas.toFixed(2)}x` : '—'}</td>
                          <td className="num text-right text-xs font-medium" style={{ color: devColor(p.deviation, data.thresholds.roas) }}>{fmtPct(p.deviation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text)' }}>
                Promemoria operativi — da monitorare manualmente
              </h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                {PROMEMORIA.map((p) => (
                  <div key={p.title} className="card p-4">
                    <div className="flex items-start gap-2 mb-2">
                      <Info size={16} style={{ color: 'var(--accent)', marginTop: 2 }} />
                      <div className="text-sm font-semibold">{p.title}</div>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{p.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </SingleCompanyGuard>
  )
}
