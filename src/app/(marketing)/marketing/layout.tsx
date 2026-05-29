import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import AuthProvider from '@/components/AuthProvider'
import Sidebar from '@/components/marketing/Sidebar'
import Topbar from '@/components/marketing/Topbar'
import { MarketingCompanyProvider } from '@/components/marketing/CompanyContext'
import '../marketing.css'

/**
 * Layout per tutte le pagine sotto /marketing/*.
 *
 * Auth: Supabase Auth. L'utente DEVE avere `user_metadata.area` = 'marketing'
 * o 'both'. Altrimenti redirect a /login.
 *
 * Company selection: cookie gestito da /api/marketing/company/select.
 * Per super-admin (area='both') si può scegliere tra le aziende; per i
 * single-tenant marketing user la company è quella nel loro metadata.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const meta = user.user_metadata ?? {}
  const area = (meta.area as string | undefined) ?? 'sales'
  const role = (meta.role as string | undefined) ?? ''

  // Solo utenti marketing o super-admin (both) o ADMIN possono accedere.
  const isAllowed = area === 'marketing' || area === 'both' || role === 'ADMIN'
  if (!isAllowed) {
    redirect('/login')
  }

  // Ruolo marketing per filtrare voci sidebar/topbar.
  const marketingRole =
    (meta.marketingRole as string | undefined) ?? (role === 'ADMIN' ? 'admin' : 'manager')

  // Legge l'azienda attualmente selezionata dal cookie.
  const cookieStore = await cookies()
  const cookieSelection = cookieStore.get('marketing_company')?.value
  // Default: companyId dell'utente per single-tenant; vuoto per super-admin (sceglierà).
  const fallbackCompany = area === 'both' ? undefined : (meta.companyId as string | undefined)
  const currentCompany = cookieSelection ?? fallbackCompany

  const canSwitchCompany = area === 'both'

  return (
    <AuthProvider>
      <MarketingCompanyProvider>
        <div className="marketing-scope">
          <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
            <Sidebar role={marketingRole} />
            <div className="flex-1 flex flex-col overflow-hidden">
              <Topbar
                role={marketingRole}
                email={user.email ?? ''}
                currentCompany={currentCompany}
                canSwitchCompany={canSwitchCompany}
              />
              <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
            </div>
          </div>
        </div>
      </MarketingCompanyProvider>
    </AuthProvider>
  )
}
