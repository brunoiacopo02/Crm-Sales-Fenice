'use server';

import { db } from "@/db";
import { users, coinTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { GAME_CONSTANTS } from "@/lib/gamificationEngine";
import { getActiveEventMultipliers } from "@/lib/seasonalEventUtils";
import { getStreakMultiplier } from "@/lib/streakUtils";

/**
 * Chest rarity tiers — same weights as LOOT_DROP but independent config for timed chests.
 * 60% common (10-30c), 25% rare (50-100c), 12% epic (200c), 3% legendary (500c + title)
 */
const CHEST_RARITY_WEIGHTS = [
    { rarity: 'common', weight: 60, minCoins: 10, maxCoins: 30 },
    { rarity: 'rare', weight: 25, minCoins: 50, maxCoins: 100 },
    { rarity: 'epic', weight: 12, minCoins: 200, maxCoins: 200 },
    { rarity: 'legendary', weight: 3, minCoins: 500, maxCoins: 500 },
] as const;

function rollChestRarity(): typeof CHEST_RARITY_WEIGHTS[number] {
    const totalWeight = CHEST_RARITY_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const tier of CHEST_RARITY_WEIGHTS) {
        roll -= tier.weight;
        if (roll <= 0) return tier;
    }
    return CHEST_RARITY_WEIGHTS[0];
}

function randomCoins(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Minimum server-side cooldown between chest claims (10 minutes)
const CHEST_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Claim a timed chest reward. Rolls rarity, generates coins, updates walletCoins,
 * logs coinTransaction, and returns reward details for UI animation.
 * Server-side cooldown prevents rapid repeated claims.
 */
export async function claimTimedChestReward(userId: string): Promise<{
    success: boolean;
    reward?: {
        rarity: string;
        coins: number;
        bonusTitle: string | null;
    };
    error?: string;
}> {
    try {
        // Fetch user
        const [user] = await db.select({
            walletCoins: users.walletCoins,
            streakCount: users.streakCount,
            activeTitle: users.activeTitle,
            lastTimedChestAt: users.lastTimedChestAt,
        }).from(users).where(eq(users.id, userId));

        if (!user) {
            return { success: false, error: 'Utente non trovato' };
        }

        // Server-side cooldown check
        if (user.lastTimedChestAt) {
            const elapsed = Date.now() - new Date(user.lastTimedChestAt).getTime();
            if (elapsed < CHEST_COOLDOWN_MS) {
                const remainingMin = Math.ceil((CHEST_COOLDOWN_MS - elapsed) / 60000);
                return { success: false, error: `Devi aspettare ancora ${remainingMin} minuti prima del prossimo scrigno` };
            }
        }

        // Roll rarity
        const tier = rollChestRarity();
        const baseCoins = randomCoins(tier.minCoins, tier.maxCoins);

        // Apply streak multiplier
        const streakMult = getStreakMultiplier(user.streakCount || 0);

        // Apply seasonal event multiplier
        const eventMult = await getActiveEventMultipliers();

        const effectiveCoins = Math.floor(baseCoins * streakMult * eventMult.coins);

        // For legendary, pick a random bonus title
        let bonusTitle: string | null = null;
        if (tier.rarity === 'legendary') {
            const titles = GAME_CONSTANTS.LOOT_DROP.LEGENDARY_TITLES;
            bonusTitle = titles[Math.floor(Math.random() * titles.length)];
        }

        // Update walletCoins + lastTimedChestAt (server-side cooldown)
        const newCoins = user.walletCoins + effectiveCoins;
        const updateFields: Record<string, unknown> = {
            walletCoins: newCoins,
            lastTimedChestAt: new Date(),
        };

        // Auto-equip legendary title if user has no active title
        if (bonusTitle && !user.activeTitle) {
            updateFields.activeTitle = bonusTitle;
        }

        await db.update(users).set(updateFields).where(eq(users.id, userId));

        // Log coin transaction
        const rarityLabel = tier.rarity.charAt(0).toUpperCase() + tier.rarity.slice(1);
        const multParts: string[] = [];
        if (streakMult > 1) multParts.push(`x${streakMult} streak`);
        if (eventMult.coins > 1) multParts.push(`x${eventMult.coins} evento`);
        const multSuffix = multParts.length > 0 ? ` (${multParts.join(', ')})` : '';

        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount: effectiveCoins,
            reason: `Scrigno a Tempo ${rarityLabel}${multSuffix}`,
        });

        return {
            success: true,
            reward: {
                rarity: tier.rarity,
                coins: effectiveCoins,
                bonusTitle,
            },
        };
    } catch (error) {
        console.error("Errore claimTimedChestReward:", error);
        return { success: false, error: String(error) };
    }
}
