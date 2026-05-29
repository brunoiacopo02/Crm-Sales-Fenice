import { NextRequest, NextResponse } from 'next/server'
import { getLeadsInRange } from '@/lib/marketing/ac-contacts-query'
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
      const [leadRows, salesAgg] = await Promise.all([
        getLeadsInRange(ctx.companyId, { from: dateFrom, to: dateTo }),
        getSalesAttributionFromDeals(ctx.companyId, funnels, dateFrom, dateTo),
      ])
      return NextResponse.json({
        leads: leadRows.length,
        sales: salesAgg.total.count,
        revenue: salesAgg.total.revenue,
      })
    } catch (e) {
      return NextResponse.json({ leads: 0, sales: 0, revenue: 0, error: String(e) }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
