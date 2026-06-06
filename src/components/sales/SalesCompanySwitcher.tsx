'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2 } from 'lucide-react'

interface Company { id: string; display_name: string }

async function selectCompany(companyId: string) {
  await fetch('/api/company/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  })
}

/** Picker a pulsantoni per la pagina /seleziona-azienda. */
export function CompanyPicker({ companies }: { companies: Company[] }) {
  const [busy, setBusy] = useState(false)
  async function pick(id: string) {
    if (busy) return
    setBusy(true)
    await selectCompany(id)
    window.location.href = '/'
  }
  return (
    <div className="flex flex-col gap-3">
      {companies.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={busy}
          onClick={() => pick(c.id)}
          className="flex items-center gap-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-brand-orange hover:bg-orange-50 transition disabled:opacity-50"
        >
          <Building2 className="w-5 h-5 text-brand-orange" />
          <span className="font-medium text-gray-900">{c.display_name}</span>
        </button>
      ))}
    </div>
  )
}

/** Dropdown in topbar. Mostra il badge azienda; se canSwitch, permette il cambio. */
export function SalesCompanySwitcher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [canSwitch, setCanSwitch] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])

  useEffect(() => {
    fetch('/api/company/selection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setActive(d.active ?? null)
        setCanSwitch(!!d.canSwitch)
        setCompanies(d.companies ?? [])
      })
      .catch(() => {})
  }, [])

  const label = companies.find((c) => c.id === active)?.display_name ?? active ?? '—'

  async function pick(id: string) {
    if (busy || id === active) { setOpen(false); return }
    setBusy(true)
    await selectCompany(id)
    setOpen(false)
    router.refresh()
    window.location.reload()
  }

  // Badge statico se non può cambiare (utente mono-azienda).
  if (!canSwitch) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange">
        <Building2 className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange hover:bg-orange-200 transition"
      >
        <Building2 className="w-3.5 h-3.5" />
        <span>{label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 rounded-md border border-gray-200 bg-white shadow-lg z-50">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-orange-50 ${c.id === active ? 'font-semibold text-brand-orange' : 'text-gray-700'}`}
            >
              {c.display_name}{c.id === active ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
