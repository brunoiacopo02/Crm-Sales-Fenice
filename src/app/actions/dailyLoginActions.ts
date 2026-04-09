'use server';

import { db } from "@/db";
import { users, coinTransactions } from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { getStreakMultiplier } from "@/lib/streakUtils";

// --- Constants ---

/** Escalating daily rewards Mon → Sun */
const WEEKLY_REWARDS = [5, 8, 12, 15, 20, 30, 50];
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const SUNDAY_BASE_REWARD = 15;
const WEEKLY_BONUS_TITLE = 'Maratoneta Settimanale';

// --- Helpers ---

function getTodayRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

function getTodayStartUTC(): Date {
    const todayRome = getTodayRome();
    return new Date(todayRome + 'T00:00:00+02:00');
}

function getWeekMondayStr(): string {
    const today = getTodayRome();
    const d = new Date(today + 'T12:00:00');
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d.toLocaleDateString('en-CA');
}

function getTodayWeekIndex(): number {
    const today = getTodayRome();
    const d = new Date(today + 'T12:00:00');
    const day = d.getDay(); // 0=Sun
    return day === 0 ? 6 : day - 1; // 0=Mon, 6=Sun
}

// --- Types ---

export interface DayCalendarEntry {
    label: string;
    date: string;
    reward: number;
    status: 'claimed' | 'missed' | 'today' | 'future';
    isStreakBonus: boolean;
}

// --- Server Actions ---

/**
 * Check daily login status + weekly calendar data for the modal.
 */
export async function checkDailyLoginStatus(userId: string): Promise<{
    alreadyClaimed: boolean;
    streakCount: number;
    bonusCoins: number;
    userName: string;
    calendar: DayCalendarEntry[];
    allPriorDaysClaimed: boolean;
    consecutiveDaysClaimed: number;
}> {
    try {
        const userRows = await db.select({
            streakCount: users.streakCount,
            lastStreakDate: users.lastStreakDate,
            name: users.name,
            displayName: users.displayName,
        }).from(users).where(eq(users.id, userId));

        if (userRows.length === 0) {
            return { alreadyClaimed: true, streakCount: 0, bonusCoins: 0, userName: '', calendar: [], allPriorDaysClaimed: false, consecutiveDaysClaimed: 0 };
        }

        const user = userRows[0];
        const today = getTodayRome();

        // Check if already claimed today
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

        // Effective streak (check if broken)
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

        // --- Build weekly calendar ---
        const mondayStr = getWeekMondayStr();
        const weekStart = new Date(mondayStr + 'T00:00:00+02:00');
        const sundayDate = new Date(mondayStr + 'T12:00:00');
        sundayDate.setDate(sundayDate.getDate() + 6);
        const weekEnd = new Date(sundayDate.toLocaleDateString('en-CA') + 'T23:59:59+02:00');

        const weekClaims = await db.select({
            createdAt: coinTransactions.createdAt,
        }).from(coinTransactions).where(
            and(
                eq(coinTransactions.userId, userId),
                eq(coinTransactions.reason, 'Daily login bonus'),
                gte(coinTransactions.createdAt, weekStart),
                lte(coinTransactions.createdAt, weekEnd),
            )
        );

        const claimedDates = new Set(
            weekClaims.map(c => c.createdAt.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }))
        );

        const calendar: DayCalendarEntry[] = [];
        let consecutiveClaimed = 0;
        let allPriorClaimed = true;

        for (let i = 0; i < 7; i++) {
            const d = new Date(mondayStr + 'T12:00:00');
            d.setDate(d.getDate() + i);
            const dateStr = d.toLocaleDateString('en-CA');

            let status: DayCalendarEntry['status'];
            if (dateStr === today) {
                status = alreadyClaimed ? 'claimed' : 'today';
            } else if (dateStr < today) {
                status = claimedDates.has(dateStr) ? 'claimed' : 'missed';
                if (status === 'missed') allPriorClaimed = false;
                else consecutiveClaimed++;
            } else {
                status = 'future';
            }

            calendar.push({
                label: DAY_LABELS[i],
                date: dateStr,
                reward: WEEKLY_REWARDS[i],
                status,
                isStreakBonus: i === 6,
            });
        }

        // Today's reward (escalating by day of week)
        const todayIndex = getTodayWeekIndex();
        let bonusCoins = WEEKLY_REWARDS[todayIndex];

        // Sunday: only gives 50 if all Mon-Sat claimed, otherwise base
        if (todayIndex === 6 && !allPriorClaimed) {
            bonusCoins = SUNDAY_BASE_REWARD;
        }

        return {
            alreadyClaimed,
            streakCount: effectiveStreak,
            bonusCoins,
            userName: user.displayName || user.name || 'Operatore',
            calendar,
            allPriorDaysClaimed: allPriorClaimed,
            consecutiveDaysClaimed: consecutiveClaimed,
        };
    } catch (error) {
        console.error("Errore checkDailyLoginStatus:", error);
        return { alreadyClaimed: true, streakCount: 0, bonusCoins: 0, userName: '', calendar: [], allPriorDaysClaimed: false, consecutiveDaysClaimed: 0 };
    }
}

/**
 * Claim the daily login bonus with escalating weekly rewards.
 * Day-of-week determines reward: Mon 5, Tue 8, Wed 12, Thu 15, Fri 20, Sat 30.
 * Sunday: 50 coins + title if all Mon-Sat claimed, otherwise 15 coins.
 */
export async function claimDailyLogin(userId: string): Promise<{
    success: boolean;
    coinsAwarded: number;
    streakCount: number;
    multiplier: number;
    weeklyBonusTitle: boolean;
}> {
    try {
        const todayStart = getTodayStartUTC();

        // Quick pre-check outside transaction (fast path for already-claimed)
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
            const userRow = await db.select({
                streakCount: users.streakCount,
            }).from(users).where(eq(users.id, userId));
            const streak = userRow[0]?.streakCount ?? 0;
            return { success: true, coinsAwarded: 0, streakCount: streak, multiplier: getStreakMultiplier(streak), weeklyBonusTitle: false };
        }

        // Use a transaction to prevent race-condition double-claims
        const result = await db.transaction(async (tx) => {
            // Re-check inside the transaction to guarantee atomicity
            const claimsInTx = await tx.select({ id: coinTransactions.id })
                .from(coinTransactions)
                .where(
                    and(
                        eq(coinTransactions.userId, userId),
                        eq(coinTransactions.reason, 'Daily login bonus'),
                        gte(coinTransactions.createdAt, todayStart)
                    )
                );

            if (claimsInTx.length > 0) {
                const userRow = await tx.select({
                    streakCount: users.streakCount,
                }).from(users).where(eq(users.id, userId));
                const streak = userRow[0]?.streakCount ?? 0;
                return { success: true as const, coinsAwarded: 0, streakCount: streak, multiplier: getStreakMultiplier(streak), weeklyBonusTitle: false };
            }

            // Get user data
            const userRows = await tx.select({
                streakCount: users.streakCount,
                lastStreakDate: users.lastStreakDate,
                walletCoins: users.walletCoins,
                activeTitle: users.activeTitle,
            }).from(users).where(eq(users.id, userId));

            if (userRows.length === 0) {
                return { success: false as const, coinsAwarded: 0, streakCount: 0, multiplier: 1, weeklyBonusTitle: false };
            }

            const user = userRows[0];
            const today = getTodayRome();

            // Effective streak
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

            // Calculate escalating reward based on day of week
            const todayIndex = getTodayWeekIndex();
            let bonusCoins = WEEKLY_REWARDS[todayIndex];
            let weeklyBonusTitle = false;

            // Sunday special: check if all Mon-Sat were claimed this week
            if (todayIndex === 6) {
                const mondayStr = getWeekMondayStr();
                const weekStart = new Date(mondayStr + 'T00:00:00+02:00');
                const satDate = new Date(mondayStr + 'T12:00:00');
                satDate.setDate(satDate.getDate() + 5);
                const satEnd = new Date(satDate.toLocaleDateString('en-CA') + 'T23:59:59+02:00');

                const monSatClaims = await tx.select({
                    createdAt: coinTransactions.createdAt,
                }).from(coinTransactions).where(
                    and(
                        eq(coinTransactions.userId, userId),
                        eq(coinTransactions.reason, 'Daily login bonus'),
                        gte(coinTransactions.createdAt, weekStart),
                        lte(coinTransactions.createdAt, satEnd),
                    )
                );

                const claimedDates = new Set(
                    monSatClaims.map(c => c.createdAt.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }))
                );

                let allClaimed = true;
                for (let i = 0; i < 6; i++) {
                    const d = new Date(mondayStr + 'T12:00:00');
                    d.setDate(d.getDate() + i);
                    if (!claimedDates.has(d.toLocaleDateString('en-CA'))) {
                        allClaimed = false;
                        break;
                    }
                }

                if (allClaimed) {
                    bonusCoins = WEEKLY_REWARDS[6]; // 50 coins
                    weeklyBonusTitle = true;
                } else {
                    bonusCoins = SUNDAY_BASE_REWARD; // 15 coins
                }
            }

            // Award coins — use walletCoins (the visible/spendable field)
            const newCoins = user.walletCoins + bonusCoins;
            const updateFields: Record<string, unknown> = { walletCoins: newCoins };

            // Auto-equip weekly bonus title if earned and user has no active title
            if (weeklyBonusTitle && !user.activeTitle) {
                updateFields.activeTitle = WEEKLY_BONUS_TITLE;
            }

            await tx.update(users).set(updateFields).where(eq(users.id, userId));

            // Log transaction
            const reason = weeklyBonusTitle
                ? 'Daily login bonus (settimana completa!)'
                : 'Daily login bonus';

            await tx.insert(coinTransactions).values({
                id: crypto.randomUUID(),
                userId,
                amount: bonusCoins,
                reason,
            });

            return {
                success: true as const,
                coinsAwarded: bonusCoins,
                streakCount: effectiveStreak,
                multiplier: getStreakMultiplier(effectiveStreak),
                weeklyBonusTitle,
            };
        });

        return result;
    } catch (error) {
        console.error("Errore claimDailyLogin:", error);
        return { success: false, coinsAwarded: 0, streakCount: 0, multiplier: 1, weeklyBonusTitle: false };
    }
}
