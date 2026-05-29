import { NextRequest, NextResponse } from 'next/server'
import { syncAcContacts, type SyncStats } from '@/lib/marketing/ac-sync'
import { listActiveCompanies } from '@/lib/marketing/company'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'

// Daily AC contacts sync cron. Iterates ALL active companies with AC
// credentials configured. Auth via CRON_SECRET bearer header.
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
  const sinceParam = req.nextUrl.searchParams.get('since') ?? undefined
  const onlyCompany = req.nextUrl.searchParams.get('company') ?? undefined

  const companies = await listActiveCompanies()
  const targets = onlyCompany ? companies.filter((c) => c.id === onlyCompany) : companies
  const perCompany: Record<string, { ok: true; stats: SyncStats } | { ok: false; error: string }> = {}

  for (const c of targets) {
    if (!getAcCredentials(c.id)) {
      perCompany[c.id] = { ok: false, error: 'ActiveCampaign non configurato' }
      continue
    }
    try {
      const stats = await syncAcContacts(c.id, sinceParam)
      perCompany[c.id] = { ok: true, stats }
    } catch (e) {
      perCompany[c.id] = { ok: false, error: String(e) }
    }
  }

  return NextResponse.json({ ok: true, perCompany })
}
