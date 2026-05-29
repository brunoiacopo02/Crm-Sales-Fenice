import { NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'

export const maxDuration = 15

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

export async function GET() {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const companies = await listActiveCompanies()
    return NextResponse.json({
      companies: companies.map((c) => ({
        ...c,
        hasAcCredentials: getAcCredentials(c.id) !== null,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
