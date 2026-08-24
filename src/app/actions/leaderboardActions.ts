"use server"

import { db } from "@/db"
import { users, leads, notifications, shopItems, callLogs } from "@/db/schema"
import { eq, and, ne, gte, lt, lte, desc, desc as drizzleDesc, count, isNotNull, sql } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { isRealGdo } from "@/lib/kpi/canon"
import { leaderboardPeriodBounds } from "@/lib/kpi/periodBounds"
import { dayBoundsRome } from "@/lib/dateUtils"

export type LeaderboardPeriod = 'today' | 'week' | 'month'
export type LeaderboardMetric = 'appointments' | 'calls' | 'xp' | 'streak'
export type LeaderboardRole = 'GDO' | 'CONFERME' | 'VENDITORE'

export async function getLeaderboard(period: LeaderboardPeriod) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const now = new Date()
    let startDate: Date
    let endDate: Date

    // Bounds Europe/Rome, end esclusivo (src/lib/kpi/periodBounds.ts). Il
    // commento che stava qui dava per scontato che il fuso fosse gia' gestito:
    // su Vercel il server e' UTC, quindi la settimana era lun-dom UTC.
    ;({ start: startDate, end: endDate } = leaderboardPeriodBounds(period, now))

    // Get all gdos del tenant. Roster canonico: fuori il bot fissatore —
    // fissa ~260 app/mese, 3x il miglior umano, e restava primo in classifica
    // pur avendo la gamification spenta — e fuori i GDO disattivati.
    const allGdos = (await db.select().from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'))))
        .filter(isRealGdo)

    // Get all appointments in the period (tenant-scoped)
    const periodAppointments = await db.select()
        .from(leads)
        .where(
            and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.status, 'APPOINTMENT'),
                gte(leads.appointmentCreatedAt, startDate),
                lt(leads.appointmentCreatedAt, endDate)
            )
        )


    // Aggregate counts
    const counts = new Map<string, number>()
    const recentAppts = new Map<string, number>() // For tie-breaking (who got it first)

    // We map assignedToId to count
    // Wait, the appointment is created by whoever changed the status. In our CRM, 'assignedToId' typically holds the GDO owner.
    // Let's assume assignedToId is the one who took the appointment.
    for (const appt of periodAppointments) {
        if (appt.assignedToId) {
            counts.set(appt.assignedToId, (counts.get(appt.assignedToId) || 0) + 1)

            // store the earliest appointment time as a tie breaker
            const currentRecent = recentAppts.get(appt.assignedToId)
            const apptTime = appt.appointmentCreatedAt?.getTime() || 0
            if (!currentRecent || apptTime < currentRecent) {
                recentAppts.set(appt.assignedToId, apptTime)
            }
        }
    }

    // Fetch skins for fast lookup (tenant-scoped: ogni company ha il suo store)
    const allSkins = await db.select().from(shopItems)
        .where(eq(shopItems.companyId, ctx.companyId))
    const skinMap = new Map(allSkins.map(s => [s.id, s.cssValue]))

    // Build leaderboard
    const leaderboard = allGdos.map(gdo => ({
        userId: gdo.id,
        gdoCode: gdo.gdoCode,
        displayName: gdo.displayName || gdo.name || `GDO ${gdo.gdoCode || '?'}`,
        avatarUrl: gdo.avatarUrl,
        appointmentCount: counts.get(gdo.id) || 0,
        firstApptTime: recentAppts.get(gdo.id) || Infinity,
        equippedSkinCss: gdo.equippedItemId ? (skinMap.get(gdo.equippedItemId) || null) : null,
        activeTitle: gdo.activeTitle || null,
    }))

    // Sort: highest count first. If tie, whoever got it first (lower firstApptTime) is ranked higher.
    leaderboard.sort((a, b) => {
        if (b.appointmentCount !== a.appointmentCount) {
            return b.appointmentCount - a.appointmentCount
        }
        return a.firstApptTime - b.firstApptTime
    })

    // Assign rank
    return leaderboard.map((item, index) => ({
        ...item,
        rank: index + 1
    }))
}

export async function checkLeaderboardOvertake(userId: string) {
    // This is called AFTER the appointment is saved.
    // So the new leaderboard is already reflecting the new appointment.
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Calculate today's leaderboard (already tenant-scoped via currentTenant)
    const currentLeaderboard = await getLeaderboard('today')

    // Find the user who just took the appt
    const userIndex = currentLeaderboard.findIndex(u => u.userId === userId)
    if (userIndex === -1) return

    const currentUserStats = currentLeaderboard[userIndex]

    // Check if they overtook someone. We can deduce they might have overtaken someone if there's someone directly below them
    // that has the exactly same amount of appointments minus 1 (or we can just compare current rank with previous rank if we had the previous one).
    // Wait, actually it's much easier to just simulate the 'previous' leaderboard by removing one appointment from this user.

    const previousLeaderboard = [...currentLeaderboard].map(u => ({
        ...u,
        appointmentCount: u.userId === userId ? u.appointmentCount - 1 : u.appointmentCount,
        // we'll ignore tie-breaker for the simulated previous state for simplicity, or we can just say the rank is primarily driven by count.
    }))

    // Sort previous leaderboard
    previousLeaderboard.sort((a, b) => {
        if (b.appointmentCount !== a.appointmentCount) {
            return b.appointmentCount - a.appointmentCount
        }
        return a.firstApptTime - b.firstApptTime
    })

    const previousUserIndex = previousLeaderboard.findIndex(u => u.userId === userId)

    // If rank improved (index gets smaller)
    if (userIndex < previousUserIndex) {
        // Who did they overtake? Everyone between userIndex and previousUserIndex in the previousLeaderboard.
        // Actually, the people they overtook are exactly the ones who were above them previously, but are now below them.

        const previousListAbove = previousLeaderboard.slice(0, previousUserIndex).map(u => u.userId)
        const currentListAbove = currentLeaderboard.slice(0, userIndex).map(u => u.userId)

        // People overtaken = people who were in previousListAbove but are NOT in currentListAbove
        const overtakenUserIds = previousListAbove.filter(id => !currentListAbove.includes(id))

        const now = new Date()
        const startOfTodayDt = dayBoundsRome(now).start

        for (const overtakenId of overtakenUserIds) {
            const overtakenStats = currentLeaderboard.find(u => u.userId === overtakenId)

            // Anti-spam check: Did they already overtake this person today?
            // A simple check: have we already created a notification of type 'leaderboard_overtaken' 
            // from 'currentUser' to 'overtakenUser' today?
            const existingNotif = (await db.select().from(notifications).where(
                and(
                    eq(notifications.companyId, ctx.companyId),
                    eq(notifications.recipientUserId, overtakenId),
                    eq(notifications.type, 'leaderboard_overtaken'),
                    gte(notifications.createdAt, startOfTodayDt)
                )
            )).find(n => {
                const meta = n.metadata as any
                return meta && meta.overtaker_id === userId
            })

            if (!existingNotif) {
                // Create Notif
                await db.insert(notifications).values({
                    id: crypto.randomUUID(),
                    recipientUserId: overtakenId,
                    type: 'leaderboard_overtaken',
                    title: 'Sei stato superato!',
                    body: `${currentUserStats.displayName || 'Un GDO'} ti ha superato con ${currentUserStats.appointmentCount} appuntamenti (tu: ${overtakenStats?.appointmentCount || 0}).`,
                    metadata: {
                        overtaker_id: userId,
                        overtaken_id: overtakenId,
                        period: 'today',
                        overtaker_count: currentUserStats.appointmentCount,
                        overtaken_count: overtakenStats?.appointmentCount || 0,
                        new_rank: currentUserStats.rank,
                        old_rank: currentUserStats.rank + 1 // roughly
                    },
                    status: 'unread',
                    createdAt: now,
                    companyId: ctx.companyId,
                })
            }
        }
    }
}

// Multi-metric leaderboard: supports appointments, calls, xp, streak
export async function getMultiMetricLeaderboard(period: LeaderboardPeriod, metric: LeaderboardMetric) {
    if (metric === 'appointments') {
        return getLeaderboard(period);
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const now = new Date()
    let startDate: Date
    let endDate: Date

    ;({ start: startDate, end: endDate } = leaderboardPeriodBounds(period, now))

    const allGdos = (await db.select().from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'))))
        .filter(isRealGdo)
    const allSkins = await db.select().from(shopItems)
        .where(eq(shopItems.companyId, ctx.companyId))
    const skinMap = new Map(allSkins.map(s => [s.id, s.cssValue]))

    if (metric === 'calls') {
        // Count calls in the period per user (tenant-scoped)
        const periodCalls = await db.select()
            .from(callLogs)
            .where(
                and(
                    eq(callLogs.companyId, ctx.companyId),
                    gte(callLogs.createdAt, startDate),
                    lt(callLogs.createdAt, endDate)
                )
            )

        const callCounts = new Map<string, number>()
        for (const call of periodCalls) {
            if (call.userId) {
                callCounts.set(call.userId, (callCounts.get(call.userId) || 0) + 1)
            }
        }

        const leaderboard = allGdos.map(gdo => ({
            userId: gdo.id,
            gdoCode: gdo.gdoCode,
            displayName: gdo.displayName || gdo.name || `GDO ${gdo.gdoCode || '?'}`,
            avatarUrl: gdo.avatarUrl,
            metricValue: callCounts.get(gdo.id) || 0,
            metricLabel: 'Chiamate',
            equippedSkinCss: gdo.equippedItemId ? (skinMap.get(gdo.equippedItemId) || null) : null,
            activeTitle: gdo.activeTitle || null,
            appointmentCount: callCounts.get(gdo.id) || 0,
            firstApptTime: Infinity,
        }))

        leaderboard.sort((a, b) => b.metricValue - a.metricValue)
        return leaderboard.map((item, index) => ({ ...item, rank: index + 1 }))
    }

    if (metric === 'xp') {
        // XP is a lifetime stat from users.experience — no date filter
        const leaderboard = allGdos.map(gdo => ({
            userId: gdo.id,
            gdoCode: gdo.gdoCode,
            displayName: gdo.displayName || gdo.name || `GDO ${gdo.gdoCode || '?'}`,
            avatarUrl: gdo.avatarUrl,
            metricValue: gdo.experience || 0,
            metricLabel: 'XP',
            equippedSkinCss: gdo.equippedItemId ? (skinMap.get(gdo.equippedItemId) || null) : null,
            activeTitle: gdo.activeTitle || null,
            appointmentCount: gdo.experience || 0,
            firstApptTime: Infinity,
        }))

        leaderboard.sort((a, b) => b.metricValue - a.metricValue)
        return leaderboard.map((item, index) => ({ ...item, rank: index + 1 }))
    }

    if (metric === 'streak') {
        // Streak is a current-state stat from users.streakCount — no date filter
        const leaderboard = allGdos.map(gdo => ({
            userId: gdo.id,
            gdoCode: gdo.gdoCode,
            displayName: gdo.displayName || gdo.name || `GDO ${gdo.gdoCode || '?'}`,
            avatarUrl: gdo.avatarUrl,
            metricValue: gdo.streakCount || 0,
            metricLabel: 'Giorni Streak',
            equippedSkinCss: gdo.equippedItemId ? (skinMap.get(gdo.equippedItemId) || null) : null,
            activeTitle: gdo.activeTitle || null,
            appointmentCount: gdo.streakCount || 0,
            firstApptTime: Infinity,
        }))

        leaderboard.sort((a, b) => b.metricValue - a.metricValue)
        return leaderboard.map((item, index) => ({ ...item, rank: index + 1 }))
    }

    return []
}

// Player of the Week: auto-selects the top GDO for this week by appointments
export async function getPlayerOfTheWeek() {
    const leaderboard = await getLeaderboard('week')
    if (leaderboard.length === 0 || leaderboard[0].appointmentCount === 0) {
        return null
    }

    const top = leaderboard[0]
    return {
        userId: top.userId,
        displayName: top.displayName,
        gdoCode: top.gdoCode,
        avatarUrl: top.avatarUrl,
        appointmentCount: top.appointmentCount,
        equippedSkinCss: top.equippedSkinCss,
        activeTitle: top.activeTitle,
    }
}

// Conferme leaderboard: ranked by confirmed appointments count
export async function getConfermeLeaderboard(period: LeaderboardPeriod) {
    const now = new Date()
    let startDate: Date
    let endDate: Date

    ;({ start: startDate, end: endDate } = leaderboardPeriodBounds(period, now))

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const allConferme = await db.select().from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'CONFERME')))
    const allSkins = await db.select().from(shopItems)
        .where(eq(shopItems.companyId, ctx.companyId))
    const skinMap = new Map(allSkins.map(s => [s.id, s.cssValue]))

    // Count confirmed appointments per conferme user in the period
    const confirmedLeads = await db.select()
        .from(leads)
        .where(
            and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.confirmationsOutcome, 'confermato'),
                gte(leads.confirmationsTimestamp, startDate),
                lt(leads.confirmationsTimestamp, endDate)
            )
        )

    const counts = new Map<string, number>()
    for (const lead of confirmedLeads) {
        if (lead.confirmationsUserId) {
            counts.set(lead.confirmationsUserId, (counts.get(lead.confirmationsUserId) || 0) + 1)
        }
    }

    const leaderboard = allConferme.map(user => ({
        userId: user.id,
        gdoCode: user.gdoCode,
        displayName: user.displayName || user.name || 'Conferme',
        avatarUrl: user.avatarUrl,
        appointmentCount: counts.get(user.id) || 0,
        metricValue: counts.get(user.id) || 0,
        metricLabel: 'Conferme',
        firstApptTime: Infinity,
        equippedSkinCss: user.equippedItemId ? (skinMap.get(user.equippedItemId) || null) : null,
        activeTitle: user.activeTitle || null,
    }))

    leaderboard.sort((a, b) => b.metricValue - a.metricValue)
    return leaderboard.map((item, index) => ({ ...item, rank: index + 1 }))
}

// Venditori leaderboard: ranked by fatturato (revenue)
export async function getVenditoriLeaderboard(period: LeaderboardPeriod) {
    const now = new Date()
    let startDate: Date
    let endDate: Date

    ;({ start: startDate, end: endDate } = leaderboardPeriodBounds(period, now))

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const allVenditori = await db.select().from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'VENDITORE')))
    const allSkins = await db.select().from(shopItems)
        .where(eq(shopItems.companyId, ctx.companyId))
    const skinMap = new Map(allSkins.map(s => [s.id, s.cssValue]))

    // Get closed deals in the period (tenant-scoped)
    const closedDeals = await db.select()
        .from(leads)
        .where(
            and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.salespersonOutcome, 'Chiuso'),
                gte(leads.salespersonOutcomeAt, startDate),
                lt(leads.salespersonOutcomeAt, endDate)
            )
        )

    const fatturato = new Map<string, number>()
    for (const deal of closedDeals) {
        if (deal.salespersonUserId) {
            fatturato.set(deal.salespersonUserId, (fatturato.get(deal.salespersonUserId) || 0) + Number(deal.closeAmountEur || 0))
        }
    }

    const leaderboard = allVenditori.map(user => ({
        userId: user.id,
        gdoCode: user.gdoCode,
        displayName: user.displayName || user.name || 'Venditore',
        avatarUrl: user.avatarUrl,
        appointmentCount: fatturato.get(user.id) || 0,
        metricValue: fatturato.get(user.id) || 0,
        metricLabel: 'Fatturato €',
        firstApptTime: Infinity,
        equippedSkinCss: user.equippedItemId ? (skinMap.get(user.equippedItemId) || null) : null,
        activeTitle: user.activeTitle || null,
    }))

    leaderboard.sort((a, b) => b.metricValue - a.metricValue)
    return leaderboard.map((item, index) => ({ ...item, rank: index + 1 }))
}

// Role-based leaderboard dispatcher
export async function getRoleLeaderboard(period: LeaderboardPeriod, role: LeaderboardRole) {
    if (role === 'CONFERME') return getConfermeLeaderboard(period)
    if (role === 'VENDITORE') return getVenditoriLeaderboard(period)
    return getLeaderboard(period) // GDO default
}

// Get lifetime stats for a user (profile page)
export async function getUserLifetimeStats(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const [callResult, apptResult, userRow] = await Promise.all([
        db.select({ value: count() })
            .from(callLogs)
            .where(and(eq(callLogs.companyId, ctx.companyId), eq(callLogs.userId, userId))),
        db.select({ value: count() })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.assignedToId, userId),
                isNotNull(leads.appointmentCreatedAt)
            )),
        db.select({
            level: users.level,
            experience: users.experience,
            streakCount: users.streakCount,
            coins: users.coins,
            walletCoins: users.walletCoins,
        }).from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.id, userId))),
    ])

    return {
        totalCalls: callResult[0]?.value ?? 0,
        totalAppointments: apptResult[0]?.value ?? 0,
        level: userRow[0]?.level ?? 1,
        totalXp: userRow[0]?.experience ?? 0,
        currentStreak: userRow[0]?.streakCount ?? 0,
        totalCoins: (userRow[0]?.coins ?? 0) + (userRow[0]?.walletCoins ?? 0),
    }
}
