'use server';

import { db } from "@/db";
import { quests, questProgress, callLogs, leads, users, coinTransactions, leadEvents } from "@/db/schema";
import { eq, and, gte, lte, isNotNull, sql, count, countDistinct, inArray } from "drizzle-orm";
import { updateStreak } from "@/app/actions/streakActions";
import { getStreakMultiplier } from "@/lib/streakUtils";
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils";

// --- Helpers ---

function getTodayRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

function getWeekScopeRome(): string {
    const now = new Date();
    const rome = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    // ISO week: Monday-based
    const day = rome.getDay();
    const diff = rome.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(rome.setDate(diff));
    const year = monday.getFullYear();
    // Get ISO week number
    const janFirst = new Date(year, 0, 1);
    const dayOfYear = Math.ceil((monday.getTime() - janFirst.getTime()) / 86400000) + 1;
    const weekNum = Math.ceil(dayOfYear / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function getDayBoundsRome(dateStr: string): { start: Date; end: Date } {
    // dateStr is 'YYYY-MM-DD'
    const start = new Date(`${dateStr}T00:00:00+02:00`); // CET/CEST approximation
    const end = new Date(`${dateStr}T23:59:59.999+02:00`);
    return { start, end };
}

function getWeekBoundsRome(): { start: Date; end: Date } {
    const now = new Date();
    const rome = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    const day = rome.getDay();
    const diff = rome.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(rome);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
}

// Number of daily quests to assign each day (variable selection from pool)
const DAILY_QUEST_COUNT = 3;
const WEEKLY_QUEST_COUNT = 2;

/**
 * Generate daily quests for a user based on their role.
 * Picks a random selection from active quest templates filtered by role.
 * Idempotent: won't re-generate if quests already exist for today.
 */
export async function generateDailyQuests(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const todayScope = getTodayRome();
        const weekScope = getWeekScopeRome();

        // Check if daily quests already generated for today
        const existingDaily = await db.select({ id: questProgress.id })
            .from(questProgress)
            .innerJoin(quests, eq(questProgress.questId, quests.id))
            .where(and(
                eq(questProgress.userId, userId),
                eq(questProgress.dateScope, todayScope),
                eq(quests.type, 'daily')
            ))
            .limit(1);

        if (existingDaily.length > 0) {
            return { success: true }; // Already generated
        }

        // Determine user role to filter quests
        const userRows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
        const userRole = userRows[0]?.role || 'GDO';
        const questRole = userRole === 'CONFERME' ? 'CONFERME' : userRole === 'VENDITORE' ? 'VENDITORE' : 'GDO';

        // Fetch all active quest templates for this role
        const dailyTemplates = await db.select().from(quests)
            .where(and(eq(quests.type, 'daily'), eq(quests.isActive, true), eq(quests.role, questRole)));

        const weeklyTemplates = await db.select().from(quests)
            .where(and(eq(quests.type, 'weekly'), eq(quests.isActive, true), eq(quests.role, questRole)));

        // Shuffle and pick random daily quests (variable reward pattern)
        const shuffledDaily = dailyTemplates.sort(() => Math.random() - 0.5);
        const selectedDaily = shuffledDaily.slice(0, Math.min(DAILY_QUEST_COUNT, shuffledDaily.length));

        // Create progress entries for daily quests
        const dailyEntries = selectedDaily.map(quest => ({
            id: crypto.randomUUID(),
            questId: quest.id,
            userId,
            currentValue: 0,
            completed: false,
            completedAt: null as Date | null,
            dateScope: todayScope,
        }));

        if (dailyEntries.length > 0) {
            await db.insert(questProgress).values(dailyEntries);
        }

        // Check if weekly quests already generated for this week
        const existingWeekly = await db.select({ id: questProgress.id })
            .from(questProgress)
            .innerJoin(quests, eq(questProgress.questId, quests.id))
            .where(and(
                eq(questProgress.userId, userId),
                eq(questProgress.dateScope, weekScope),
                eq(quests.type, 'weekly')
            ))
            .limit(1);

        if (existingWeekly.length === 0 && weeklyTemplates.length > 0) {
            const shuffledWeekly = weeklyTemplates.sort(() => Math.random() - 0.5);
            const selectedWeekly = shuffledWeekly.slice(0, Math.min(WEEKLY_QUEST_COUNT, shuffledWeekly.length));

            const weeklyEntries = selectedWeekly.map(quest => ({
                id: crypto.randomUUID(),
                questId: quest.id,
                userId,
                currentValue: 0,
                completed: false,
                completedAt: null as Date | null,
                dateScope: weekScope,
            }));

            await db.insert(questProgress).values(weeklyEntries);
        }

        return { success: true };
    } catch (error) {
        console.error("Errore generateDailyQuests:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Measure a metric for a user in a given time range.
 */
async function measureMetric(userId: string, metric: string, start: Date, end: Date): Promise<number> {
    switch (metric) {
        case 'calls_made': {
            const result = await db.select({ value: count() })
                .from(callLogs)
                .where(and(
                    eq(callLogs.userId, userId),
                    gte(callLogs.createdAt, start),
                    lte(callLogs.createdAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'appointments_set': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.assignedToId, userId),
                    isNotNull(leads.appointmentCreatedAt),
                    gte(leads.appointmentCreatedAt, start),
                    lte(leads.appointmentCreatedAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'leads_contacted': {
            const result = await db.select({ value: countDistinct(callLogs.leadId) })
                .from(callLogs)
                .where(and(
                    eq(callLogs.userId, userId),
                    gte(callLogs.createdAt, start),
                    lte(callLogs.createdAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        // --- CONFERME metrics ---
        case 'conferme_fatte': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.confirmationsUserId, userId),
                    eq(leads.confirmationsOutcome, 'confermato'),
                    isNotNull(leads.confirmationsTimestamp),
                    gte(leads.confirmationsTimestamp, start),
                    lte(leads.confirmationsTimestamp, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'conferme_chiamate': {
            const confermeEventTypes = [
                'conferme_no_answer',
                'conferme_recall_scheduled',
                'conferme_outcome_set',
                'conferme_snooze_set',
            ];
            const result = await db.select({ value: count() })
                .from(leadEvents)
                .where(and(
                    eq(leadEvents.userId, userId),
                    inArray(leadEvents.eventType, confermeEventTypes),
                    gte(leadEvents.timestamp, start),
                    lte(leadEvents.timestamp, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'conferme_scartate': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.confirmationsUserId, userId),
                    eq(leads.confirmationsOutcome, 'scartato'),
                    isNotNull(leads.confirmationsTimestamp),
                    gte(leads.confirmationsTimestamp, start),
                    lte(leads.confirmationsTimestamp, end)
                ));
            return result[0]?.value ?? 0;
        }
        // --- VENDITORE metrics ---
        case 'deals_chiusi': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    eq(leads.salespersonOutcome, 'Chiuso'),
                    isNotNull(leads.salespersonOutcomeAt),
                    gte(leads.salespersonOutcomeAt, start),
                    lte(leads.salespersonOutcomeAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'fatturato_eur': {
            const result = await db.select({ value: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)` })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    eq(leads.salespersonOutcome, 'Chiuso'),
                    isNotNull(leads.salespersonOutcomeAt),
                    gte(leads.salespersonOutcomeAt, start),
                    lte(leads.salespersonOutcomeAt, end)
                ));
            return Number(result[0]?.value) || 0;
        }
        case 'esiti_registrati': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    isNotNull(leads.salespersonOutcome),
                    isNotNull(leads.salespersonOutcomeAt),
                    gte(leads.salespersonOutcomeAt, start),
                    lte(leads.salespersonOutcomeAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        case 'trattative_presentate': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    isNotNull(leads.salespersonAssignedAt),
                    gte(leads.salespersonAssignedAt, start),
                    lte(leads.salespersonAssignedAt, end)
                ));
            return result[0]?.value ?? 0;
        }
        default:
            return 0;
    }
}

/**
 * Check and update quest progress for a user.
 * Returns list of newly completed quests (for UI notifications).
 */
export async function checkQuestProgress(userId: string): Promise<{
    success: boolean;
    newlyCompleted: Array<{ questTitle: string; rewardXp: number; rewardCoins: number }>;
    error?: string;
}> {
    try {
        const todayScope = getTodayRome();
        const weekScope = getWeekScopeRome();
        const todayBounds = getDayBoundsRome(todayScope);
        const weekBounds = getWeekBoundsRome();

        // Fetch all active (non-completed) quest progress for this user
        const activeProgress = await db.select({
            progressId: questProgress.id,
            questId: questProgress.questId,
            currentValue: questProgress.currentValue,
            completed: questProgress.completed,
            dateScope: questProgress.dateScope,
            questTitle: quests.title,
            questType: quests.type,
            targetMetric: quests.targetMetric,
            targetValue: quests.targetValue,
            rewardXp: quests.rewardXp,
            rewardCoins: quests.rewardCoins,
        })
            .from(questProgress)
            .innerJoin(quests, eq(questProgress.questId, quests.id))
            .where(and(
                eq(questProgress.userId, userId),
                eq(questProgress.completed, false),
                sql`(${questProgress.dateScope} = ${todayScope} OR ${questProgress.dateScope} = ${weekScope})`
            ));

        const newlyCompleted: Array<{ questTitle: string; rewardXp: number; rewardCoins: number }> = [];

        for (const qp of activeProgress) {
            // Determine time bounds based on quest type
            const bounds = qp.questType === 'daily' ? todayBounds : weekBounds;

            // Measure current metric value
            const currentValue = await measureMetric(userId, qp.targetMetric, bounds.start, bounds.end);

            const isNowComplete = currentValue >= qp.targetValue;

            // Update progress
            await db.update(questProgress)
                .set({
                    currentValue,
                    completed: isNowComplete,
                    completedAt: isNowComplete ? new Date() : null,
                })
                .where(eq(questProgress.id, qp.progressId));

            if (isNowComplete && !qp.completed) {
                newlyCompleted.push({
                    questTitle: qp.questTitle,
                    rewardXp: qp.rewardXp,
                    rewardCoins: qp.rewardCoins,
                });
            }
        }

        return { success: true, newlyCompleted };
    } catch (error) {
        console.error("Errore checkQuestProgress:", error);
        return { success: false, newlyCompleted: [], error: String(error) };
    }
}

/**
 * Complete a quest and award XP + coins to the user.
 * Called after checkQuestProgress detects a newly completed quest.
 */
export async function completeQuest(userId: string, questProgressId: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Fetch the quest progress with quest details
        const rows = await db.select({
            progressId: questProgress.id,
            completed: questProgress.completed,
            rewardXp: quests.rewardXp,
            rewardCoins: quests.rewardCoins,
            questTitle: quests.title,
        })
            .from(questProgress)
            .innerJoin(quests, eq(questProgress.questId, quests.id))
            .where(and(
                eq(questProgress.id, questProgressId),
                eq(questProgress.userId, userId)
            ));

        if (rows.length === 0) {
            return { success: false, error: "Quest progress non trovato" };
        }

        const qp = rows[0];

        if (!qp.completed) {
            return { success: false, error: "Quest non ancora completata" };
        }

        // Update streak (idempotent for same day) and get multiplier
        const streakResult = await updateStreak(userId);
        const streakMult = getStreakMultiplier(streakResult.streakCount);

        // Get seasonal event multipliers (stacks with streak)
        const eventMult = await getActiveEventMultipliers();
        const totalXpMult = streakMult * eventMult.xp;
        const totalCoinsMult = streakMult * eventMult.coins;

        // Apply combined multipliers to rewards
        const effectiveXp = Math.floor(qp.rewardXp * totalXpMult);
        const effectiveCoins = Math.floor(qp.rewardCoins * totalCoinsMult);

        // Award XP and coins
        const userRows = await db.select().from(users).where(eq(users.id, userId));
        if (userRows.length === 0) return { success: false, error: "Utente non trovato" };

        const user = userRows[0];
        const newCoins = user.coins + effectiveCoins;
        let newXp = user.experience + effectiveXp;
        let newLevel = user.level;

        // Level-up logic (same as gamificationEngine)
        const calculateTargetXp = (level: number) => Math.floor(100 * Math.pow(level, 1.5));
        let targetXp = calculateTargetXp(newLevel);
        while (newXp >= targetXp) {
            newXp -= targetXp;
            newLevel++;
            targetXp = calculateTargetXp(newLevel);
        }

        await db.update(users).set({
            experience: newXp,
            level: newLevel,
            coins: newCoins,
        }).where(eq(users.id, userId));

        // Log coin transaction (show multipliers in reason if > 1)
        const multParts: string[] = [];
        if (streakMult > 1) multParts.push(`x${streakMult} streak`);
        if (eventMult.coins > 1) multParts.push(`x${eventMult.coins} evento`);
        const coinReason = multParts.length > 0
            ? `Quest completata: ${qp.questTitle} (${multParts.join(', ')})`
            : `Quest completata: ${qp.questTitle}`;
        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount: effectiveCoins,
            reason: coinReason,
        });

        return { success: true };
    } catch (error) {
        console.error("Errore completeQuest:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get all quest progress for a user (active day + week).
 * Used by the UI to display quest panel.
 */
export async function getUserQuests(userId: string): Promise<{
    daily: Array<{
        progressId: string;
        questId: string;
        title: string;
        description: string;
        targetValue: number;
        currentValue: number;
        rewardXp: number;
        rewardCoins: number;
        completed: boolean;
    }>;
    weekly: Array<{
        progressId: string;
        questId: string;
        title: string;
        description: string;
        targetValue: number;
        currentValue: number;
        rewardXp: number;
        rewardCoins: number;
        completed: boolean;
    }>;
}> {
    const todayScope = getTodayRome();
    const weekScope = getWeekScopeRome();

    const rows = await db.select({
        progressId: questProgress.id,
        questId: questProgress.questId,
        title: quests.title,
        description: quests.description,
        targetValue: quests.targetValue,
        currentValue: questProgress.currentValue,
        rewardXp: quests.rewardXp,
        rewardCoins: quests.rewardCoins,
        completed: questProgress.completed,
        questType: quests.type,
        dateScope: questProgress.dateScope,
    })
        .from(questProgress)
        .innerJoin(quests, eq(questProgress.questId, quests.id))
        .where(and(
            eq(questProgress.userId, userId),
            sql`(${questProgress.dateScope} = ${todayScope} OR ${questProgress.dateScope} = ${weekScope})`
        ));

    const daily = rows
        .filter(r => r.questType === 'daily')
        .map(({ questType, dateScope, ...rest }) => rest);

    const weekly = rows
        .filter(r => r.questType === 'weekly')
        .map(({ questType, dateScope, ...rest }) => rest);

    return { daily, weekly };
}
