'use server';

import { db } from "@/db";
import { users, coinTransactions, notifications } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStreakMultiplier, getStreakTierLabel, getNextStreakMilestone } from "@/lib/streakUtils";
import { GAME_CONSTANTS } from "@/lib/gamificationEngine";
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils";

// --- Helpers ---

function getTodayRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

/**
 * Check if a date string (YYYY-MM-DD) is a workday (Mon-Fri).
 */
function isWorkday(dateStr: string): boolean {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=Sun, 6=Sat
    return day >= 1 && day <= 5;
}

/**
 * Get the previous workday from a given date string (YYYY-MM-DD).
 * Skips weekends backwards.
 */
function getPreviousWorkday(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    do {
        d.setDate(d.getDate() - 1);
    } while (!isWorkday(d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })));
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

// --- Server Actions ---

/**
 * Get streak info for a user (for UI display).
 */
export async function getStreakInfo(userId: string): Promise<{
    streakCount: number;
    multiplier: number;
    tierLabel: string;
    nextMilestone: { daysToNext: number; nextMultiplier: number } | null;
    isActiveToday: boolean;
}> {
    try {
        const userRows = await db.select({
            streakCount: users.streakCount,
            lastStreakDate: users.lastStreakDate,
        }).from(users).where(eq(users.id, userId));

        if (userRows.length === 0) {
            return { streakCount: 0, multiplier: 1, tierLabel: 'x1', nextMilestone: { daysToNext: 3, nextMultiplier: 1.5 }, isActiveToday: false };
        }

        const user = userRows[0];
        const today = getTodayRome();
        const isActiveToday = user.lastStreakDate === today;

        // Check if streak is still valid (not broken)
        let effectiveStreak = user.streakCount;
        if (user.lastStreakDate && !isActiveToday) {
            const prevWorkday = getPreviousWorkday(today);
            if (user.lastStreakDate !== prevWorkday && user.lastStreakDate !== today) {
                // Streak is broken — last activity was before the previous workday
                effectiveStreak = 0;
            }
        }

        return {
            streakCount: effectiveStreak,
            multiplier: getStreakMultiplier(effectiveStreak),
            tierLabel: getStreakTierLabel(effectiveStreak),
            nextMilestone: getNextStreakMilestone(effectiveStreak),
            isActiveToday,
        };
    } catch (error) {
        console.error("Errore getStreakInfo:", error);
        return { streakCount: 0, multiplier: 1, tierLabel: 'x1', nextMilestone: { daysToNext: 3, nextMultiplier: 1.5 }, isActiveToday: false };
    }
}

/**
 * Update the streak when a GDO completes at least 1 quest today.
 * Called from completeQuest — idempotent for the same day.
 * Returns the updated multiplier.
 */
export async function updateStreak(userId: string): Promise<{ streakCount: number; multiplier: number }> {
    try {
        const userRows = await db.select({
            streakCount: users.streakCount,
            lastStreakDate: users.lastStreakDate,
        }).from(users).where(eq(users.id, userId));

        if (userRows.length === 0) return { streakCount: 0, multiplier: 1 };

        const user = userRows[0];
        const today = getTodayRome();

        // Already updated today — idempotent
        if (user.lastStreakDate === today) {
            return { streakCount: user.streakCount, multiplier: getStreakMultiplier(user.streakCount) };
        }

        let newStreak: number;

        if (!user.lastStreakDate) {
            // First ever streak day
            newStreak = 1;
        } else {
            const prevWorkday = getPreviousWorkday(today);
            if (user.lastStreakDate === prevWorkday) {
                // Consecutive workday — increment streak
                newStreak = user.streakCount + 1;
            } else {
                // Streak broken — restart at 1
                newStreak = 1;
            }
        }

        await db.update(users).set({
            streakCount: newStreak,
            lastStreakDate: today,
        }).where(eq(users.id, userId));

        // Streak milestone reward: 50 coins every 7 days (F2-026) + seasonal event multiplier
        const { COINS: milestoneCoinReward, INTERVAL: milestoneInterval } = GAME_CONSTANTS.STREAK_MILESTONE;
        if (newStreak > 0 && newStreak % milestoneInterval === 0) {
            const userRow = (await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId)))[0];
            if (userRow) {
                const eventMult = await getActiveEventMultipliers();
                const effectiveMilestoneCoins = Math.floor(milestoneCoinReward * eventMult.coins);
                await db.update(users).set({ coins: userRow.coins + effectiveMilestoneCoins }).where(eq(users.id, userId));
                const milestoneReason = eventMult.coins > 1
                    ? `Streak milestone: ${newStreak} giorni! (x${eventMult.coins} evento)`
                    : `Streak milestone: ${newStreak} giorni!`;
                await db.insert(coinTransactions).values({
                    id: crypto.randomUUID(),
                    userId,
                    amount: effectiveMilestoneCoins,
                    reason: milestoneReason,
                });
                await db.insert(notifications).values({
                    id: crypto.randomUUID(),
                    recipientUserId: userId,
                    type: 'streak_milestone',
                    title: `Streak ${newStreak} giorni!`,
                    body: `Hai raggiunto ${newStreak} giorni di streak consecutivi! +${effectiveMilestoneCoins} coins bonus.`,
                    metadata: { streakCount: newStreak, coinsAwarded: effectiveMilestoneCoins },
                });
            }
        }

        return { streakCount: newStreak, multiplier: getStreakMultiplier(newStreak) };
    } catch (error) {
        console.error("Errore updateStreak:", error);
        return { streakCount: 0, multiplier: 1 };
    }
}
