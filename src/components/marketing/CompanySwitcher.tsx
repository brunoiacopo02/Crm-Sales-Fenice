'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2 } from 'lucide-react'

interface Company {
  id: string
  display_name: string
  short_code: string
}

interface Props {
  /** ID azienda corrente o 'all'. Se undefined, mostra "Seleziona azienda". */
  current?: string
  /** Mostra il selettore solo a super-admin (area='both'). */
  canSwitch: boolean
}

export function CompanySwitcher({ current, canSwitch }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canSwitch) return
    if (!open || companies.length) return
    fetch('/api/marketing/companies')
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => {})
  }, [open, companies.length, canSwitch])

  const currentLabel =
    current === 'all'
      ? 'Tutte le aziende'
      : companies.find((c) => c.id === current)?.display_name ?? (current ?? 'Seleziona azienda')

  async function pick(companyId: string) {
    if (busy) return
    setBusy(true)
    await fetch('/api/marketing/company/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    })
    setOpen(false)
    setBusy(false)
    router.refresh()
    // Reload completo: alcune query server-side leggono il cookie all'inizio
    window.location.reload()
  }

  // Single-tenant marketing users: mostra solo il nome statico.
  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
        <Building2 className="w-4 h-4" />
        <span>{currentLabel}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md transition"
        style={{ color: 'var(--text)', background: 'var(--s2)' }}
      >
        <Building2 className="w-4 h-4" />
        <span>{currentLabel}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-56 rounded-md shadow-lg z-50"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className="w-full text-left px-3 py-2 text-sm transition"
              style={{
                color: current === c.id ? 'var(--accent-text)' : 'var(--text)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {c.display_name}
              {current === c.id ? ' ✓' : ''}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--border-soft)' }} />
          <button
            type="button"
            onClick={() => pick('all')}
            className="w-full text-left px-3 py-2 text-sm"
            style={{
              color: current === 'all' ? 'var(--accent-text)' : 'var(--text)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Tutte le aziende{current === 'all' ? ' ✓' : ''}
          </button>
        </div>
      )}
    </div>
  )
}
