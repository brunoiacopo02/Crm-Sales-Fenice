'use client'

/**
 * CompanyContext — bridge tra Supabase Auth e selettore azienda marketing.
 *
 * Per utenti `area === 'both'` (super-admin Bruno) il selettore mostra
 * tutte le aziende attive. Per utenti `area === 'marketing'` single-tenant,
 * la company è quella nei loro user_metadata (companyId), nessun switch.
 *
 * Lo stato persistente (azienda corrente / 'all') è gestito server-side via
 * cookie su /api/marketing/company/select. Questo context si limita a
 * caricare la selezione e a esporre helper.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useAuth } from '@/components/AuthProvider'

export interface MarketingCompany {
  id: string
  display_name: string
  short_code: string
}

interface Selection {
  mode: 'single' | 'all' | null
  companyId: string | null
  companyName: string | null
  hasAcCredentials: boolean
  companies?: MarketingCompany[]
  activeCompanyIds?: string[]
}

interface CompanyContextValue {
  loading: boolean
  isSuperAdmin: boolean
  selection: Selection | null
  refresh: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextValue>({
  loading: true,
  isSuperAdmin: false,
  selection: null,
  refresh: async () => {},
})

export function MarketingCompanyProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)

  // Super-admin = area 'both' (Bruno only, in pratica).
  const area = (user?.user_metadata?.area as string | undefined) ?? 'sales'
  const isSuperAdmin = area === 'both'

  async function refresh() {
    try {
      const res = await fetch('/api/marketing/company/selection', { cache: 'no-store' })
      if (!res.ok) {
        setSelection(null)
        return
      }
      const data = (await res.json()) as Selection
      setSelection(data)
    } catch {
      setSelection(null)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    refresh().finally(() => setLoading(false))
  }, [authLoading, user])

  return (
    <CompanyContext.Provider value={{ loading, isSuperAdmin, selection, refresh }}>
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return useContext(CompanyContext)
}
