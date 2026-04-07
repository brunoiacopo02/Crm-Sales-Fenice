"use server"

import { db } from "@/db"
import { users, leads, notifications, shopItems } from "@/db/schema"
import { eq, and, ne, gte, lte, desc, desc as drizzleDesc } from "drizzle-orm"
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns"
import crypto from "crypto"

export type LeaderboardPeriod = 'today' | 'week' | 'month'

export async function getLeaderboard(period: LeaderboardPeriod) {
    const now = new Date()
    let startDate: Date
    let endDate: Date

    // Assuming timezone offset is already correctly handled by server runtime or date-fns
    if (period === 'today') {
        startDate = startOfDay(now)
        endDate = endOfDay(now)
    } else if (period === 'week') {
        // week starts on Monday (1)
        startDate = startOfWeek(now, { weekStartsOn: 1 })
        endDate = endOfWeek(now, { weekStartsOn: 1 })
    } else {
        startDate = startOfMonth(now)
        endDate = endOfMonth(now)
    }

    // Get all gdos
    const allGdos = await db.select().from(users).where(eq(users.role, 'GDO'))

    // Get all appointments in the period
    const periodAppointments = await db.select()
        .from(leads)
        .where(
            and(
                eq(leads.status, 'APPOINTMENT'),
                gte(leads.appointmentCreatedAt, startDate),
                lte(leads.appointmentCreatedAt, endDate)
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

    // Fetch skins for fast lookup
    const allSkins = await db.select().from(shopItems)
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

    // Calculate today's leaderboard
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
        const startOfTodayDt = startOfDay(now)

        for (const overtakenId of overtakenUserIds) {
            const overtakenStats = currentLeaderboard.find(u => u.userId === overtakenId)

            // Anti-spam check: Did they already overtake this person today?
            // A simple check: have we already created a notification of type 'leaderboard_overtaken' 
            // from 'currentUser' to 'overtakenUser' today?
            const existingNotif = (await db.select().from(notifications).where(
                and(
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
                    createdAt: now
                })
            }
        }
    }
}
