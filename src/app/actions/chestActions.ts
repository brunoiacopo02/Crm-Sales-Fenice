'use server';

import { db } from "@/db";
import { actionChests, coinTransactions, users } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { dropCreature } from "./creatureActions";

// GDO chest definitions (individual)
const GDO_CHEST_TYPES = [
    { chestType: 'bronze', requiredMetric: 'chiamate', requiredValue: 20 },
    { chestType: 'silver', requiredMetric: 'fissaggi', requiredValue: 5 },
    { chestType: 'gold', requiredMetric: 'presenze', requiredValue: 3 },
    { chestType: 'platinum', requiredMetric: 'chiusure', requiredValue: 1 },
] as const;

// Team Conferme chest definitions
const TEAM_CHEST_TYPES = [
    { chestType: 'bronze', requiredMetric: 'conferme', requiredValue: 24 },
    { chestType: 'silver', requiredMetric: 'presenze', requiredValue: 15 },
    { chestType: 'gold', requiredMetric: 'chiusure', requiredValue: 8 },
    { chestType: 'platinum', requiredMetric: 'chiusure', requiredValue: 20 },
] as const;

// Coin rewards by chest type
const CHEST_REWARDS: Record<string, { minCoins: number; maxCoins: number }> = {
    bronze: { minCoins: 15, maxCoins: 30 },
    silver: { minCoins: 40, maxCoins: 80 },
    gold: { minCoins: 100, maxCoins: 200 },
    platinum: { minCoins: 250, maxCoins: 500 },
    boss: { minCoins: 500, maxCoins: 1000 },
};

/**
 * Get or create active chests for a user.
 * Creates one chest per type if none is active (not yet opened).
 * For team (Conferme), use a shared userId like 'team-conferme'.
 */
export async function getOrCreateActiveChests(userId: string, isTeam?: boolean) {
    try {
        // Get existing unopened chests
        const existing = await db.select().from(actionChests)
            .where(and(eq(actionChests.userId, userId), isNull(actionChests.openedAt)));

        const chestDefs = isTeam ? TEAM_CHEST_TYPES : GDO_CHEST_TYPES;
        const result = [...existing];

        // Create missing chest types
        for (const def of chestDefs) {
            const hasType = existing.some(c => c.chestType === def.chestType && c.requiredMetric === def.requiredMetric);
            if (!hasType) {
                const newChest = {
                    id: crypto.randomUUID(),
                    userId,
                    chestType: def.chestType,
                    requiredMetric: def.requiredMetric,
                    requiredValue: def.requiredValue,
                    currentValue: 0,
                    isReady: false,
                    openedAt: null,
                    rewardCreatureId: null,
                    rewardCoins: null,
                };
                await db.insert(actionChests).values(newChest);
                result.push(newChest as typeof existing[0]);
            }
        }

        return result;
    } catch (error) {
        console.error("Errore getOrCreateActiveChests:", error);
        return [];
    }
}

/**
 * Increment chest progress for a specific metric.
 * Automatically marks chest as ready when threshold is reached.
 */
export async function incrementChestProgress(userId: string, metric: string, amount: number = 1) {
    try {
        // Find active (unopened) chests matching this metric
        const chests = await db.select().from(actionChests)
            .where(and(
                eq(actionChests.userId, userId),
                eq(actionChests.requiredMetric, metric),
                isNull(actionChests.openedAt),
                eq(actionChests.isReady, false)
            ));

        for (const chest of chests) {
            const newValue = chest.currentValue + amount;
            const isReady = newValue >= chest.requiredValue;

            await db.update(actionChests)
                .set({ currentValue: newValue, isReady })
                .where(eq(actionChests.id, chest.id));
        }
    } catch (error) {
        console.error("Errore incrementChestProgress:", error);
    }
}

/**
 * Open a ready chest. Drops creature + coins, then resets for next cycle.
 */
export async function openChest(userId: string, chestId: string) {
    try {
        // Drop creature outside transaction (uses its own db calls)
        let creatureDrop: Awaited<ReturnType<typeof dropCreature>> = null;

        return await db.transaction(async (tx) => {
            const [chest] = await tx.select().from(actionChests)
                .where(and(eq(actionChests.id, chestId), eq(actionChests.userId, userId)));

            if (!chest) return { success: false, error: 'Baule non trovato' };
            if (!chest.isReady) return { success: false, error: 'Baule non ancora pronto' };
            if (chest.openedAt) return { success: false, error: 'Baule gia aperto' };

            // Determine rewards
            const rewardDef = CHEST_REWARDS[chest.chestType] || CHEST_REWARDS.bronze;
            const rewardCoins = Math.floor(Math.random() * (rewardDef.maxCoins - rewardDef.minCoins + 1)) + rewardDef.minCoins;

            // Drop a creature (outside tx scope since it manages its own inserts)
            creatureDrop = await dropCreature(userId);

            // Mark chest as opened
            await tx.update(actionChests)
                .set({
                    openedAt: new Date(),
                    rewardCoins,
                    rewardCreatureId: creatureDrop?.creature?.id || null,
                })
                .where(eq(actionChests.id, chestId));

            // Award coins to user's wallet
            const [user] = await tx.select({ walletCoins: users.walletCoins }).from(users)
                .where(eq(users.id, userId));

            if (user) {
                await tx.update(users)
                    .set({ walletCoins: user.walletCoins + rewardCoins })
                    .where(eq(users.id, userId));

                // Log coin transaction
                await tx.insert(coinTransactions).values({
                    id: crypto.randomUUID(),
                    userId,
                    amount: rewardCoins,
                    reason: `Baule ${chest.chestType} aperto`,
                });
            }

            // Create a new chest of the same type (reset cycle)
            const chestDefs = [...GDO_CHEST_TYPES, ...TEAM_CHEST_TYPES];
            const matchingDef = chestDefs.find(d => d.chestType === chest.chestType && d.requiredMetric === chest.requiredMetric);

            if (matchingDef) {
                await tx.insert(actionChests).values({
                    id: crypto.randomUUID(),
                    userId,
                    chestType: matchingDef.chestType,
                    requiredMetric: matchingDef.requiredMetric,
                    requiredValue: matchingDef.requiredValue,
                    currentValue: 0,
                    isReady: false,
                    openedAt: null,
                    rewardCreatureId: null,
                    rewardCoins: null,
                });
            }

            return {
                success: true,
                rewardCoins,
                creature: creatureDrop?.creature || null,
            };
        });
    } catch (error) {
        console.error("Errore openChest:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get all chests for a user (active + recently opened).
 */
export async function getUserChests(userId: string) {
    try {
        return await db.select().from(actionChests)
            .where(eq(actionChests.userId, userId));
    } catch (error) {
        console.error("Errore getUserChests:", error);
        return [];
    }
}
