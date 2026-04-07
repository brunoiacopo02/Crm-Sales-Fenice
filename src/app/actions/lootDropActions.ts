'use server';

import { db } from "@/db";
import { lootDrops, leads, users, coinTransactions, notifications } from "@/db/schema";
import { eq, and, isNotNull, count } from "drizzle-orm";
import { GAME_CONSTANTS } from "@/lib/gamificationEngine";
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils";

/**
 * Roll a weighted random rarity for loot drop.
 * Uses cumulative weight approach for weighted random selection.
 */
function rollRarity(): typeof GAME_CONSTANTS.LOOT_DROP.RARITY_WEIGHTS[number] {
    const weights = GAME_CONSTANTS.LOOT_DROP.RARITY_WEIGHTS;
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const tier of weights) {
        roll -= tier.weight;
        if (roll <= 0) return tier;
    }
    return weights[0]; // fallback to common
}

/**
 * Generate a random coin value within a range (inclusive).
 */
function randomCoins(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Check if user is eligible for a loot drop (every 10 appointments).
 * If eligible, create and return the loot drop.
 * Called after each appointment is set.
 */
export async function triggerLootDrop(userId: string): Promise<{
    success: boolean;
    lootDrop?: {
        id: string;
        rarity: string;
    };
    error?: string;
}> {
    try {
        const { TRIGGER_EVERY } = GAME_CONSTANTS.LOOT_DROP;

        // Count total appointments set by this user
        const result = await db.select({ value: count() })
            .from(leads)
            .where(and(
                eq(leads.assignedToId, userId),
                isNotNull(leads.appointmentCreatedAt)
            ));
        const totalAppointments = result[0]?.value ?? 0;

        // Check if this is a milestone (multiple of TRIGGER_EVERY)
        if (totalAppointments === 0 || totalAppointments % TRIGGER_EVERY !== 0) {
            return { success: true }; // Not a milestone, no drop
        }

        // Roll rarity
        const tier = rollRarity();
        const coins = randomCoins(tier.minCoins, tier.maxCoins);

        // For legendary, pick a random title
        let bonusTitle: string | null = null;
        if (tier.rarity === 'legendary') {
            const titles = GAME_CONSTANTS.LOOT_DROP.LEGENDARY_TITLES;
            bonusTitle = titles[Math.floor(Math.random() * titles.length)];
        }

        const dropId = crypto.randomUUID();

        await db.insert(lootDrops).values({
            id: dropId,
            userId,
            rarity: tier.rarity,
            rewardType: tier.rewardType,
            rewardValue: coins,
            bonusXp: 'bonusXp' in tier ? (tier as { bonusXp: number }).bonusXp : 0,
            bonusTitle,
            opened: false,
        });

        // Notify user about the loot drop
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: userId,
            type: 'loot_drop',
            title: 'Loot Drop!',
            body: `Hai raggiunto ${totalAppointments} appuntamenti! Un bottino ${tier.rarity} ti aspetta!`,
            metadata: {
                lootDropId: dropId,
                rarity: tier.rarity,
                milestone: totalAppointments,
            },
        });

        return { success: true, lootDrop: { id: dropId, rarity: tier.rarity } };
    } catch (error) {
        console.error("Errore triggerLootDrop:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get all unopened loot drops for a user.
 */
export async function getUserPendingLootDrops(userId: string): Promise<{
    drops: Array<{
        id: string;
        rarity: string;
        droppedAt: Date;
    }>;
}> {
    try {
        const drops = await db.select({
            id: lootDrops.id,
            rarity: lootDrops.rarity,
            droppedAt: lootDrops.droppedAt,
        })
            .from(lootDrops)
            .where(and(
                eq(lootDrops.userId, userId),
                eq(lootDrops.opened, false)
            ));

        return { drops };
    } catch (error) {
        console.error("Errore getUserPendingLootDrops:", error);
        return { drops: [] };
    }
}

/**
 * Open a loot drop: mark as opened, award rewards, return details for UI animation.
 */
export async function openLootDrop(userId: string, lootDropId: string): Promise<{
    success: boolean;
    reward?: {
        rarity: string;
        coins: number;
        bonusXp: number;
        bonusTitle: string | null;
        rewardType: string;
    };
    error?: string;
}> {
    try {
        // Fetch the loot drop
        const [drop] = await db.select().from(lootDrops)
            .where(and(
                eq(lootDrops.id, lootDropId),
                eq(lootDrops.userId, userId),
                eq(lootDrops.opened, false)
            ));

        if (!drop) {
            return { success: false, error: 'Loot drop non trovato o già aperto' };
        }

        // Mark as opened
        await db.update(lootDrops).set({
            opened: true,
            openedAt: new Date(),
        }).where(eq(lootDrops.id, lootDropId));

        // Apply seasonal event multiplier
        const eventMult = await getActiveEventMultipliers();
        const effectiveLootCoins = Math.floor(drop.rewardValue * eventMult.coins);
        const effectiveLootXp = Math.floor(drop.bonusXp * eventMult.xp);

        // Award coins
        const userRow = (await db.select({ coins: users.coins, experience: users.experience, level: users.level })
            .from(users)
            .where(eq(users.id, userId)))[0];

        if (userRow) {
            const newCoins = userRow.coins + effectiveLootCoins;
            let newXp = userRow.experience;
            let newLevel = userRow.level;

            // Apply bonus XP for epic drops (with event multiplier)
            if (effectiveLootXp > 0) {
                newXp += effectiveLootXp;
                // Handle level-up
                let targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);
                while (newXp >= targetXp) {
                    newXp -= targetXp;
                    newLevel++;
                    targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);
                }
            }

            const updateFields: Record<string, any> = {
                coins: newCoins,
                experience: newXp,
                level: newLevel,
            };

            // Auto-equip legendary title if user has no active title
            if (drop.bonusTitle) {
                const userFull = (await db.select({ activeTitle: users.activeTitle })
                    .from(users)
                    .where(eq(users.id, userId)))[0];
                if (!userFull?.activeTitle) {
                    updateFields.activeTitle = drop.bonusTitle;
                }
            }

            await db.update(users).set(updateFields).where(eq(users.id, userId));

            // Log coin transaction
            const rarityLabel = drop.rarity.charAt(0).toUpperCase() + drop.rarity.slice(1);
            const lootReason = eventMult.coins > 1
                ? `Loot Drop ${rarityLabel}${effectiveLootXp > 0 ? ` (+${effectiveLootXp} XP)` : ''} (x${eventMult.coins} evento)`
                : `Loot Drop ${rarityLabel}${effectiveLootXp > 0 ? ` (+${effectiveLootXp} XP)` : ''}`;
            await db.insert(coinTransactions).values({
                id: crypto.randomUUID(),
                userId,
                amount: effectiveLootCoins,
                reason: lootReason,
            });
        }

        return {
            success: true,
            reward: {
                rarity: drop.rarity,
                coins: effectiveLootCoins,
                bonusXp: effectiveLootXp,
                bonusTitle: drop.bonusTitle,
                rewardType: drop.rewardType,
            },
        };
    } catch (error) {
        console.error("Errore openLootDrop:", error);
        return { success: false, error: String(error) };
    }
}
