import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'

// Diagnostico: lista tutti i custom field di AC con id, title, perstag.
export const maxDuration = 60

interface AcField {
  id: string
  title: string
  perstag?: string
  type?: string
}

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const creds = getAcCredentials(ctx.companyId)
    if (!creds) {
      return NextResponse.json(
        { error: `AC env mancanti per ${ctx.companyId}` },
        { status: 500 },
      )
    }
    const baseUrl = creds.url
    const apiKey = creds.key

    const all: AcField[] = []
    let offset = 0
    const limit = 100
    while (true) {
      const url = new URL(`${baseUrl}/api/3/fields`)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('offset', String(offset))
      const res = await fetch(url.toString(), { headers: { 'Api-Token': apiKey }, cache: 'no-store' })
      if (!res.ok) {
        return NextResponse.json(
          { error: `AC ${res.status}: ${await res.text()}` },
          { status: 500 },
        )
      }
      const data = (await res.json()) as { fields: AcField[]; meta?: { total: string } }
      for (const f of data.fields ?? []) {
        all.push({ id: f.id, title: f.title, perstag: f.perstag, type: f.type })
      }
      const total = parseInt(data.meta?.total ?? '0', 10)
      offset += limit
      if (offset >= total) break
    }

    const utmCandidates = all.filter((f) => {
      const k = (f.perstag ?? f.title ?? '').toLowerCase()
      return k.includes('utm') || k.includes('source') || k.includes('medium') || k.includes('campaign') || k.includes('content')
    })

    return NextResponse.json({ ok: true, total: all.length, utmCandidates, all })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
