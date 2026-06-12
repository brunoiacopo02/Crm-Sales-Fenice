'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2, Layers, ArrowLeftRight, Loader2 } from 'lucide-react'
import { getCompanySwitchSummary, type CompanySwitchSummary } from '@/app/actions/companySummaryActions'

// Sentinella "Tutte le aziende". Duplicata client-side per non importare
// @/lib/tenancy (modulo server-only). Deve combaciare con ALL_COMPANIES.
const ALL_COMPANIES = '__all__'

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
  const [summary, setSummary] = useState<CompanySwitchSummary[]>([])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    fetch('/api/company/selection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setActive(d.active ?? null)
        setCanSwitch(!!d.canSwitch)
        setCompanies(d.companies ?? [])
        // Mini-riassunto per azienda (panoramica rapida senza switchare).
        if (d.canSwitch) {
          const loadSummary = () => getCompanySwitchSummary().then(setSummary).catch(() => {})
          loadSummary()
          interval = setInterval(loadSummary, 120_000)
        }
      })
      .catch(() => {})
    return () => { if (interval) clearInterval(interval) }
  }, [])

  const isAll = active === ALL_COMPANIES
  const label = companies.find((c) => c.id === active)?.display_name ?? active ?? '—'
  const summaryOf = (id: string) => summary.find((s) => s.companyId === id)

  async function pick(id: string) {
    if (busy || id === active) { setOpen(false); return }
    setBusy(true)
    await selectCompany(id)
    setOpen(false)
    // "Tutte le aziende" porta direttamente alla Panoramica gruppo (le pagine
    // operative sono bloccate in questa modalità). Negli altri casi, reload.
    if (id === ALL_COMPANIES) {
      window.location.href = '/panoramica-generale'
      return
    }
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

  // Switch istantaneo a un click: utente con esattamente 2 aziende reali e
  // senza voce "Tutte le aziende" (QA Conferme 2026-06-12). Il pulsante mostra
  // anche i numeri chiave dell'altra azienda (app oggi · richiami in scadenza).
  const realCompanies = companies.filter((c) => c.id !== ALL_COMPANIES)
  const hasAllOption = companies.some((c) => c.id === ALL_COMPANIES)
  if (!hasAllOption && realCompanies.length === 2 && active && active !== ALL_COMPANIES) {
    const other = realCompanies.find((c) => c.id !== active)
    if (other) {
      const s = summaryOf(other.id)
      return (
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange">
            <Building2 className="w-3.5 h-3.5" />
            <span>{label}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => pick(other.id)}
            title={`Passa subito a ${other.display_name}`}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:border-brand-orange hover:text-brand-orange disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
            <span>{other.display_name}</span>
            {s && (s.apptToday > 0 || s.richiamiDue > 0) && (
              <span className="flex items-center gap-1 text-[10px] font-bold">
                {s.apptToday > 0 && (
                  <span className="rounded bg-emerald-100 px-1 py-0.5 text-emerald-700" title={`${s.apptToday} appuntamenti oggi su ${other.display_name}`}>
                    {s.apptToday} app
                  </span>
                )}
                {s.richiamiDue > 0 && (
                  <span className="rounded bg-sky-100 px-1 py-0.5 text-sky-700" title={`${s.richiamiDue} richiami in scadenza su ${other.display_name}`}>
                    {s.richiamiDue} rich
                  </span>
                )}
              </span>
            )}
          </button>
        </div>
      )
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange hover:bg-orange-200 transition"
      >
        {isAll ? <Layers className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
        <span>{label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 rounded-md border border-gray-200 bg-white shadow-lg z-50 overflow-hidden">
          {companies.map((c) => {
            const all = c.id === ALL_COMPANIES
            const s = all ? undefined : summaryOf(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                className={`flex w-full items-center gap-2 text-left px-3 py-2 text-sm hover:bg-orange-50 ${all ? 'border-t border-gray-200' : ''} ${c.id === active ? 'font-semibold text-brand-orange' : 'text-gray-700'}`}
              >
                {all ? <Layers className="w-3.5 h-3.5 shrink-0" /> : <Building2 className="w-3.5 h-3.5 shrink-0 opacity-60" />}
                <span className="flex-1">{c.display_name}</span>
                {s && (s.apptToday > 0 || s.richiamiDue > 0) && (
                  <span className="flex items-center gap-1 text-[10px] font-bold">
                    {s.apptToday > 0 && <span className="rounded bg-emerald-100 px-1 py-0.5 text-emerald-700">{s.apptToday} app</span>}
                    {s.richiamiDue > 0 && <span className="rounded bg-sky-100 px-1 py-0.5 text-sky-700">{s.richiamiDue} rich</span>}
                  </span>
                )}
                {c.id === active && <span>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
