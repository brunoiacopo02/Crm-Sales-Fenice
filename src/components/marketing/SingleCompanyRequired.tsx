'use client'

import { useEffect, useState, ReactNode } from 'react'

interface Company {
  id: string
  display_name: string
}

export function SingleCompanyRequired() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/marketing/company/selection')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.companies)) setCompanies(d.companies)
      })
      .catch(() => {})
  }, [])

  async function pick(id: string) {
    setBusy(true)
    try {
      await fetch('/api/marketing/company/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: id }),
      })
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6">
      <div
        className="rounded-lg border p-5 max-w-2xl"
        style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft, rgba(217,119,6,0.08))' }}
      >
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>
          Seleziona una singola azienda
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          Questa sezione mostra dati specifici di una singola azienda. La vista &ldquo;Tutte le aziende&rdquo;
          non è supportata qui. Scegli un&apos;azienda per continuare.
        </p>
        <div className="flex flex-wrap gap-2">
          {companies.map((c) => (
            <button key={c.id} disabled={busy} onClick={() => pick(c.id)} className="btn btn-sm">
              {c.display_name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AcCredentialsRequired({
  companyName,
  companyId,
}: {
  companyName: string
  companyId: string
}) {
  const upper = companyId.toUpperCase().replace(/-/g, '_')
  return (
    <div className="p-6">
      <div
        className="rounded-lg border p-5 max-w-2xl"
        style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft, rgba(217,119,6,0.08))' }}
      >
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>
          ActiveCampaign non configurato per {companyName}
        </h2>
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
          Questa pagina mostra dati provenienti da ActiveCampaign. Per l&apos;azienda{' '}
          <strong>{companyName}</strong> non è ancora configurata l&apos;integrazione AC.
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Imposta su Vercel le variabili d&apos;ambiente:
        </p>
        <ul className="text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
          <li>· AC_API_URL_{upper}</li>
          <li>· AC_API_KEY_{upper}</li>
        </ul>
      </div>
    </div>
  )
}

interface Selection {
  mode: 'single' | 'all' | null
  companyId: string | null
  companyName: string | null
  hasAcCredentials: boolean
}

export function SingleCompanyGuard({
  children,
  requireAc = false,
}: {
  children: ReactNode
  requireAc?: boolean
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'block' | 'no_ac'>('loading')
  const [sel, setSel] = useState<Selection | null>(null)

  useEffect(() => {
    fetch('/api/marketing/company/selection')
      .then((r) => r.json())
      .then((d: Selection) => {
        setSel(d)
        if (d?.mode === 'all') setState('block')
        else if (requireAc && d?.mode === 'single' && !d.hasAcCredentials) setState('no_ac')
        else setState('ok')
      })
      .catch(() => setState('ok'))
  }, [requireAc])

  if (state === 'loading') return null
  if (state === 'block') return <SingleCompanyRequired />
  if (state === 'no_ac' && sel?.companyId && sel?.companyName)
    return <AcCredentialsRequired companyId={sel.companyId} companyName={sel.companyName} />
  return <>{children}</>
}
