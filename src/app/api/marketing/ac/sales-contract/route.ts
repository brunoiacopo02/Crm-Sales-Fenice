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
    const funnelId = searchParams.get('funnel')

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    const funnels = await getFunnelsForCompany(ctx.companyId)
    const targets = funnelId ? funnels.filter((f) => f.id === funnelId) : funnels

    try {
      const agg = await getSalesAttributionFromDeals(ctx.companyId, funnels, dateFrom, dateTo)
      return NextResponse.json({
        perFunnel: targets.map((f) => ({
          funnel: f.id,
          count: agg.byFunnel[f.id]?.count ?? 0,
          revenue: agg.byFunnel[f.id]?.revenue ?? 0,
          error: null,
        })),
        byFunnelByAd: agg.byFunnelByAd,
        byAdGlobal: agg.byAdGlobal ?? {},
        unattributed: agg.unattributed,
        total: agg.total,
      })
    } catch (e) {
      return NextResponse.json(
        {
          perFunnel: targets.map((f) => ({ funnel: f.id, count: 0, revenue: 0, error: String(e) })),
          byFunnelByAd: {},
          byAdGlobal: {},
          unattributed: { count: 0, revenue: 0 },
          total: { count: 0, revenue: 0 },
        },
        { status: 500 },
      )
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
