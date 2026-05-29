import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getSalesListFromDeals } from '@/lib/marketing/crm-deals-reader'
import { getAdInsightsCached } from '@/lib/marketing/ads-cache'
import { getFunnelsForCompany } from '@/lib/marketing/company-funnels'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { searchParams } = req.nextUrl
    const dateFrom = searchParams.get('from') ?? ''
    const dateTo = searchParams.get('to') ?? ''
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    try {
      const sales = await getSalesListFromDeals(ctx.companyId, dateFrom, dateTo)

      // Wide-enough ad-fetch window so we can resolve campaign/adset/creative for sales
      // whose lead came in before the selected period. Cap at 1 year before dateFrom.
      const oneYearBefore = (() => {
        const d = new Date(dateFrom + 'T00:00:00Z')
        d.setUTCFullYear(d.getUTCFullYear() - 1)
        return d.toISOString().slice(0, 10)
      })()
      const earliestLead = sales.reduce<string>((acc, s) => {
        const d = (s.lead_date ?? '').slice(0, 10)
        return d && d < acc ? d : acc
      }, dateFrom)
      const adRangeFrom = earliestLead < oneYearBefore ? oneYearBefore : earliestLead

      const funnels = await getFunnelsForCompany(ctx.companyId)
      const funnelIds = [...new Set(sales.map((s) => s.funnel_id).filter((x): x is string => !!x))]
      type AdMeta = { campaign_name: string; adset_name: string; post_url: string | null; ad_id: string }
      const adMetaByFunnel: Record<string, Map<string, AdMeta>> = {}

      await Promise.all(
        funnelIds.map(async (fid) => {
          const funnel = funnels.find((f) => f.id === fid)
          if (!funnel || !funnel.meta_account || !funnel.meta_keyword) return
          try {
            const ads = await getAdInsightsCached(
              ctx.companyId,
              funnel.meta_account,
              funnel.meta_keyword,
              adRangeFrom,
              dateTo,
            )
            const map = new Map<string, AdMeta>()
            for (const a of ads) {
              const key = (a.ad_name ?? '').trim()
              if (!key) continue
              map.set(key, {
                campaign_name: a.campaign_name,
                adset_name: a.adset_name,
                post_url: a.post_url,
                ad_id: a.ad_id,
              })
            }
            adMetaByFunnel[fid] = map
          } catch (e) {
            console.error(`Meta enrichment failed for funnel ${fid}`, e)
          }
        }),
      )

      const enriched = sales.map((s) => {
        const meta =
          s.funnel_id && s.ad_name ? adMetaByFunnel[s.funnel_id]?.get(s.ad_name) : undefined
        return {
          ...s,
          campaign_name: meta?.campaign_name ?? null,
          adset_name: meta?.adset_name ?? null,
          post_url: meta?.post_url ?? null,
          meta_ad_id: meta?.ad_id ?? null,
        }
      })

      enriched.sort((a, b) => (a.contract_date < b.contract_date ? 1 : -1))

      const totalRevenue =
        Math.round(enriched.reduce((s, x) => s + x.revenue, 0) * 100) / 100

      return NextResponse.json({
        sales: enriched,
        count: enriched.length,
        revenue: totalRevenue,
      })
    } catch (e) {
      return NextResponse.json(
        { error: String(e), sales: [], count: 0, revenue: 0 },
        { status: 500 },
      )
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
