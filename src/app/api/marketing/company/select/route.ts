import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import {
  listActiveCompanies,
  SELECTED_COMPANY_COOKIE,
  SELECTED_COMPANY_MAX_AGE,
} from '@/lib/marketing/company'

export async function POST(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const body = await req.json().catch(() => null)
    const companyId = body && typeof body.companyId === 'string' ? body.companyId : null
    if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

    if (companyId !== 'all') {
      const companies = await listActiveCompanies()
      if (!companies.find((c) => c.id === companyId)) {
        return NextResponse.json({ error: 'unknown company' }, { status: 400 })
      }
    }

    const res = NextResponse.json({ ok: true, companyId })
    res.cookies.set(SELECTED_COMPANY_COOKIE, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SELECTED_COMPANY_MAX_AGE,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
