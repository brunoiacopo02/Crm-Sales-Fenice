import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { marketingTargets } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getAdInsightsCached } from '@/lib/marketing/ads-cache'
import { getSalesRowsFromDeals } from '@/lib/marketing/crm-deals-reader'
import { metaFunnelsForCompany } from '@/lib/marketing/company-funnels'
import { lastNIsoWeeks, todayInRome, type IsoWeekWindow } from '@/lib/marketing/date-utils'

export const maxDuration = 30

interface WeekCell {
  spend: number
  conf: number
  roas: number
}

interface TrendRow {
  ad_id: string
  ad_name: string
  funnel: string
  funnelName: string
  campaign_name: string
  effective_status: string
  post_url: string | null
  weekly: WeekCell[]
  roas_avg_prev3: number
  roas_last_closed: number
  delta_pct: number
  flag: 'green' | 'yellow' | 'red' | 'gray'
}

interface TrendResponse {
  weeks: IsoWeekWindow[]
  aov: number
  funnels: { id: string; name: string }[]
  rows: TrendRow[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function computeRoas(spend: number, conf: number, aov: number): number {
  if (spend <= 0) return 0
  return round2((conf * aov) / spend)
}

function classify(roasLast: number, prev3: number[]): {
  avg: number
  delta: number
  flag: 'green' | 'yellow' | 'red' | 'gray'
} {
  const withSignal = prev3.filter((r) => r > 0).length
  if (withSignal < 2) {
    return { avg: 0, delta: 0, flag: 'gray' }
  }
  const avg = prev3.reduce((s, r) => s + r, 0) / prev3.length
  if (avg <= 0) {
    if (roasLast > 0) return { avg: 0, delta: 1, flag: 'green' }
    return { avg: 0, delta: 0, flag: 'gray' }
  }
  const ratio = roasLast / avg
  const delta = ratio - 1
  let flag: 'green' | 'yellow' | 'red'
  if (ratio >= 1) flag = 'green'
  else if (ratio >= 0.6) flag = 'yellow'
  else flag = 'red'
  return { avg: round2(avg), delta: round2(delta), flag }
}

function pickWeekIndex(date: string, weeks: IsoWeekWindow[]): number {
  for (let i = 0; i < weeks.length; i++) {
    if (date >= weeks[i].from && date <= weeks[i].to) return i
  }
  return -1
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    const companyId = ctx.companyId

    const anchor = todayInRome()
    const weeks = lastNIsoWeeks(5, anchor)
    const windowFrom = weeks[0].from
    const windowTo = weeks[weeks.length - 1].to

    let aov = 2300
    const [targetsRow] = await db
      .select({ aov: marketingTargets.aov })
      .from(marketingTargets)
      .where(and(eq(marketingTargets.companyId, companyId), eq(marketingTargets.id, 1)))
      .limit(1)
    if (targetsRow && targetsRow.aov != null) {
      aov = Number(targetsRow.aov)
    }

    const confByFunnelByAd: Record<string, Record<number, Record<string, number>>> = {}
    try {
      const sales = await getSalesRowsFromDeals(companyId, windowFrom, windowTo)
      for (const s of sales) {
        if (!s.funnel_id || !s.contract_date) continue
        const idx = pickWeekIndex(s.contract_date.slice(0, 10), weeks)
        if (idx < 0) continue
        const ad = s.ad_name
        if (!ad) continue
        confByFunnelByAd[s.funnel_id] ??= {}
        confByFunnelByAd[s.funnel_id][idx] ??= {}
        confByFunnelByAd[s.funnel_id][idx][ad] = (confByFunnelByAd[s.funnel_id][idx][ad] ?? 0) + 1
      }
    } catch (e) {
      console.error('trend: getSalesRowsFromDeals failed', e)
    }

    type AdMeta = {
      ad_name: string
      campaign_name: string
      effective_status: string
      post_url: string | null
      funnel: string
      funnelName: string
    }
    const adMeta = new Map<string, AdMeta>()
    const pivot = new Map<string, WeekCell[]>()

    const funnels = await metaFunnelsForCompany(companyId)
    await Promise.all(
      funnels.flatMap((funnel) =>
        weeks.map(async (wk, weekIdx) => {
          try {
            const ads = await getAdInsightsCached(
              companyId,
              funnel.meta_account!,
              funnel.meta_keyword!,
              wk.from,
              wk.to,
            )
            const confByAd = confByFunnelByAd[funnel.id]?.[weekIdx] ?? {}
            for (const ad of ads) {
              const key = ad.ad_id
              if (!adMeta.has(key)) {
                adMeta.set(key, {
                  ad_name: ad.ad_name,
                  campaign_name: ad.campaign_name,
                  effective_status: ad.effective_status ?? 'UNKNOWN',
                  post_url: ad.post_url ?? null,
                  funnel: funnel.id,
                  funnelName: funnel.name,
                })
              } else {
                const cur = adMeta.get(key)!
                if (ad.effective_status) cur.effective_status = ad.effective_status
                if (ad.post_url) cur.post_url = ad.post_url
              }
              if (!pivot.has(key)) {
                pivot.set(key, weeks.map(() => ({ spend: 0, conf: 0, roas: 0 })))
              }
              const cells = pivot.get(key)!
              const adName = ad.ad_name.trim()
              const confCount = confByAd[adName] ?? 0
              cells[weekIdx] = {
                spend: round2(ad.spend),
                conf: confCount,
                roas: computeRoas(ad.spend, confCount, aov),
              }
            }
          } catch (e) {
            console.error(`trend: getAdInsightsCached failed for ${funnel.id} ${wk.iso}`, e)
          }
        }),
      ),
    )

    const rows: TrendRow[] = []
    for (const [ad_id, cells] of pivot.entries()) {
      const meta = adMeta.get(ad_id)!
      const totalSpend = cells.reduce((s, c) => s + c.spend, 0)
      if (totalSpend <= 0) continue
      const roasLast = cells[3]?.roas ?? 0
      const prev3 = [cells[0]?.roas ?? 0, cells[1]?.roas ?? 0, cells[2]?.roas ?? 0]
      const { avg, delta, flag } = classify(roasLast, prev3)
      rows.push({
        ad_id,
        ad_name: meta.ad_name,
        funnel: meta.funnel,
        funnelName: meta.funnelName,
        campaign_name: meta.campaign_name,
        effective_status: meta.effective_status,
        post_url: meta.post_url,
        weekly: cells,
        roas_avg_prev3: avg,
        roas_last_closed: roasLast,
        delta_pct: delta,
        flag,
      })
    }

    const response: TrendResponse = {
      weeks,
      aov,
      funnels: funnels.map((f) => ({ id: f.id, name: f.name })),
      rows,
    }
    return NextResponse.json(response)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
