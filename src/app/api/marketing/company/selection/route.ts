import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getSelectedCompany, listActiveCompanies } from '@/lib/marketing/company'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'

// Espone al client la selezione corrente (cookie HttpOnly) e l'elenco
// aziende attive. Le pagine all-aware usano `mode`/`activeCompanyIds`
// per decidere se fare fan-out e con quali slug.
export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const sel = await getSelectedCompany(req)
    const companies = await listActiveCompanies()

    if (!sel) {
      return NextResponse.json({
        mode: null,
        companyId: null,
        companyName: null,
        hasAcCredentials: false,
        companies: companies.map((c) => ({ id: c.id, display_name: c.display_name })),
        activeCompanyIds: [],
      })
    }

    if (sel.mode === 'all') {
      return NextResponse.json({
        mode: 'all',
        companyId: null,
        companyName: null,
        hasAcCredentials: false,
        companies: companies.map((c) => ({ id: c.id, display_name: c.display_name })),
        activeCompanyIds: companies.map((c) => c.id),
      })
    }

    return NextResponse.json({
      mode: 'single',
      companyId: sel.companyId,
      companyName: sel.company.display_name,
      hasAcCredentials: getAcCredentials(sel.companyId) !== null,
      companies: companies.map((c) => ({ id: c.id, display_name: c.display_name })),
      activeCompanyIds: [sel.companyId],
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
