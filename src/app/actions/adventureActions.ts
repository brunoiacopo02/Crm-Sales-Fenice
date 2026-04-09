'use server';

import { db } from "@/db";
import { adventureProgress, adventureBosses, users, coinTransactions, callLogs, leadEvents, leads } from "@/db/schema";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { dropCreature } from "./creatureActions";

// Stage completion requirements (what it takes to advance 1 stage)
// Requirements grow with stage number for ~4 month longevity
function getStageRequirement(stage: number): { metric: string; value: number } {
    if (stage <= 10) return { metric: 'chiamate', value: 50 };
    if (stage <= 20) return { metric: 'fissaggi', value: 3 };
    if (stage <= 30) return { metric: 'conferme', value: 2 };
    if (stage <= 40) return { metric: 'presenze', value: 2 };
    if (stage <= 50) return { metric: 'chiusure', value: 1 };
    if (stage <= 60) return { metric: 'fissaggi', value: 5 };
    if (stage <= 70) return { metric: 'presenze', value: 3 };
    if (stage <= 80) return { metric: 'chiusure', value: 2 };
    if (stage <= 90) return { metric: 'fissaggi', value: 7 };
    return { metric: 'chiusure', value: 3 };
}

// Damage values per action type
const DAMAGE_MAP: Record<string, number> = {
    chiamata: 5,
    fissaggio: 50,
    conferma: 30,
    presenza: 40,
    chiusura: 100,
};

/**
 * Get or create adventure progress for a user.
 */
export async function getAdventureProgress(userId: string) {
    try {
        let [progress] = await db.select().from(adventureProgress)
            .where(eq(adventureProgress.userId, userId));

        if (!progress) {
            const newProgress = {
                id: crypto.randomUUID(),
                userId,
                currentStage: 1,
                currentBossHp: null,
                lastStageCompletedAt: null,
            };
            await db.insert(adventureProgress).values(newProgress);
            progress = newProgress as typeof progress;
        }

        // Check if current stage is a boss stage
        let activeBoss = null;
        if (progress.currentStage % 10 === 0) {
            const [boss] = await db.select().from(adventureBosses)
                .where(eq(adventureBosses.stageNumber, progress.currentStage));
            if (boss) {
                activeBoss = {
                    ...boss,
                    currentHp: progress.currentBossHp ?? boss.totalHp,
                };
            }
        }

        return {
            ...progress,
            activeBoss,
            stageRequirement: getStageRequirement(progress.currentStage),
        };
    } catch (error) {
        console.error("Errore getAdventureProgress:", error);
        return null;
    }
}

/**
 * Advance to the next stage (called when stage requirements are met).
 * If the next stage is a boss stage (multiple of 10), set boss HP.
 */
export async function advanceStage(userId: string) {
    try {
        const [progress] = await db.select().from(adventureProgress)
            .where(eq(adventureProgress.userId, userId));
        if (!progress) return { success: false, error: 'No adventure progress found' };

        if (progress.currentStage >= 100) {
            return { success: false, error: 'Avventura completata! Sei al livello massimo.' };
        }

        const nextStage = progress.currentStage + 1;
        let bossHp: number | null = null;

        // Check if next stage is a boss stage
        if (nextStage % 10 === 0) {
            const [boss] = await db.select().from(adventureBosses)
                .where(eq(adventureBosses.stageNumber, nextStage));
            if (boss) {
                bossHp = boss.totalHp;
            }
        }

        await db.update(adventureProgress)
            .set({
                currentStage: nextStage,
                currentBossHp: bossHp,
                lastStageCompletedAt: new Date(),
            })
            .where(eq(adventureProgress.userId, userId));

        return { success: true, newStage: nextStage, isBossStage: bossHp !== null };
    } catch (error) {
        console.error("Errore advanceStage:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Attack the current boss. Reduces HP based on action type.
 * If boss HP reaches 0: rewards creature + coins + title, advances stage.
 */
export async function attackBoss(userId: string, actionType: string) {
    try {
        const damage = DAMAGE_MAP[actionType] || 0;
        if (damage === 0) return null;

        const [progress] = await db.select().from(adventureProgress)
            .where(eq(adventureProgress.userId, userId));
        if (!progress) return null;

        // Not on a boss stage
        if (progress.currentStage % 10 !== 0) return null;
        if (progress.currentBossHp === null) return null;

        const [boss] = await db.select().from(adventureBosses)
            .where(eq(adventureBosses.stageNumber, progress.currentStage));
        if (!boss) return null;

        const newHp = Math.max(0, progress.currentBossHp - damage);

        if (newHp <= 0) {
            // Boss defeated!
            // Drop reward creature
            let creatureReward = null;
            if (boss.rewardCreatureId) {
                creatureReward = await dropCreature(userId, undefined);
            }

            // Award coins
            if (boss.rewardCoins > 0) {
                const [user] = await db.select({ walletCoins: users.walletCoins }).from(users)
                    .where(eq(users.id, userId));
                if (user) {
                    await db.update(users)
                        .set({ walletCoins: user.walletCoins + boss.rewardCoins })
                        .where(eq(users.id, userId));

                    await db.insert(coinTransactions).values({
                        id: crypto.randomUUID(),
                        userId,
                        amount: boss.rewardCoins,
                        reason: `Boss sconfitto: ${boss.name}`,
                    });
                }
            }

            // Award title
            if (boss.rewardTitle) {
                await db.update(users)
                    .set({ activeTitle: boss.rewardTitle })
                    .where(eq(users.id, userId));
            }

            // Advance to next stage
            const nextStage = progress.currentStage + 1;
            await db.update(adventureProgress)
                .set({
                    currentStage: nextStage > 100 ? 100 : nextStage,
                    currentBossHp: null,
                    lastStageCompletedAt: new Date(),
                })
                .where(eq(adventureProgress.userId, userId));

            return {
                bossDefeated: true,
                bossName: boss.name,
                rewardCoins: boss.rewardCoins,
                rewardTitle: boss.rewardTitle,
                creature: creatureReward?.creature || null,
                newStage: nextStage > 100 ? 100 : nextStage,
            };
        } else {
            // Boss still alive
            await db.update(adventureProgress)
                .set({ currentBossHp: newHp })
                .where(eq(adventureProgress.userId, userId));

            return {
                bossDefeated: false,
                damageDealt: damage,
                remainingHp: newHp,
                totalHp: boss.totalHp,
            };
        }
    } catch (error) {
        console.error("Errore attackBoss:", error);
        return null;
    }
}

/**
 * Get all adventure bosses (for map display).
 */
export async function getAllBosses() {
    try {
        return await db.select().from(adventureBosses).orderBy(adventureBosses.stageNumber);
    } catch (error) {
        console.error("Errore getAllBosses:", error);
        return [];
    }
}

/**
 * Count today's actions for a given user and metric.
 * Used by checkAndAdvanceStage to verify stage requirements.
 */
export async function countTodayActions(userId: string, metric: string): Promise<number> {
    // Start of today in Europe/Rome timezone
    const now = new Date();
    const romeDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }); // YYYY-MM-DD
    const todayStart = new Date(`${romeDateStr}T00:00:00+02:00`);

    switch (metric) {
        case 'chiamate': {
            const [result] = await db.select({ c: count() }).from(callLogs)
                .where(and(
                    eq(callLogs.userId, userId),
                    gte(callLogs.createdAt, todayStart)
                ));
            return result?.c ?? 0;
        }
        case 'fissaggi': {
            const [result] = await db.select({ c: count() }).from(leadEvents)
                .where(and(
                    eq(leadEvents.userId, userId),
                    eq(leadEvents.eventType, 'APPOINTMENT_SET'),
                    gte(leadEvents.timestamp, todayStart)
                ));
            return result?.c ?? 0;
        }
        case 'conferme': {
            const [result] = await db.select({ c: count() }).from(leads)
                .where(and(
                    eq(leads.assignedToId, userId),
                    eq(leads.confirmationsOutcome, 'confermato'),
                    gte(leads.confirmationsTimestamp, todayStart)
                ));
            return result?.c ?? 0;
        }
        case 'presenze': {
            const [result] = await db.select({ c: count() }).from(leads)
                .where(and(
                    eq(leads.assignedToId, userId),
                    eq(leads.salespersonOutcome, 'Non chiuso'),
                    gte(leads.salespersonOutcomeAt, todayStart)
                ));
            return result?.c ?? 0;
        }
        case 'chiusure': {
            const [result] = await db.select({ c: count() }).from(leads)
                .where(and(
                    eq(leads.assignedToId, userId),
                    eq(leads.salespersonOutcome, 'Chiuso'),
                    gte(leads.salespersonOutcomeAt, todayStart)
                ));
            return result?.c ?? 0;
        }
        default:
            return 0;
    }
}

/**
 * Check if the user has met the current stage requirements and advance if so.
 * Does NOT advance if the current stage is a boss stage (multiple of 10).
 */
export async function checkAndAdvanceStage(userId: string) {
    try {
        const [progress] = await db.select().from(adventureProgress)
            .where(eq(adventureProgress.userId, userId));
        if (!progress) return null;

        // Don't advance on boss stages — boss must be defeated
        if (progress.currentStage % 10 === 0) return null;

        // Already completed
        if (progress.currentStage >= 100) return null;

        const requirement = getStageRequirement(progress.currentStage);
        const todayCount = await countTodayActions(userId, requirement.metric);

        if (todayCount >= requirement.value) {
            return await advanceStage(userId);
        }

        return null;
    } catch (error) {
        console.error("Errore checkAndAdvanceStage:", error);
        return null;
    }
}
