import { NextRequest, NextResponse } from 'next/server'
import { syncMetaInsights, type MetaSyncStats } from '@/lib/marketing/meta-sync'
import { listActiveCompanies } from '@/lib/marketing/company'
import { getMetaCredentials } from '@/lib/marketing/meta-credentials'

// Daily Meta insights refresh cron. Iterates ALL active companies with
// Meta credentials configured. Auth via CRON_SECRET bearer header.
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? undefined
  const to = sp.get('to') ?? undefined
  const daysBackStr = sp.get('daysBack')
  const daysBack = daysBackStr ? parseInt(daysBackStr, 10) : undefined
  const onlyCompany = sp.get('company') ?? undefined

  const companies = await listActiveCompanies()
  const targets = onlyCompany ? companies.filter((c) => c.id === onlyCompany) : companies
  const perCompany: Record<string, { ok: true; stats: MetaSyncStats } | { ok: false; error: string }> = {}

  for (const c of targets) {
    if (!getMetaCredentials(c.id)) {
      perCompany[c.id] = { ok: false, error: 'Meta non configurato' }
      continue
    }
    try {
      const stats = await syncMetaInsights({ companyId: c.id, from, to, daysBack })
      perCompany[c.id] = { ok: true, stats }
    } catch (e) {
      perCompany[c.id] = { ok: false, error: String(e) }
    }
  }

  return NextResponse.json({ ok: true, perCompany })
}
