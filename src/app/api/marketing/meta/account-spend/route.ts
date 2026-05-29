import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getAccountTotalSpend } from '@/lib/marketing/meta-sync'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { searchParams } = req.nextUrl
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    if (!from || !to) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }
    try {
      const spend = await getAccountTotalSpend(ctx.companyId, from, to)
      return NextResponse.json({ spend })
    } catch (e) {
      return NextResponse.json({ error: String(e), spend: 0 }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
