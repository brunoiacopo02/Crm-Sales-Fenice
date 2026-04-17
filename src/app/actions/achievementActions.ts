'use server';

import { db } from "@/db";
import { achievements, userAchievements, users, callLogs, leads, questProgress, coinTransactions, notifications, leadEvents, userCreatures, tradingOffers, duels, gdoLeadSurveys, confermeLeadSurveys } from "@/db/schema";
import { eq, and, gte, isNotNull, isNull, sql, count, countDistinct, inArray, or } from "drizzle-orm";
import { GAME_CONSTANTS } from "@/lib/gamificationEngine";
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils";

/**
 * Measure a lifetime metric for a user.
 * Returns the current value for a given achievement metric.
 */
export async function measureAchievementMetric(userId: string, metric: string): Promise<number> {
    switch (metric) {
        case 'total_calls': {
            const result = await db.select({ value: count() })
                .from(callLogs)
                .where(eq(callLogs.userId, userId));
            return result[0]?.value ?? 0;
        }
        case 'total_appointments': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.assignedToId, userId),
                    isNotNull(leads.appointmentCreatedAt)
                ));
            return result[0]?.value ?? 0;
        }
        case 'current_streak': {
            const userRows = await db.select({ streakCount: users.streakCount })
                .from(users)
                .where(eq(users.id, userId));
            return userRows[0]?.streakCount ?? 0;
        }
        case 'total_quests_completed': {
            const result = await db.select({ value: count() })
                .from(questProgress)
                .where(and(
                    eq(questProgress.userId, userId),
                    eq(questProgress.completed, true)
                ));
            return result[0]?.value ?? 0;
        }
        case 'current_level': {
            const userRows = await db.select({ level: users.level })
                .from(users)
                .where(eq(users.id, userId));
            return userRows[0]?.level ?? 1;
        }
        case 'total_leads_contacted': {
            const result = await db.select({ value: countDistinct(callLogs.leadId) })
                .from(callLogs)
                .where(eq(callLogs.userId, userId));
            return result[0]?.value ?? 0;
        }
        case 'total_coins_earned': {
            const result = await db.select({
                value: sql<number>`COALESCE(SUM(CASE WHEN ${coinTransactions.amount} > 0 THEN ${coinTransactions.amount} ELSE 0 END), 0)`
            })
                .from(coinTransactions)
                .where(eq(coinTransactions.userId, userId));
            return Number(result[0]?.value) ?? 0;
        }
        // --- CONFERME achievement metrics (lifetime) ---
        case 'total_conferme': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.confirmationsUserId, userId),
                    eq(leads.confirmationsOutcome, 'confermato'),
                    isNotNull(leads.confirmationsTimestamp)
                ));
            return result[0]?.value ?? 0;
        }
        case 'total_conferme_chiamate': {
            const confermeEventTypes = [
                'conferme_no_answer',
                'conferme_recall_scheduled',
                'conferme_outcome_set',
                'conferme_snooze_set',
                'conferme_vsl_toggled',
            ];
            const result = await db.select({ value: count() })
                .from(leadEvents)
                .where(and(
                    eq(leadEvents.userId, userId),
                    inArray(leadEvents.eventType, confermeEventTypes)
                ));
            return result[0]?.value ?? 0;
        }
        case 'total_conferme_richiami_ok': {
            // Leads that had a snooze/recall AND were eventually confirmed
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.confirmationsUserId, userId),
                    eq(leads.confirmationsOutcome, 'confermato'),
                    isNotNull(leads.confSnoozeAt)
                ));
            return result[0]?.value ?? 0;
        }
        case 'tasso_conferma_percent': {
            // (conferme / (conferme + scartate)) * 100 — single query
            const result = await db.select({
                confermati: sql<number>`COUNT(CASE WHEN ${leads.confirmationsOutcome} = 'confermato' THEN 1 END)`,
                totale: sql<number>`COUNT(*)`,
            })
                .from(leads)
                .where(and(
                    eq(leads.confirmationsUserId, userId),
                    sql`${leads.confirmationsOutcome} IN ('confermato', 'scartato')`
                ));
            const tot = Number(result[0]?.totale) || 0;
            if (tot === 0) return 0;
            return Math.round((Number(result[0]?.confermati) / tot) * 100);
        }
        // --- VENDITORE achievement metrics (lifetime) ---
        case 'total_deals_chiusi': {
            const result = await db.select({ value: count() })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    eq(leads.salespersonOutcome, 'Chiuso')
                ));
            return result[0]?.value ?? 0;
        }
        case 'total_fatturato_eur': {
            const result = await db.select({
                value: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)`
            })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    eq(leads.salespersonOutcome, 'Chiuso')
                ));
            return Number(result[0]?.value) ?? 0;
        }
        case 'tasso_chiusura_percent': {
            // (chiusi / totale esiti) * 100 — single query
            const result = await db.select({
                chiusi: sql<number>`COUNT(CASE WHEN ${leads.salespersonOutcome} = 'Chiuso' THEN 1 END)`,
                totale: sql<number>`COUNT(*)`,
            })
                .from(leads)
                .where(and(
                    eq(leads.salespersonUserId, userId),
                    isNotNull(leads.salespersonOutcome)
                ));
            const totalEsiti = Number(result[0]?.totale) || 0;
            if (totalEsiti === 0) return 0;
            return Math.round((Number(result[0]?.chiusi) / totalEsiti) * 100);
        }
        // Script metrics
        case 'total_scripts_completed': {
            const result = await db.select({ value: count() })
                .from(callLogs)
                .where(and(
                    eq(callLogs.userId, userId),
                    eq(callLogs.scriptCompleted, true)
                ));
            return result[0]?.value ?? 0;
        }
        // Universe metrics
        case 'total_bosses_defeated': {
            // Count stages that are multiples of 10 that have been completed (currentStage > bossStage)
            const { adventureProgress } = await import("@/db/schema");
            const [progress] = await db.select({ currentStage: adventureProgress.currentStage })
                .from(adventureProgress).where(eq(adventureProgress.userId, userId));
            if (!progress) return 0;
            // Bosses are at stages 10, 20, 30... A boss at stage N is defeated if currentStage > N
            return Math.floor((progress.currentStage - 1) / 10);
        }
        case 'total_creatures_owned': {
            const [result] = await db.select({ c: count() }).from(userCreatures)
                .where(eq(userCreatures.userId, userId));
            return result?.c ?? 0;
        }
        case 'total_trades_completed': {
            const [result] = await db.select({ c: count() }).from(tradingOffers)
                .where(and(
                    or(eq(tradingOffers.fromUserId, userId), eq(tradingOffers.toUserId, userId)),
                    eq(tradingOffers.status, 'accepted')
                ));
            return result?.c ?? 0;
        }
        case 'total_duels_won': {
            const [result] = await db.select({ c: count() }).from(duels)
                .where(and(eq(duels.winnerId, userId), eq(duels.status, 'completed')));
            return result?.c ?? 0;
        }
        // --- LEAD SURVEY metrics (sondaggi lead) ---
        case 'gdo_surveys_completed': {
            const [result] = await db.select({ c: count() }).from(gdoLeadSurveys)
                .where(and(
                    eq(gdoLeadSurveys.gdoUserId, userId),
                    eq(gdoLeadSurveys.completed, true),
                    isNull(gdoLeadSurveys.invalidatedBy),
                ));
            return result?.c ?? 0;
        }
        case 'conferme_surveys_completed': {
            const [result] = await db.select({ c: count() }).from(confermeLeadSurveys)
                .where(and(
                    eq(confermeLeadSurveys.confermeUserId, userId),
                    isNull(confermeLeadSurveys.invalidatedBy),
                ));
            return result?.c ?? 0;
        }
        default:
            return 0;
    }
}

/**
 * Check all achievements for a user, unlock new tiers if targets are met.
 * Returns newly unlocked achievements for notification display.
 */
export async function checkAchievements(userId: string): Promise<{
    success: boolean;
    newlyUnlocked: Array<{
        achievementName: string;
        achievementIcon: string;
        tier: number;
        tierLabel: string;
    }>;
    error?: string;
}> {
    try {
        // Fetch all achievement definitions
        const allAchievements = await db.select().from(achievements);

        // Fetch user's already-unlocked achievements
        const unlockedRows = await db.select({
            achievementId: userAchievements.achievementId,
            tier: userAchievements.tier,
        })
            .from(userAchievements)
            .where(eq(userAchievements.userId, userId));

        // Build map of achievementId -> highest unlocked tier
        const unlockedMap = new Map<string, number>();
        for (const row of unlockedRows) {
            const current = unlockedMap.get(row.achievementId) || 0;
            if (row.tier > current) {
                unlockedMap.set(row.achievementId, row.tier);
            }
        }

        // Group achievements by metric to minimize DB queries
        const metricGroups = new Map<string, typeof allAchievements>();
        for (const ach of allAchievements) {
            const group = metricGroups.get(ach.metric) || [];
            group.push(ach);
            metricGroups.set(ach.metric, group);
        }

        const newlyUnlocked: Array<{
            achievementName: string;
            achievementIcon: string;
            tier: number;
            tierLabel: string;
        }> = [];

        const tierLabels = ['', 'Bronzo', 'Argento', 'Oro'];

        // Pre-fetch event multipliers once (was inside inner loop before)
        const eventMult = await getActiveEventMultipliers();

        // For each distinct metric, measure once and check all related achievements
        for (const [metric, achs] of metricGroups) {
            const currentValue = await measureAchievementMetric(userId, metric);

            for (const ach of achs) {
                const currentTier = unlockedMap.get(ach.id) || 0;
                const targets = [ach.tier1Target, ach.tier2Target, ach.tier3Target];

                // Check each tier above current
                for (let tierIdx = currentTier; tierIdx < 3; tierIdx++) {
                    const targetValue = targets[tierIdx];
                    const tierNumber = tierIdx + 1;

                    if (currentValue >= targetValue) {
                        // Unlock this tier — onConflictDoNothing handles concurrent fire-and-forget calls
                        // (checkAchievements is invoked in parallel from multiple server actions).
                        const inserted = await db.insert(userAchievements).values({
                            id: crypto.randomUUID(),
                            userId,
                            achievementId: ach.id,
                            tier: tierNumber,
                        }).onConflictDoNothing({
                            target: [userAchievements.userId, userAchievements.achievementId, userAchievements.tier]
                        }).returning({ id: userAchievements.id });

                        // If insert was a no-op (race: another concurrent call already unlocked), skip rewards.
                        if (inserted.length === 0) {
                            unlockedMap.set(ach.id, tierNumber);
                            continue;
                        }

                        // Award coins based on tier (F2-026 economy rebalance) + seasonal event multiplier
                        const tierCoinKey = tierLabels[tierNumber].toUpperCase();
                        const tierCoinMap: Record<string, string> = { 'BRONZO': 'BRONZE', 'ARGENTO': 'SILVER', 'ORO': 'GOLD' };
                        const baseCoinReward = GAME_CONSTANTS.ACHIEVEMENT_COINS[tierCoinMap[tierCoinKey] || 'BRONZE'] || 0;
                        const coinReward = Math.floor(baseCoinReward * eventMult.coins);
                        if (coinReward > 0) {
                            // Use SQL increment to avoid fetching user coins each time
                            await db.update(users).set({ walletCoins: sql`${users.walletCoins} + ${coinReward}` }).where(eq(users.id, userId));
                            const achReason = eventMult.coins > 1
                                ? `Achievement ${tierLabels[tierNumber]}: ${ach.name} (x${eventMult.coins} evento)`
                                : `Achievement ${tierLabels[tierNumber]}: ${ach.name}`;
                            await db.insert(coinTransactions).values({
                                id: crypto.randomUUID(),
                                userId,
                                amount: coinReward,
                                reason: achReason,
                            });
                        }

                        // Create notification
                        await db.insert(notifications).values({
                            id: crypto.randomUUID(),
                            recipientUserId: userId,
                            type: 'achievement_unlocked',
                            title: `Badge sbloccato: ${ach.name}`,
                            body: `Hai sbloccato il badge ${tierLabels[tierNumber]} "${ach.name}"! +${coinReward} coins. ${ach.description}`,
                            metadata: {
                                achievementId: ach.id,
                                achievementName: ach.name,
                                achievementIcon: ach.icon,
                                tier: tierNumber,
                                tierLabel: tierLabels[tierNumber],
                                coinsAwarded: coinReward,
                            },
                        });

                        newlyUnlocked.push({
                            achievementName: ach.name,
                            achievementIcon: ach.icon,
                            tier: tierNumber,
                            tierLabel: tierLabels[tierNumber],
                        });

                        // Update the map so we don't double-unlock
                        unlockedMap.set(ach.id, tierNumber);
                    } else {
                        // Can't unlock higher tiers if this one isn't met
                        break;
                    }
                }
            }
        }

        return { success: true, newlyUnlocked };
    } catch (error) {
        console.error("Errore checkAchievements:", error);
        return { success: false, newlyUnlocked: [], error: String(error) };
    }
}

/**
 * Get all achievements with user's progress for display in the profile.
 */
export async function getUserAchievements(userId: string): Promise<{
    achievements: Array<{
        id: string;
        name: string;
        description: string;
        icon: string;
        category: string;
        metric: string;
        tier1Target: number;
        tier2Target: number;
        tier3Target: number;
        currentTier: number; // 0 = locked, 1 = bronze, 2 = silver, 3 = gold
        currentValue: number;
    }>;
}> {
    try {
        // Fetch all achievement definitions
        const allAchievements = await db.select().from(achievements);

        // Fetch user's unlocked achievements
        const unlockedRows = await db.select({
            achievementId: userAchievements.achievementId,
            tier: userAchievements.tier,
        })
            .from(userAchievements)
            .where(eq(userAchievements.userId, userId));

        // Build map: achievementId -> highest tier
        const unlockedMap = new Map<string, number>();
        for (const row of unlockedRows) {
            const current = unlockedMap.get(row.achievementId) || 0;
            if (row.tier > current) {
                unlockedMap.set(row.achievementId, row.tier);
            }
        }

        // Measure each distinct metric once
        const metricValues = new Map<string, number>();
        const uniqueMetrics = [...new Set(allAchievements.map(a => a.metric))];
        for (const metric of uniqueMetrics) {
            metricValues.set(metric, await measureAchievementMetric(userId, metric));
        }

        // Build result
        const result = allAchievements.map(ach => ({
            id: ach.id,
            name: ach.name,
            description: ach.description,
            icon: ach.icon,
            category: ach.category,
            metric: ach.metric,
            tier1Target: ach.tier1Target,
            tier2Target: ach.tier2Target,
            tier3Target: ach.tier3Target,
            currentTier: unlockedMap.get(ach.id) || 0,
            currentValue: metricValues.get(ach.metric) || 0,
        }));

        return { achievements: result };
    } catch (error) {
        console.error("Errore getUserAchievements:", error);
        return { achievements: [] };
    }
}
