"use server"

import { db } from "@/db"
import { sprints, users, leads, coinTransactions, shopItems } from "@/db/schema"
import { eq, and, desc, gte, lte } from "drizzle-orm"
import { addMinutes, isAfter } from "date-fns"
import crypto from "crypto"

export async function getActiveSprint() {
    return (await db.select()
            .from(sprints)
            .where(eq(sprints.status, 'active'))
            .orderBy(desc(sprints.createdAt)))
        [0] || null
}

export async function checkAndCompleteExpiredSprint(calledByAdminOrManager: boolean = false) {
    const activeSprint = await getActiveSprint()
    if (!activeSprint) return null

    const now = new Date()

    // If it's expired
    if (isAfter(now, activeSprint.endTime) || calledByAdminOrManager) {
        // Find who won during this sprint timeframe
        const results = await getSprintLeaderboard(activeSprint.id)

        // Find highest score > 0
        let highestScore = 0
        const winners: string[] = []

        if (results.length > 0) {
            highestScore = results[0].appointmentCount
            if (highestScore > 0) {
                for (let r of results) {
                    if (r.appointmentCount === highestScore) {
                        winners.push(r.userId)
                    }
                }
            }
        }

        // Add 1 coin to all winners
        for (const winnerId of winners) {
            const user = (await db.select().from(users).where(eq(users.id, winnerId)))[0]
            if (user) {
                await db.update(users)
                                    .set({ walletCoins: (user.walletCoins || 0) + 1 })
                                    .where(eq(users.id, winnerId))
                    

                await db.insert(coinTransactions).values({
                                    id: crypto.randomUUID(),
                                    userId: winnerId,
                                    amount: 1,
                                    reason: 'SPRINT_WON',
                                    createdAt: now
                                })
            }
        }

        // Close the sprint
        await db.update(sprints)
                    .set({
                        status: 'completed',
                        actualEndTime: now
                    })
                    .where(eq(sprints.id, activeSprint.id))
            

        return { closed: true, sprint: activeSprint, winners }
    }

    return { closed: false, sprint: activeSprint }
}

export async function startSprint(durationMinutes: number, managerId: string) {
    const active = await getActiveSprint()
    if (active) throw new Error("Uno Sprint è già in corso.")

    const now = new Date()
    const endTime = addMinutes(now, durationMinutes)

    const sprintId = crypto.randomUUID()
    await db.insert(sprints).values({
            id: sprintId,
            startTime: now,
            endTime: endTime,
            status: 'active',
            startedByManagerId: managerId,
            createdAt: now
        })

    return sprintId
}

export async function stopSprintForce(sprintId: string) {
    const active = (await db.select().from(sprints).where(eq(sprints.id, sprintId)))[0]
    if (!active || active.status !== 'active') return

    // Evaluate logic right away
    return await checkAndCompleteExpiredSprint(true)
}

export async function getSprintLeaderboard(sprintId?: string) {

    // Find sprint
    let sprintWindow = await getActiveSprint()
    if (sprintId) {
        sprintWindow = (await db.select().from(sprints).where(eq(sprints.id, sprintId)))[0] || null
    }

    if (!sprintWindow) return []

    // Get all gdos
    const allGdos = await db.select().from(users).where(eq(users.role, 'GDO'))

    // Get all appointments created within this sprint explicitly
    const sprintApps = await db.select()
            .from(leads)
            .where(
                and(
                    eq(leads.status, 'APPOINTMENT'),
                    gte(leads.appointmentCreatedAt, sprintWindow.startTime),
                    // We use now() if active, or actualEndTime/endTime if closed
                    lte(leads.appointmentCreatedAt, sprintWindow.actualEndTime || sprintWindow.endTime)
                )
            )
        

    const counts = new Map<string, number>()

    for (const appt of sprintApps) {
        if (appt.assignedToId) {
            counts.set(appt.assignedToId, (counts.get(appt.assignedToId) || 0) + 1)
        }
    }

    const allSkins = await db.select().from(shopItems)
    const skinMap = new Map(allSkins.map(s => [s.id, s.cssValue]))

    const leaderboard = allGdos.map(gdo => ({
        userId: gdo.id,
        gdoCode: gdo.gdoCode,
        displayName: gdo.displayName || gdo.name || `GDO ${gdo.gdoCode || '?'}`,
        avatarUrl: gdo.avatarUrl,
        appointmentCount: counts.get(gdo.id) || 0,
        equippedSkinCss: gdo.equippedItemId ? (skinMap.get(gdo.equippedItemId) || null) : null
    }))

    leaderboard.sort((a, b) => b.appointmentCount - a.appointmentCount)

    return leaderboard.map((item, index) => ({
        ...item,
        rank: index + 1
    }))
}

export async function getUserWalletCoins(userId: string) {
    const user = await (await db.select({ walletCoins: users.walletCoins }).from(users).where(eq(users.id, userId)))[0]
    return user?.walletCoins || 0
}
