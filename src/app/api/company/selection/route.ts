import { NextResponse } from 'next/server'
import { currentTenant, assertSalesArea } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'

// Stato selezione per lo switcher sales. Riusa listActiveCompanies (tabella
// companies condivisa) e filtra alle aziende consentite all'utente.
export async function GET() {
  try {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const all = await listActiveCompanies()
    const companies = all
      .filter((c) => ctx.allowedCompanies.includes(c.id))
      .map((c) => ({ id: c.id, display_name: c.display_name }))

    return NextResponse.json({
      active: ctx.companyId,
      canSwitch: companies.length > 1,
      companies,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
