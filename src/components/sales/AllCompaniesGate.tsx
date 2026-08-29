'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Layers } from 'lucide-react'

/**
 * Gate per la modalità "Tutte le aziende" (KPI aggregati admin).
 *
 * Quando `active`, consente solo le route di reporting/sola lettura (allowlist);
 * su qualsiasi pagina operativa mostra un avviso al posto del contenuto, perché
 * non si può lavorare/scrivere un lead su un gruppo fittizio.
 *
 * Quando non `active`, è trasparente: renderizza i children così come sono.
 */
const REPORTING_ALLOWLIST = [
  '/panoramica-generale',
  '/kpi-gdo',
  '/kpi-conferme',
  '/kpi-venditori',
  '/kpi-team',
  '/conferme/analytics',
  // Simulatore puro: non legge un solo lead, quindi non ha senso bloccarlo
  // quando l'admin è in modalità gruppo.
  '/previsionale',
  // Riconciliazione: confronta CRM e foglio SOLO per Fenice (COMPANY_ID fisso
  // in riconciliazioneActions.ts), è quindi un report di sola lettura anche
  // quando l'admin è su "Tutte le aziende".
  '/riconciliazione',
]

export function AllCompaniesGate({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname() || '/'

  if (!active) return <>{children}</>

  const isReporting = REPORTING_ALLOWLIST.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  if (isReporting) return <>{children}</>

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-brand-orange">
          <Layers className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-ash-800">Modalità “Tutte le aziende”</h2>
        <p className="mt-2 text-sm text-ash-500">
          Stai visualizzando i KPI aggregati del gruppo. Per lavorare i lead di una
          singola azienda, selezionala dallo switcher in alto a destra.
        </p>
        <Link
          href="/panoramica-generale"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
        >
          <Layers className="h-4 w-4" />
          Vai alla Panoramica gruppo
        </Link>
      </div>
    </div>
  )
}
