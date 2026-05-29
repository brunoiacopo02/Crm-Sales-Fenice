import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ilike, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { acContacts } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getAcCredentials } from '@/lib/marketing/ac-credentials'

export const maxDuration = 60

interface AcCampaign {
  id: string
  name: string
  sdate: string
  sends?: string
  send_amt?: string
  total_amt?: string
  total_amt_sent?: string
  uniqueopens: string
  uniquelinkclicks: string
  unsubscribes: string
  status: string
}

export interface EmailRow {
  id: string
  name: string
  sdate: string
  sends: number
  unique_opens: number
  open_rate: number
  unique_clicks: number
  click_rate: number
  unsubscribes: number
  lead_count: number
  closures: number
  revenue: number
  utm_medium_match: string
  utm_campaign_match: string | null
}

function parseIntSafe(v: string | undefined): number {
  if (!v) return 0
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

function pickSendsCount(c: AcCampaign): number {
  const candidates = [c.send_amt, c.total_amt_sent, c.total_amt, c.sends]
  for (const v of candidates) {
    const n = parseIntSafe(v)
    if (n > 0) return n
  }
  return 0
}

function deriveUtmKeys(name: string): { medium: string; campaign: string | null } {
  const trimmed = name.trim()
  const head = trimmed.split(/\s+[-–|(]\s*/)[0].trim()
  const medium = head.replace(/\s+/g, '')
  const emailMatch = trimmed.match(/email\s*0*(\d+)/i)
  const campaign = emailMatch ? `email${emailMatch[1]}` : null
  return { medium, campaign }
}

interface AttribKey {
  medium: string
  campaign: string | null
}

interface AttribStats {
  leads: number
  closures: number
  revenue: number
}

async function getEmailAttribution(
  keys: AttribKey[],
  companyId: string,
): Promise<Map<string, AttribStats>> {
  const result = new Map<string, AttribStats>()
  if (keys.length === 0) return result

  const mediumValues = Array.from(new Set(keys.map((k) => k.medium))).filter(Boolean)
  if (mediumValues.length === 0) return result

  const bump = (key: string, isCliente: boolean, rev: number) => {
    let s = result.get(key)
    if (!s) {
      s = { leads: 0, closures: 0, revenue: 0 }
      result.set(key, s)
    }
    s.leads += 1
    if (isCliente) {
      s.closures += 1
      s.revenue += rev
    }
  }

  // Drizzle equivalent of the legacy paginated Supabase scan.
  const rows = await db
    .select({
      utmMedium: acContacts.utmMedium,
      utmCampaign: acContacts.utmCampaign,
      isCliente: acContacts.isCliente,
      contractValue: acContacts.contractValue,
    })
    .from(acContacts)
    .where(
      and(
        eq(acContacts.companyId, companyId),
        ilike(acContacts.utmSource, 'email'),
        inArray(acContacts.utmMedium, mediumValues),
        eq(acContacts.manuallyExcluded, false),
      ),
    )

  for (const r of rows) {
    const m = (r.utmMedium ?? '').trim()
    if (!m) continue
    const c = (r.utmCampaign ?? '').trim() || null
    const rev = Number(r.contractValue ?? 0) || 0
    bump(`${m}::*`, r.isCliente, rev)
    if (c) bump(`${m}::${c}`, r.isCliente, rev)
  }
  return result
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const creds = getAcCredentials(ctx.companyId)
    if (!creds) {
      return NextResponse.json(
        { error: `AC env mancanti per ${ctx.companyId}` },
        { status: 500 },
      )
    }
    const acHeaders = { 'Api-Token': creds.key }

    const { searchParams } = req.nextUrl
    const dateFrom = searchParams.get('from') ?? ''
    const dateTo = searchParams.get('to') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    const limit = 100
    let offset = 0
    const all: AcCampaign[] = []

    while (true) {
      const url = new URL(`${creds.url}/api/3/campaigns`)
      url.searchParams.set('filters[status]', '5')
      url.searchParams.set('orders[sdate]', 'DESC')
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('offset', String(offset))

      const res = await fetch(url.toString(), { headers: acHeaders, cache: 'no-store' })
      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: `AC API ${res.status}: ${err}` }, { status: 500 })
      }

      const data = await res.json()
      const batch: AcCampaign[] = data.campaigns ?? []
      all.push(...batch)

      const total = parseInt(data.meta?.total ?? '0', 10)
      offset += limit
      if (offset >= total) break

      const oldest = batch[batch.length - 1]
      if (oldest && oldest.sdate && oldest.sdate.slice(0, 10) < dateFrom) break
    }

    const filtered = all.filter((c) => {
      if (!c.sdate || c.sdate === '0000-00-00 00:00:00') return false
      const d = c.sdate.slice(0, 10)
      return d >= dateFrom && d <= dateTo
    })

    const keys: AttribKey[] = filtered.map((c) => deriveUtmKeys(c.name))
    let attribution: Map<string, AttribStats>
    try {
      attribution = await getEmailAttribution(keys, ctx.companyId)
    } catch {
      attribution = new Map()
    }

    const rows: EmailRow[] = filtered.map((c, i) => {
      const sends = pickSendsCount(c)
      const opens = parseIntSafe(c.uniqueopens)
      const clicks = parseIntSafe(c.uniquelinkclicks)
      const k = keys[i]
      const aggKey = k.campaign ? `${k.medium}::${k.campaign}` : `${k.medium}::*`
      const stats = attribution.get(aggKey) ?? { leads: 0, closures: 0, revenue: 0 }
      return {
        id: c.id,
        name: c.name,
        sdate: c.sdate.slice(0, 10),
        sends,
        unique_opens: opens,
        open_rate: sends > 0 ? Math.round((opens / sends) * 10000) / 100 : 0,
        unique_clicks: clicks,
        click_rate: sends > 0 ? Math.round((clicks / sends) * 10000) / 100 : 0,
        unsubscribes: parseIntSafe(c.unsubscribes),
        lead_count: stats.leads,
        closures: stats.closures,
        revenue: Math.round(stats.revenue * 100) / 100,
        utm_medium_match: k.medium,
        utm_campaign_match: k.campaign,
      }
    })

    rows.sort((a, b) => b.sdate.localeCompare(a.sdate))

    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
