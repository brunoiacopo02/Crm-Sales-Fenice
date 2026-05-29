import { NextRequest, NextResponse } from 'next/server'
import { getLeadsInRange, aggregateLeadsByFunnel } from '@/lib/marketing/ac-contacts-query'
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
      const rows = await getLeadsInRange(ctx.companyId, { from: dateFrom, to: dateTo })
      const { total, byAd, byAdGlobal } = aggregateLeadsByFunnel(rows)
      const results = targets.map((funnel) => ({
        funnel: funnel.id,
        leads: total[funnel.id] ?? 0,
        byAd: byAd[funnel.id] ?? {},
        error: null,
      }))
      results.push({ funnel: 'other', leads: 0, byAd: byAdGlobal, error: null })
      return NextResponse.json(results)
    } catch (e) {
      return NextResponse.json(
        targets.map((funnel) => ({ funnel: funnel.id, leads: 0, byAd: {}, error: String(e) })),
        { status: 500 },
      )
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
