'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Company {
  id: string
  name: string
  display_name: string
  short_code: string
}

export default function SelectCompanyPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/marketing/companies')
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function pick(companyId: string) {
    setSubmitting(companyId)
    const res = await fetch('/api/marketing/company/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    })
    if (!res.ok) {
      setSubmitting(null)
      alert('Errore nella selezione')
      return
    }
    router.push('/marketing/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl w-full">
        <div className="text-center mb-8">
          <div className="text-sm tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
            Fenice Marketing
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            Seleziona l&apos;azienda
          </h1>
        </div>

        {loading ? (
          <div className="text-center" style={{ color: 'var(--faint)' }}>
            Caricamento…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c.id)}
                  disabled={submitting !== null}
                  className="card p-6 text-left transition hover:shadow-md disabled:opacity-50"
                >
                  <div className="text-xs mb-1" style={{ color: 'var(--faint)' }}>
                    {c.short_code}
                  </div>
                  <div className="font-medium" style={{ color: 'var(--text)' }}>
                    {c.display_name}
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pick('all')}
              disabled={submitting !== null}
              className="card w-full p-4 text-left transition hover:shadow-md disabled:opacity-50"
            >
              <div className="font-medium" style={{ color: 'var(--text)' }}>
                Tutte le aziende
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--faint)' }}>
                Aggregato di tutte le aziende
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
