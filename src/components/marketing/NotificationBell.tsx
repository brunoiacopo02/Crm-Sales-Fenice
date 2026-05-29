'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, AlertTriangle, AlertCircle } from 'lucide-react'

type AlertStatus = 'ok' | 'pre-alert' | 'alert'

interface LeadBlock {
  key: string
  label: string
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  deviationToday: number | null
}

interface RoasBlock {
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  deviationToday: number | null
}

interface AlertsResponse {
  leads: LeadBlock[]
  roas: RoasBlock
}

interface NotificationItem {
  id: string
  status: 'alert' | 'pre-alert'
  title: string
  subtitle: string
}

const POLL_INTERVAL_MS = 60_000

function fmtPct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return '—'
  const v = n * 100
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function buildItems(data: AlertsResponse): NotificationItem[] {
  const items: NotificationItem[] = []
  for (const b of data.leads) {
    if (b.status === 'ok' || b.monthlyTarget <= 0) continue
    items.push({
      id: `lead-${b.key}`,
      status: b.status,
      title: `Lead ${b.label}`,
      subtitle: `Scostamento ${fmtPct(b.deviationToday)} · ${b.consecutiveDaysBelow} giorni sotto −10%`,
    })
  }
  const r = data.roas
  if (r.status !== 'ok' && r.monthlyTarget > 0) {
    items.push({
      id: 'roas',
      status: r.status,
      title: 'ROAS Marketing',
      subtitle: `Scostamento ${fmtPct(r.deviationToday)} · ${r.consecutiveDaysBelow} giorni sotto −15%`,
    })
  }
  items.sort((a, b) => (a.status === b.status ? 0 : a.status === 'alert' ? -1 : 1))
  return items
}

export default function NotificationBell() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/marketing/alerts', { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as AlertsResponse
        if (cancelled) return
        setItems(buildItems(j))
        setLoaded(true)
      } catch {
        // silent — polling retries
      }
    }
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const alertCount = items.filter((i) => i.status === 'alert').length
  const preAlertCount = items.filter((i) => i.status === 'pre-alert').length
  const total = items.length
  const badgeColor = alertCount > 0 ? '#ef4444' : preAlertCount > 0 ? '#f59e0b' : null

  function handleItemClick() {
    setOpen(false)
    router.push('/marketing/alert')
  }

  return (
    <div className="notification-wrap" ref={ref} style={{ position: 'relative' }}>
      <button
        className="notification-bell"
        onClick={() => setOpen((o) => !o)}
        title={total > 0 ? `${total} notifiche` : 'Nessuna notifica'}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-soft)',
          borderRadius: 8,
          padding: '6px 8px',
          cursor: 'pointer',
          color: 'var(--text)',
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Bell size={16} />
        {badgeColor && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: badgeColor,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div
          className="notification-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 320,
            maxWidth: 380,
            background: 'var(--surface)',
            border: '1px solid var(--border-soft)',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-soft)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Notifiche</span>
            {!loaded && <span style={{ color: 'var(--faint)', fontWeight: 400 }}>caricamento…</span>}
          </div>

          {items.length === 0 ? (
            <div
              style={{
                padding: '20px 12px',
                fontSize: 13,
                color: 'var(--faint)',
                textAlign: 'center',
              }}
            >
              {loaded ? 'Nessun alert attivo. Tutto a posto. ✓' : '—'}
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {items.map((it) => {
                const isAlert = it.status === 'alert'
                const Icon = isAlert ? AlertTriangle : AlertCircle
                const color = isAlert ? '#ef4444' : '#f59e0b'
                return (
                  <button
                    key={it.id}
                    onClick={handleItemClick}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-soft)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      color: 'var(--text)',
                    }}
                  >
                    <Icon size={16} style={{ color, marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        <span>{it.title}</span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: isAlert ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                            color,
                            letterSpacing: 0.4,
                          }}
                        >
                          {isAlert ? 'ALERT' : 'PRE-ALERT'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {it.subtitle}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={handleItemClick}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid var(--border-soft)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--accent)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            Apri pagina Alert →
          </button>
        </div>
      )}
    </div>
  )
}
