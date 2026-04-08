"use server"

import { db } from "@/db"
import { sprints, users, leads, coinTransactions, shopItems } from "@/db/schema"
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm"
import { addMinutes, isAfter, differenceInMinutes } from "date-fns"
import crypto from "crypto"
import { GAME_CONSTANTS } from "@/lib/gamificationEngine"
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils"

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

        // Calculate proportional sprint reward (1-25 coins based on duration)
        const sprintDurationMin = differenceInMinutes(
            activeSprint.actualEndTime || activeSprint.endTime,
            activeSprint.startTime
        );
        const { MAX_COINS, BASE_DURATION_MINUTES } = GAME_CONSTANTS.SPRINT_WIN;
        const baseRewardCoins = Math.max(1, Math.min(MAX_COINS, Math.round(sprintDurationMin * MAX_COINS / BASE_DURATION_MINUTES)));

        // Apply seasonal event multiplier
        const eventMult = await getActiveEventMultipliers();
        const sprintRewardCoins = Math.floor(baseRewardCoins * eventMult.coins);

        // Award proportional coins to all winners (batch: single UPDATE + batch INSERT)
        if (winners.length > 0) {
            // Single UPDATE for all winners using SQL increment
            await db.update(users)
                .set({ walletCoins: sql`COALESCE(${users.walletCoins}, 0) + ${sprintRewardCoins}` })
                .where(inArray(users.id, winners))

            const sprintReason = eventMult.coins > 1
                ? `SPRINT_WON (${sprintDurationMin}min, x${eventMult.coins} evento)`
                : `SPRINT_WON (${sprintDurationMin}min)`;

            // Batch INSERT all coin transactions
            await db.insert(coinTransactions).values(
                winners.map(winnerId => ({
                    id: crypto.randomUUID(),
                    userId: winnerId,
                    amount: sprintRewardCoins,
                    reason: sprintReason,
                    createdAt: now
                }))
            )
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

export async function getUserLevelProgress(userId: string) {
    const user = await (await db.select({
        level: users.level,
        experience: users.experience,
    }).from(users).where(eq(users.id, userId)))[0]
    if (!user) return null
    const targetXp = GAME_CONSTANTS.calculateTargetXp(user.level)
    return {
        level: user.level,
        experience: user.experience,
        targetXp,
        progressPercent: targetXp > 0 ? Math.min((user.experience / targetXp) * 100, 100) : 0,
        remainingXp: Math.max(targetXp - user.experience, 0),
    }
}
