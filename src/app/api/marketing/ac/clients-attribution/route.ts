import { NextRequest, NextResponse } from 'next/server'
import { getSalesAttributionFromDeals } from '@/lib/marketing/crm-deals-reader'
import { getFunnelsForCompany } from '@/lib/marketing/company-funnels'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { searchParams } = req.nextUrl
    const dateFrom = searchParams.get('from') ?? ''
    const dateTo = searchParams.get('to') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    try {
      const funnels = await getFunnelsForCompany(ctx.companyId)
      const agg = await getSalesAttributionFromDeals(ctx.companyId, funnels, dateFrom, dateTo)

      const perFunnel: Record<string, Record<string, { count: number; revenue: number }>> =
        Object.fromEntries(funnels.map((f) => [f.id, agg.byFunnelByAd[f.id] ?? {}]))

      return NextResponse.json({ perFunnel, all: agg.byAdGlobal ?? {} })
    } catch (e) {
      return NextResponse.json({ error: String(e), perFunnel: {}, all: {} }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
