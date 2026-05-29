import { NextRequest, NextResponse } from 'next/server'
import { getFunnelInsightsCached as getFunnelInsights } from '@/lib/marketing/ads-cache'
import { metaFunnelsForCompany } from '@/lib/marketing/company-funnels'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

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

    const meta = await metaFunnelsForCompany(ctx.companyId)
    const targets = funnelId ? meta.filter((f) => f.id === funnelId) : meta

    const results = await Promise.all(
      targets.map(async (funnel) => {
        try {
          const data = await getFunnelInsights(
            ctx.companyId,
            funnel.meta_account!,
            funnel.meta_keyword!,
            dateFrom,
            dateTo,
          )
          return { funnel: funnel.id, name: funnel.name, ...data, error: null }
        } catch (e) {
          return {
            funnel: funnel.id,
            name: funnel.name,
            spend: 0,
            impressions: 0,
            clicks: 0,
            cpm: 0,
            ctr: 0,
            cpc: 0,
            leads_meta: 0,
            error: String(e),
          }
        }
      }),
    )

    return NextResponse.json(results)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
