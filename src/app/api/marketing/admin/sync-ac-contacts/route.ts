import { NextRequest, NextResponse } from 'next/server'
import { syncAcContacts, type SyncStats } from '@/lib/marketing/ac-sync'
import { listActiveCompanies } from '@/lib/marketing/company'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

// Trigger manuale del sync AC → ac_contacts.
export const maxDuration = 300

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let since = req.nextUrl.searchParams.get('since') ?? undefined
    const daysParam = req.nextUrl.searchParams.get('days')
    if (!since && daysParam) {
      const days = parseInt(daysParam, 10)
      if (Number.isFinite(days) && days > 0) {
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      }
    }
    const onlyCompany = req.nextUrl.searchParams.get('company') ?? undefined

    const companies = await listActiveCompanies()
    const targets = onlyCompany ? companies.filter((c) => c.id === onlyCompany) : companies
    const perCompany: Record<string, { ok: true; stats: SyncStats } | { ok: false; error: string }> = {}

    for (const c of targets) {
      if (!getAcCredentials(c.id)) {
        perCompany[c.id] = { ok: false, error: 'ActiveCampaign non configurato' }
        continue
      }
      try {
        const stats = await syncAcContacts(c.id, since)
        perCompany[c.id] = { ok: true, stats }
      } catch (e) {
        perCompany[c.id] = { ok: false, error: String(e) }
      }
    }

    return NextResponse.json({ ok: true, perCompany })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
