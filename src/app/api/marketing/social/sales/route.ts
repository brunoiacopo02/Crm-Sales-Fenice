import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { acContacts } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 30

// Canali organici/social, riconosciuti dagli utm presenti su ac_contacts.
// - Bio Organico:        utm_campaign = 'bioorg'
// - Instagram link bio:  utm_campaign = 'instagram' AND utm_content = 'link_in_bio'
// - TikTok:              utm_campaign = 'tiktok'
interface ChannelDef {
  key: string
  label: string
  match: (c: { utm_campaign: string; utm_content: string }) => boolean
}

const CHANNELS: ChannelDef[] = [
  {
    key: 'bioorg',
    label: 'Bio Organico',
    match: (c) => c.utm_campaign === 'bioorg',
  },
  {
    key: 'instagram',
    label: 'Instagram (link in bio)',
    match: (c) => c.utm_campaign === 'instagram' && c.utm_content === 'link_in_bio',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    match: (c) => c.utm_campaign === 'tiktok',
  },
]

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
      // Single Drizzle query: tutti i contatti del tenant con uno degli
      // utm_campaign rilevanti. Filtri di data e canale in memoria.
      const rows = await db
        .select({
          utmCampaign: acContacts.utmCampaign,
          utmContent: acContacts.utmContent,
          cdate: acContacts.cdate,
          isCliente: acContacts.isCliente,
          contractDate: acContacts.contractDate,
          contractValue: acContacts.contractValue,
        })
        .from(acContacts)
        .where(
          and(
            eq(acContacts.companyId, ctx.companyId),
            inArray(acContacts.utmCampaign, ['bioorg', 'instagram', 'tiktok']),
            eq(acContacts.manuallyExcluded, false),
          ),
        )

      const stats = CHANNELS.map((ch) => {
        let leads = 0
        let sales = 0
        let revenue = 0
        for (const r of rows) {
          const utm = {
            utm_campaign: (r.utmCampaign ?? '').toLowerCase().trim(),
            utm_content: (r.utmContent ?? '').toLowerCase().trim(),
          }
          if (!ch.match(utm)) continue
          const cd = r.cdate ? r.cdate.toISOString().slice(0, 10) : ''
          if (cd >= from && cd <= to) leads += 1
          const contractDateStr = r.contractDate ?? ''
          if (r.isCliente && contractDateStr && contractDateStr >= from && contractDateStr <= to) {
            sales += 1
            revenue += Number(r.contractValue ?? 0) || 0
          }
        }
        return {
          key: ch.key,
          label: ch.label,
          leads,
          sales,
          revenue: Math.round(revenue * 100) / 100,
        }
      })

      return NextResponse.json({ channels: stats })
    } catch (e) {
      return NextResponse.json({ error: String(e), channels: [] }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
