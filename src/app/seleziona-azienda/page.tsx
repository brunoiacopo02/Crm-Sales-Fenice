import { redirect } from 'next/navigation'
import { currentTenant } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'
import { CompanyPicker } from '@/components/sales/SalesCompanySwitcher'

export default async function SelezionaAziendaPage() {
  const ctx = await currentTenant()
  const all = await listActiveCompanies()
  const companies = all
    .filter((c) => ctx.allowedCompanies.includes(c.id))
    .map((c) => ({ id: c.id, display_name: c.display_name }))

  // 1 sola azienda → niente scelta, vai dritto.
  if (companies.length <= 1) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Scegli l'azienda</h1>
        <p className="text-sm text-gray-500 mb-6">Lavorerai sui dati dell'azienda selezionata.</p>
        <CompanyPicker companies={companies} />
      </div>
    </div>
  )
}
