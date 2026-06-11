import { NextRequest, NextResponse } from 'next/server'
import {
  currentTenant,
  assertSalesArea,
  ALL_COMPANIES,
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

    // Sicurezza: aziende consentite all'utente, oppure la sentinella "Tutte le
    // aziende" se admin con >1 aziende.
    const canSelectAll = ctx.role === 'ADMIN' && ctx.allowedCompanies.length > 1
    const allowed =
      ctx.allowedCompanies.includes(companyId) ||
      (companyId === ALL_COMPANIES && canSelectAll)
    if (!allowed) {
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

/**
 * Azzera la selezione azienda. Chiamata al logout: senza, il cookie HttpOnly
 * sopravviveva alla sessione e il login successivo (anche di un ALTRO utente
 * sullo stesso browser) ereditava l'azienda del precedente. QA e2e 2026-06-11.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SALES_ACTIVE_COMPANY_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
