import { NextResponse } from 'next/server'
import { currentTenant, assertSalesArea, ALL_COMPANIES } from '@/lib/tenancy'
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

    // Voce sintetica "Tutte le aziende": solo admin con >1 aziende consentite.
    const canSelectAll = ctx.role === 'ADMIN' && ctx.allowedCompanies.length > 1
    if (canSelectAll) {
      companies.push({ id: ALL_COMPANIES, display_name: 'Tutte le aziende' })
    }

    return NextResponse.json({
      active: ctx.isAllCompanies ? ALL_COMPANIES : ctx.companyId,
      canSwitch: companies.length > 1,
      canSelectAll,
      companies,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
