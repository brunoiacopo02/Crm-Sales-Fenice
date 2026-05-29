import { NextRequest, NextResponse } from 'next/server'
import { getAdInsightsCached as getAdInsights } from '@/lib/marketing/ads-cache'
import { getAccountAdInsights, type AdInsight, matchesAnyKeyword } from '@/lib/marketing/meta'
import { getMetaCredentials } from '@/lib/marketing/meta-credentials'
import { getFunnelsForCompany, metaFunnelsForCompany, type FunnelConfig } from '@/lib/marketing/company-funnels'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 60

const OTHER_FUNNEL = { id: 'other', name: 'Altro' }

function detectFunnelForAd(
  funnels: FunnelConfig[],
  accountId: string,
  campaignName: string,
): string {
  for (const f of funnels) {
    if (!f.meta_account || !f.meta_keyword) continue
    if (f.meta_account !== accountId) continue
    if (matchesAnyKeyword(campaignName, f.meta_keyword)) return f.id
  }
  return OTHER_FUNNEL.id
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { searchParams } = req.nextUrl
    const dateFrom = searchParams.get('from') ?? ''
    const dateTo = searchParams.get('to') ?? ''
    const funnelId = searchParams.get('funnel')
    const scope = searchParams.get('scope')

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    if (scope === 'other') {
      const creds = getMetaCredentials(ctx.companyId)
      if (!creds) {
        return NextResponse.json(
          [{ funnel: OTHER_FUNNEL.id, name: OTHER_FUNNEL.name, ads: [], error: 'Meta non configurato' }],
          { status: 200 },
        )
      }
      const allFunnels = await getFunnelsForCompany(ctx.companyId)
      const metaConfigured = await metaFunnelsForCompany(ctx.companyId)
      const accountIds = [...new Set(metaConfigured.map((f) => f.meta_account!).filter(Boolean))]
      const otherAds: AdInsight[] = []
      let errorMsg: string | null = null
      await Promise.all(
        accountIds.map(async (accountId) => {
          try {
            const ads = await getAccountAdInsights(creds, accountId, dateFrom, dateTo)
            for (const ad of ads) {
              if (detectFunnelForAd(allFunnels, accountId, ad.campaign_name) === OTHER_FUNNEL.id) {
                otherAds.push(ad)
              }
            }
          } catch (e) {
            errorMsg = errorMsg ? `${errorMsg}; ${String(e)}` : String(e)
          }
        }),
      )
      return NextResponse.json([
        { funnel: OTHER_FUNNEL.id, name: OTHER_FUNNEL.name, ads: otherAds, error: errorMsg },
      ])
    }

    const meta = await metaFunnelsForCompany(ctx.companyId)
    const targets = funnelId ? meta.filter((f) => f.id === funnelId) : meta

    const results = await Promise.all(
      targets.map(async (funnel) => {
        try {
          const ads = await getAdInsights(
            ctx.companyId,
            funnel.meta_account!,
            funnel.meta_keyword!,
            dateFrom,
            dateTo,
          )
          return { funnel: funnel.id, name: funnel.name, ads, error: null }
        } catch (e) {
          return { funnel: funnel.id, name: funnel.name, ads: [], error: String(e) }
        }
      }),
    )

    return NextResponse.json(results)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
