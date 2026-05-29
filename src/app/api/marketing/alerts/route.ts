import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, lte, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { marketingTargets, metaAccountDaily } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { getLeadsInRange } from '@/lib/marketing/ac-contacts-query'
import { getSalesRowsFromDeals } from '@/lib/marketing/crm-deals-reader'
import { metaFunnelsForCompany } from '@/lib/marketing/company-funnels'

export const maxDuration = 60

const LEAD_THRESHOLD = -0.10
const ROAS_THRESHOLD = -0.15
const CONSECUTIVE_DAYS_FOR_ALERT = 7

type AlertStatus = 'ok' | 'pre-alert' | 'alert'

interface DayPoint {
  date: string
  actual: number
  proportionalTarget: number
  deviation: number | null
  belowThreshold: boolean
}

interface LeadAlertBlock {
  key: string
  label: string
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  daysInMonthSoFar: number
  totalDaysInMonth: number
  proportionalTargetToday: number
  actualToday: number
  deviationToday: number | null
  series: DayPoint[]
}

interface RoasAlertBlock {
  monthlyTarget: number
  status: AlertStatus
  consecutiveDaysBelow: number
  spendMTD: number
  revenueMTD: number
  roasToday: number | null
  deviationToday: number | null
  series: (DayPoint & { spend: number; revenue: number; roas: number | null })[]
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
function daysInMonthUTC(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function classify(consecutiveDaysBelow: number, currentDayBelow: boolean): AlertStatus {
  if (consecutiveDaysBelow >= CONSECUTIVE_DAYS_FOR_ALERT) return 'alert'
  if (currentDayBelow) return 'pre-alert'
  return 'ok'
}
function trailingStreak(series: DayPoint[]): number {
  let streak = 0
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].belowThreshold) streak += 1
    else break
  }
  return streak
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    const companyId = ctx.companyId

    const funnels = await metaFunnelsForCompany(companyId)

    // ── Load targets ──────────────────────────────────────────────────────
    const [targetsRow] = await db
      .select({
        leadTargetTotal: marketingTargets.leadTargetTotal,
        leadTargetTelegram: marketingTargets.leadTargetTelegram,
        leadTargetCorso10ore: marketingTargets.leadTargetCorso10ore,
        leadTargetJobsimulator: marketingTargets.leadTargetJobsimulator,
        roasTarget: marketingTargets.roasTarget,
      })
      .from(marketingTargets)
      .where(and(eq(marketingTargets.companyId, companyId), eq(marketingTargets.id, 1)))
      .limit(1)
    if (!targetsRow) {
      return NextResponse.json({ error: 'Target non disponibili' }, { status: 500 })
    }

    const leadTargetTotal = Number(targetsRow.leadTargetTotal ?? 0)
    const leadTargetByFunnel: Record<string, number> = {
      telegram: Number(targetsRow.leadTargetTelegram ?? 0),
      corso10ore: Number(targetsRow.leadTargetCorso10ore ?? 0),
      jobsimulator: Number(targetsRow.leadTargetJobsimulator ?? 0),
    }
    const roasTarget = Number(targetsRow.roasTarget ?? 0)

    // ── Date setup ────────────────────────────────────────────────────────
    const now = new Date()
    const monthStart = startOfMonthUTC(now)
    const totalDaysInMonth = daysInMonthUTC(now)
    const todayIso = isoDate(now)
    const monthStartIso = isoDate(monthStart)
    const daysInMonthSoFar = now.getUTCDate()

    const dayList: string[] = []
    for (let d = 1; d <= daysInMonthSoFar; d++) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d))
      dayList.push(isoDate(dt))
    }

    // ── Leads MTD: aggregate per day per funnel ────────────────────────────
    const leadsRows = await getLeadsInRange(companyId, { from: monthStartIso, to: todayIso })
    const leadsByDayFunnel: Record<string, Record<string, number>> = {}
    for (const dayIso of dayList) leadsByDayFunnel[dayIso] = {}
    for (const r of leadsRows) {
      const dayIso = (r.cdate ?? '').slice(0, 10)
      if (!dayIso || !leadsByDayFunnel[dayIso]) continue
      const fid = r.funnel_id ?? '__none__'
      leadsByDayFunnel[dayIso][fid] = (leadsByDayFunnel[dayIso][fid] ?? 0) + 1
    }

    function buildLeadSeries(monthlyTarget: number, getDailyLeads: (dayIso: string) => number): DayPoint[] {
      let cumulative = 0
      return dayList.map((dayIso, idx) => {
        const dayOfMonth = idx + 1
        cumulative += getDailyLeads(dayIso)
        const proportionalTarget =
          monthlyTarget > 0 ? (monthlyTarget * dayOfMonth) / totalDaysInMonth : 0
        const deviation =
          proportionalTarget > 0 ? (cumulative - proportionalTarget) / proportionalTarget : null
        const belowThreshold =
          monthlyTarget > 0 && deviation !== null && deviation < LEAD_THRESHOLD
        return {
          date: dayIso,
          actual: cumulative,
          proportionalTarget: Math.round(proportionalTarget * 100) / 100,
          deviation,
          belowThreshold,
        }
      })
    }

    function makeLeadBlock(key: string, label: string, monthlyTarget: number, series: DayPoint[]): LeadAlertBlock {
      const streak = trailingStreak(series)
      const last = series[series.length - 1]
      const currentBelow = last?.belowThreshold ?? false
      return {
        key,
        label,
        monthlyTarget,
        status: monthlyTarget > 0 ? classify(streak, currentBelow) : 'ok',
        consecutiveDaysBelow: streak,
        daysInMonthSoFar,
        totalDaysInMonth,
        proportionalTargetToday: last?.proportionalTarget ?? 0,
        actualToday: last?.actual ?? 0,
        deviationToday: last?.deviation ?? null,
        series,
      }
    }

    const leadBlocks: LeadAlertBlock[] = []
    leadBlocks.push(
      makeLeadBlock(
        'total',
        'Totale',
        leadTargetTotal,
        buildLeadSeries(leadTargetTotal, (dayIso) => {
          const m = leadsByDayFunnel[dayIso] ?? {}
          return Object.values(m).reduce((s, v) => s + v, 0)
        }),
      ),
    )
    for (const f of funnels) {
      leadBlocks.push(
        makeLeadBlock(
          f.id,
          f.name,
          leadTargetByFunnel[f.id] ?? 0,
          buildLeadSeries(leadTargetByFunnel[f.id] ?? 0, (dayIso) => leadsByDayFunnel[dayIso]?.[f.id] ?? 0),
        ),
      )
    }

    // ── ROAS MTD: cumulative spend and revenue per day ─────────────────────
    const accountIds = [...new Set(funnels.map((f) => f.meta_account).filter((x): x is string => !!x))]
    const spendByDay: Record<string, number> = {}
    if (accountIds.length > 0) {
      const spendRows = await db
        .select({ date: metaAccountDaily.date, spend: metaAccountDaily.spend })
        .from(metaAccountDaily)
        .where(
          and(
            eq(metaAccountDaily.companyId, companyId),
            inArray(metaAccountDaily.accountId, accountIds),
            gte(metaAccountDaily.date, monthStartIso),
            lte(metaAccountDaily.date, todayIso),
          ),
        )
      for (const r of spendRows) {
        const k = r.date
        spendByDay[k] = (spendByDay[k] ?? 0) + Number(r.spend ?? 0)
      }
    }

    const salesRows = await getSalesRowsFromDeals(companyId, monthStartIso, todayIso)
    const revenueByDay: Record<string, number> = {}
    for (const r of salesRows) {
      const dayIso = (r.contract_date ?? '').slice(0, 10)
      if (!dayIso) continue
      revenueByDay[dayIso] = (revenueByDay[dayIso] ?? 0) + r.revenue
    }

    let cumSpend = 0
    let cumRevenue = 0
    const roasSeries: RoasAlertBlock['series'] = dayList.map((dayIso) => {
      cumSpend += spendByDay[dayIso] ?? 0
      cumRevenue += revenueByDay[dayIso] ?? 0
      const roas = cumSpend > 0 ? cumRevenue / cumSpend : null
      const deviation = roasTarget > 0 && roas !== null ? (roas - roasTarget) / roasTarget : null
      const belowThreshold = roasTarget > 0 && deviation !== null && deviation < ROAS_THRESHOLD
      return {
        date: dayIso,
        actual: Math.round((roas ?? 0) * 100) / 100,
        proportionalTarget: roasTarget,
        deviation,
        belowThreshold,
        spend: Math.round(cumSpend * 100) / 100,
        revenue: Math.round(cumRevenue * 100) / 100,
        roas: roas !== null ? Math.round(roas * 100) / 100 : null,
      }
    })

    const roasStreak = trailingStreak(roasSeries)
    const roasLast = roasSeries[roasSeries.length - 1]
    const roasBlock: RoasAlertBlock = {
      monthlyTarget: roasTarget,
      status: roasTarget > 0 ? classify(roasStreak, roasLast?.belowThreshold ?? false) : 'ok',
      consecutiveDaysBelow: roasStreak,
      spendMTD: roasLast?.spend ?? 0,
      revenueMTD: roasLast?.revenue ?? 0,
      roasToday: roasLast?.roas ?? null,
      deviationToday: roasLast?.deviation ?? null,
      series: roasSeries,
    }

    return NextResponse.json({
      monthStart: monthStartIso,
      today: todayIso,
      daysInMonthSoFar,
      totalDaysInMonth,
      thresholds: {
        lead: LEAD_THRESHOLD,
        roas: ROAS_THRESHOLD,
        consecutiveDaysForAlert: CONSECUTIVE_DAYS_FOR_ALERT,
      },
      leads: leadBlocks,
      roas: roasBlock,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
