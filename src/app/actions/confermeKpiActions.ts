"use server"

import { db } from "@/db"
import { leads, users, monthlyTargets } from "@/db/schema"
import { eq, and, gte, lte, asc, sql, isNotNull } from "drizzle-orm"
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek, eachWeekOfInterval } from "date-fns"

/** Format a Date to 'yyyy-MM-dd' in Europe/Rome timezone */
function toRomeDateStr(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

export async function getConfermeKpiStats(monthDate: Date = new Date(), confermeUserId?: string) {
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)
    const calendarStart = startOfWeek(start, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(end, { weekStartsOn: 1 })

    const conditionsConfirmations = [
        gte(leads.confirmationsTimestamp, calendarStart),
        lte(leads.confirmationsTimestamp, calendarEnd)
    ]
    if (confermeUserId) {
        conditionsConfirmations.push(eq(leads.confirmationsUserId, confermeUserId))
    }

    const conditionsFixed = [
        gte(leads.appointmentCreatedAt, calendarStart),
        lte(leads.appointmentCreatedAt, calendarEnd)
    ]

    // Fetch confirmed & discarded leads
    const confirmedLeads = await db.select({
        id: leads.id,
        date: leads.confirmationsTimestamp,
        outcome: leads.confirmationsOutcome
    }).from(leads).where(and(...conditionsConfirmations))

    // Fetch fixed leads (all global, since they are fixed by GDOs for Conferme to process)
    const fixedLeadsRaw = await db.select({
        id: leads.id,
        date: leads.appointmentCreatedAt
    }).from(leads).where(and(...conditionsFixed))

    // Grouping by Day
    const daysInMonth = eachDayOfInterval({ start, end })
    const dailyStats = daysInMonth.map(d => {
        const dayStr = format(d, 'yyyy-MM-dd')
        const fixed = fixedLeadsRaw.filter(l => l.date && toRomeDateStr(new Date(l.date)) === dayStr).length
        const confirmed = confirmedLeads.filter(l => l.date && l.outcome === 'confermato' && toRomeDateStr(new Date(l.date)) === dayStr).length
        const discarded = confirmedLeads.filter(l => l.date && l.outcome === 'scartato' && toRomeDateStr(new Date(l.date)) === dayStr).length

        return {
            date: dayStr,
            dayOfWeek: d.getDay(), // 0 = Sunday, 1 = Monday
            fixed,
            confirmed,
            discarded,
        }
    })

    const totalFixed = dailyStats.reduce((acc, curr) => acc + curr.fixed, 0)
    const totalConfirmedAct = dailyStats.reduce((acc, curr) => acc + curr.confirmed, 0)

    // Calculate weekly and monthly targets (single query, no duplication)
    let weeklyTier1Target = 0;
    let weeklyTier2Target = 0;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(eq(users.id, confermeUserId)).limit(1);
        if (userRow.length > 0) {
            weeklyTier1Target = userRow[0].confermeTargetTier1 || 19;
            weeklyTier2Target = userRow[0].confermeTargetTier2 || 24;
        }
    } else {
        const allConferme = await db.select().from(users).where(eq(users.role, 'CONFERME'));
        if (allConferme.length > 0) {
            weeklyTier1Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier1 || 19), 0);
            weeklyTier2Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier2 || 24), 0);
        } else {
            weeklyTier1Target = 19;
            weeklyTier2Target = 24;
        }
    }

    // Monthly targets = weekly * 4
    const tier1Target = weeklyTier1Target * 4;
    const tier2Target = weeklyTier2Target * 4;

    // Build weekly history array based on full ISO weeks that overlap this month
    const weeksInMonth = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }) // Mondays

    const weeklyHistory = weeksInMonth.map((weekStart, index) => {
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

        const actThisWeek = confirmedLeads.filter(l =>
            l.date && l.outcome === 'confermato' &&
            new Date(l.date) >= weekStart &&
            new Date(l.date) <= weekEnd
        ).length;

        const isCurrent = new Date() >= weekStart && new Date() <= weekEnd

        return {
            weekName: `Sett. ${index + 1}`,
            dateRange: `${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')}`,
            act: actThisWeek,
            t1: weeklyTier1Target,
            t2: weeklyTier2Target,
            hitT1: actThisWeek >= weeklyTier1Target,
            hitT2: actThisWeek >= weeklyTier2Target,
            isCurrent
        }
    })

    const currentWeekData = weeklyHistory.find(w => w.isCurrent) || weeklyHistory[weeklyHistory.length - 1]

    const calcWorkingDaysPassed = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6 && new Date(d.date) <= new Date()).length
    const calcTotalWorkingDays = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6).length

    // Check for manager override of working days
    const monthStr = format(start, 'yyyy-MM')
    const mtQuery = await db.select().from(monthlyTargets).where(eq(monthlyTargets.month, monthStr))
    const overrideVal = mtQuery.length > 0 ? mtQuery[0].workingDaysOverride : null
    const totalWorkingDays = (overrideVal != null && overrideVal > 0) ? overrideVal : calcTotalWorkingDays
    const workingDaysPassed = Math.min(calcWorkingDaysPassed, totalWorkingDays)

    // --- EXCEL FORMULAS & MOCKS ---
    const buildRow = (label: string, actAbs: number, targetMax: number, today: number) => {
        const targetDay = targetMax / (totalWorkingDays || 1)
        const targetPrev = Math.round(targetDay * workingDaysPassed)

        const actPct = targetMax ? (actAbs / targetMax) * 100 : 0
        const prevPct = targetMax ? (targetPrev / targetMax) * 100 : 0

        const scostamentoAbs = actAbs - targetPrev
        const scostamentoPct = targetPrev ? (scostamentoAbs / targetPrev) * 100 : 0

        let badge: 'OK' | 'PRE-RISK' | 'ALLERT' = 'OK'
        if (scostamentoPct < -20) badge = 'ALLERT'
        else if (scostamentoPct < -5) badge = 'PRE-RISK'

        // Mock data primo -20% string if alert
        const dataPrimo = badge === 'ALLERT' ? format(new Date(Date.now() - 3 * 86400000), 'dd/MM/yyyy') : '-'

        return {
            label,
            actAbs,
            actPct,
            prevAbs: targetPrev,
            prevPct,
            targetDay,
            today,
            targetMax,
            scostamentoAbs,
            scostamentoPct,
            dataPrimo,
            badge
        }
    }

    const todayConfirmed = dailyStats.find(d => d.date === toRomeDateStr(new Date()))?.confirmed || 0

    // Appuntamenti
    const rowAppuntamenti = buildRow("Appuntamenti Confermati", totalConfirmedAct, tier2Target, todayConfirmed)

    // Trattative (Mocked: ~65% of Appuntamenti)
    const mockTargetTrat = Math.round(tier2Target * 0.65)
    const mockActTrat = Math.round(totalConfirmedAct * 0.60) // underperforming slightly
    const todayTrat = Math.round(todayConfirmed * 0.5)
    const rowTrattative = buildRow("Trattative Presenziate", mockActTrat, mockTargetTrat, todayTrat)

    // Closed (Mocked: ~25% of Trattative)
    const mockTargetClosed = Math.round(mockTargetTrat * 0.25)
    const mockActClosed = Math.round(mockActTrat * 0.20)
    const todayClosed = Math.round(todayTrat * 0.2)
    const rowClosed = buildRow("Closed (Contratti)", mockActClosed, mockTargetClosed, todayClosed)

    const tableData = [rowAppuntamenti, rowTrattative, rowClosed]

    return {
        dailyStats,
        tableData,
        weeklyHistory,
        weekly: {
            confirmedAct: currentWeekData ? currentWeekData.act : 0,
            targetTier1: weeklyTier1Target,
            targetTier2: weeklyTier2Target
        }
    }
}

export async function getConfermeSalesList(monthDate: Date = new Date()) {
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)

    const vendors = await db.select({
        id: users.id,
        displayName: users.displayName,
        name: users.name,
        avatarUrl: users.avatarUrl
    }).from(users).where(eq(users.role, 'VENDITORE'))

    const confirmedAssignments = await db.select({
        salespersonUserId: leads.salespersonUserId,
        count: sql<number>`count(${leads.id})::integer`
    })
        .from(leads)
        .where(and(
            eq(leads.confirmationsOutcome, 'confermato'),
            gte(leads.confirmationsTimestamp, start),
            lte(leads.confirmationsTimestamp, end)
        ))
        .groupBy(leads.salespersonUserId)

    const map = new Map(confirmedAssignments.map(r => [r.salespersonUserId, r.count]))

    const salesList = vendors.map(v => ({
        ...v,
        confirmedAssigned: map.get(v.id) || 0
    })).sort((a, b) => b.confirmedAssigned - a.confirmedAssigned)

    return salesList
}

/**
 * F2-012: Obiettivi giornalieri Conferme — confermati oggi vs target
 */
export async function getConfermeDailyObjectives(confermeUserId: string) {
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const [yearStr, monthStr, dayStr] = todayStr.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    const day = parseInt(dayStr, 10)

    const todayStart = new Date(year, month - 1, day, 0, 0, 0, 0)
    const todayEnd = new Date(year, month - 1, day, 23, 59, 59, 999)

    // Daily conferme target: 8 conferme al giorno per TUTTO IL TEAM (non individuale)
    const dailyTarget = 8

    // Count today's confirmations by ALL conferme operators (team total)
    const confResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.confirmationsUserId),
            gte(leads.confirmationsTimestamp, todayStart),
            lte(leads.confirmationsTimestamp, todayEnd)
        ))
    const confirmationsDone = confResult[0]?.count || 0

    return {
        confirmationsDone,
        confirmationsTarget: dailyTarget,
    }
}
