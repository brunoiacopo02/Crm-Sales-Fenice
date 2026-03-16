"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, and, gte, lte, asc, sql } from "drizzle-orm"
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek } from "date-fns"

export async function getConfermeKpiStats(monthDate: Date = new Date(), confermeUserId?: string) {
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)

    const conditionsConfirmations = [
        gte(leads.confirmationsTimestamp, start),
        lte(leads.confirmationsTimestamp, end)
    ]
    if (confermeUserId) {
        conditionsConfirmations.push(eq(leads.confirmationsUserId, confermeUserId))
    }

    const conditionsFixed = [
        gte(leads.appointmentCreatedAt, start),
        lte(leads.appointmentCreatedAt, end)
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
        const fixed = fixedLeadsRaw.filter(l => l.date && format(new Date(l.date), 'yyyy-MM-dd') === dayStr).length
        const confirmed = confirmedLeads.filter(l => l.date && l.outcome === 'confermato' && format(new Date(l.date), 'yyyy-MM-dd') === dayStr).length
        const discarded = confirmedLeads.filter(l => l.date && l.outcome === 'scartato' && format(new Date(l.date), 'yyyy-MM-dd') === dayStr).length

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

    // Calculate Targets based on user info if confermeUserId is provided, else aggregate defaults
    let tier1Target = 0;
    let tier2Target = 0;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(eq(users.id, confermeUserId)).limit(1);
        if (userRow.length > 0) {
            tier1Target = (userRow[0].confermeTargetTier1 || 19) * 4;
            tier2Target = (userRow[0].confermeTargetTier2 || 24) * 4;
        }
    } else {
        // Aggregate for the whole conferme team
        const allConferme = await db.select().from(users).where(eq(users.role, 'CONFERME'));
        if (allConferme.length > 0) {
            tier1Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier1 || 19), 0) * 4;
            tier2Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier2 || 24), 0) * 4;
        } else {
            tier1Target = 19 * 4;
            tier2Target = 24 * 4;
        }
    }

    // For weekly targets visual progress bar on the current week
    const currentStartOfWeek = startOfWeek(new Date(), { weekStartsOn: 1 }) // Monday
    const currentEndOfWeek = endOfWeek(new Date(), { weekStartsOn: 1 })

    let weeklyConfirmedAct = 0;
    if (monthDate.getMonth() === new Date().getMonth()) {
        weeklyConfirmedAct = confirmedLeads.filter(l =>
            l.date && l.outcome === 'confermato' &&
            new Date(l.date) >= currentStartOfWeek &&
            new Date(l.date) <= currentEndOfWeek
        ).length;
    }

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

    const workingDaysPassed = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6 && new Date(d.date) <= new Date()).length
    const totalWorkingDays = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6).length

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

    const todayConfirmed = dailyStats.find(d => d.date === format(new Date(), 'yyyy-MM-dd'))?.confirmed || 0

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
        weekly: {
            confirmedAct: weeklyConfirmedAct,
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
