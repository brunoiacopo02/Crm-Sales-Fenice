'use server';

import { db } from "@/db";
import { users, coinTransactions } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { getStreakMultiplier } from "@/lib/streakUtils";

// --- Helpers ---

function getTodayRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

function getTodayStartUTC(): Date {
    // Get start of today in Rome timezone as UTC
    const todayRome = getTodayRome();
    // Create date at midnight Rome time — approximate by using the date string
    return new Date(todayRome + 'T00:00:00+02:00'); // CEST (summer) — conservative
}

// --- Server Actions ---

/**
 * Check if the user has already claimed the daily login bonus today.
 * Returns streak info for the modal display.
 */
export async function checkDailyLoginStatus(userId: string): Promise<{
    alreadyClaimed: boolean;
    streakCount: number;
    bonusCoins: number;
    userName: string;
}> {
    try {
        const userRows = await db.select({
            streakCount: users.streakCount,
            lastStreakDate: users.lastStreakDate,
            name: users.name,
            displayName: users.displayName,
        }).from(users).where(eq(users.id, userId));

        if (userRows.length === 0) {
            return { alreadyClaimed: true, streakCount: 0, bonusCoins: 0, userName: '' };
        }

        const user = userRows[0];
        const today = getTodayRome();

        // Check if already claimed today by looking at coinTransactions
        const todayStart = getTodayStartUTC();
        const existingClaims = await db.select({ id: coinTransactions.id })
            .from(coinTransactions)
            .where(
                and(
                    eq(coinTransactions.userId, userId),
                    eq(coinTransactions.reason, 'Daily login bonus'),
                    gte(coinTransactions.createdAt, todayStart)
                )
            );

        const alreadyClaimed = existingClaims.length > 0;

        // Get effective streak (check if broken)
        let effectiveStreak = user.streakCount;
        if (user.lastStreakDate && user.lastStreakDate !== today) {
            const d = new Date(today + 'T12:00:00');
            // Walk back to find previous workday
            const prev = new Date(d);
            do {
                prev.setDate(prev.getDate() - 1);
            } while (prev.getDay() === 0 || prev.getDay() === 6);
            const prevWorkday = prev.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

            if (user.lastStreakDate !== prevWorkday) {
                effectiveStreak = 0;
            }
        }

        // Calculate bonus: +5 base, +10 if streak >= 3, +20 if streak >= 7
        let bonusCoins = 5;
        if (effectiveStreak >= 7) {
            bonusCoins = 20;
        } else if (effectiveStreak >= 3) {
            bonusCoins = 10;
        }

        return {
            alreadyClaimed,
            streakCount: effectiveStreak,
            bonusCoins,
            userName: user.displayName || user.name || 'Operatore',
        };
    } catch (error) {
        console.error("Errore checkDailyLoginStatus:", error);
        return { alreadyClaimed: true, streakCount: 0, bonusCoins: 0, userName: '' };
    }
}

/**
 * Claim the daily login bonus. Idempotent — only awards once per day.
 * Returns coins awarded and streak info.
 */
export async function claimDailyLogin(userId: string): Promise<{
    success: boolean;
    coinsAwarded: number;
    streakCount: number;
    multiplier: number;
}> {
    try {
        const todayStart = getTodayStartUTC();

        // Idempotency check
        const existingClaims = await db.select({ id: coinTransactions.id })
            .from(coinTransactions)
            .where(
                and(
                    eq(coinTransactions.userId, userId),
                    eq(coinTransactions.reason, 'Daily login bonus'),
                    gte(coinTransactions.createdAt, todayStart)
                )
            );

        if (existingClaims.length > 0) {
            // Already claimed, return current state
            const userRow = await db.select({
                streakCount: users.streakCount,
                coins: users.coins,
            }).from(users).where(eq(users.id, userId));
            const streak = userRow[0]?.streakCount ?? 0;
            return { success: true, coinsAwarded: 0, streakCount: streak, multiplier: getStreakMultiplier(streak) };
        }

        // Get user data
        const userRows = await db.select({
            streakCount: users.streakCount,
            lastStreakDate: users.lastStreakDate,
            coins: users.coins,
        }).from(users).where(eq(users.id, userId));

        if (userRows.length === 0) {
            return { success: false, coinsAwarded: 0, streakCount: 0, multiplier: 1 };
        }

        const user = userRows[0];
        const today = getTodayRome();

        // Get effective streak
        let effectiveStreak = user.streakCount;
        if (user.lastStreakDate && user.lastStreakDate !== today) {
            const d = new Date(today + 'T12:00:00');
            const prev = new Date(d);
            do {
                prev.setDate(prev.getDate() - 1);
            } while (prev.getDay() === 0 || prev.getDay() === 6);
            const prevWorkday = prev.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
            if (user.lastStreakDate !== prevWorkday) {
                effectiveStreak = 0;
            }
        }

        // Calculate bonus
        let bonusCoins = 5;
        if (effectiveStreak >= 7) {
            bonusCoins = 20;
        } else if (effectiveStreak >= 3) {
            bonusCoins = 10;
        }

        // Award coins
        await db.update(users).set({
            coins: user.coins + bonusCoins,
        }).where(eq(users.id, userId));

        // Log transaction
        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount: bonusCoins,
            reason: 'Daily login bonus',
        });

        return {
            success: true,
            coinsAwarded: bonusCoins,
            streakCount: effectiveStreak,
            multiplier: getStreakMultiplier(effectiveStreak),
        };
    } catch (error) {
        console.error("Errore claimDailyLogin:", error);
        return { success: false, coinsAwarded: 0, streakCount: 0, multiplier: 1 };
    }
}
