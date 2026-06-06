import { NextRequest, NextResponse } from 'next/server'
import {
  currentTenant,
  assertSalesArea,
  SALES_ACTIVE_COMPANY_COOKIE,
  SALES_ACTIVE_COMPANY_MAX_AGE,
} from '@/lib/tenancy'

export async function POST(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const body = await req.json().catch(() => null)
    const companyId = body && typeof body.companyId === 'string' ? body.companyId : null
    if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

    // Sicurezza: solo aziende consentite all'utente.
    if (!ctx.allowedCompanies.includes(companyId)) {
      return NextResponse.json({ error: 'company not allowed' }, { status: 403 })
    }

    const res = NextResponse.json({ ok: true, companyId })
    res.cookies.set(SALES_ACTIVE_COMPANY_COOKIE, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SALES_ACTIVE_COMPANY_MAX_AGE,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
