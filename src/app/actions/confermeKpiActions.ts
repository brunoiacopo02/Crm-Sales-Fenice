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
    let tier1Target = 19 * 4; // approximate month
    let tier2Target = 24 * 4;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(eq(users.id, confermeUserId)).limit(1);
        if (userRow.length > 0) {
            tier1Target = (userRow[0].confermeTargetTier1 || 19) * 4;
            tier2Target = (userRow[0].confermeTargetTier2 || 24) * 4;
        }
    } else {
        // Alternatively, calculate for the whole team if no userId. Or assume global target.
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

    let weeklyTier1Target = 19;
    let weeklyTier2Target = 24;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(eq(users.id, confermeUserId)).limit(1);
        if (userRow.length > 0) {
            weeklyTier1Target = userRow[0].confermeTargetTier1 || 19;
            weeklyTier2Target = userRow[0].confermeTargetTier2 || 24;
        }
    }

    return {
        dailyStats,
        monthly: {
            fixed: totalFixed,
            confirmedAct: totalConfirmedAct,
            targetTier1: tier1Target,
            targetTier2: tier2Target,
            // Calculate pace based on how many days have passed
            workingDaysPassed: dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6 && new Date(d.date) <= new Date()).length,
            totalWorkingDays: dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6).length
        },
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
