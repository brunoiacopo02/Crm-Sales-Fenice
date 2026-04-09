'use server';

import { db } from "@/db";
import { creatures, userCreatures, coinTransactions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

// Rarity drop weights
const RARITY_WEIGHTS = [
    { rarity: 'common', weight: 60 },
    { rarity: 'rare', weight: 25 },
    { rarity: 'epic', weight: 12 },
    { rarity: 'legendary', weight: 3 },
] as const;

function pickRarity(override?: string): string {
    if (override) return override;
    const roll = Math.random() * 100;
    let cumulative = 0;
    for (const rw of RARITY_WEIGHTS) {
        cumulative += rw.weight;
        if (roll < cumulative) return rw.rarity;
    }
    return 'common';
}

/**
 * Drop a random creature to user's inventory.
 * Picks a random creature of the selected rarity and adds it to userCreatures.
 */
export async function dropCreature(userId: string, rarityOverride?: string) {
    try {
        const rarity = pickRarity(rarityOverride);

        // Get all creatures of this rarity
        const pool = await db.select().from(creatures)
            .where(and(eq(creatures.rarity, rarity), eq(creatures.isActive, true)));

        if (pool.length === 0) return null;

        // Pick random creature from pool
        const picked = pool[Math.floor(Math.random() * pool.length)];

        // Insert into userCreatures
        const userCreature = {
            id: crypto.randomUUID(),
            userId,
            creatureId: picked.id,
            level: 1,
            xpFed: 0,
            isEquipped: false,
            obtainedAt: new Date(),
        };

        await db.insert(userCreatures).values(userCreature);

        return {
            userCreatureId: userCreature.id,
            creature: picked,
            rarity: picked.rarity,
        };
    } catch (error) {
        console.error("Errore dropCreature:", error);
        return null;
    }
}

/**
 * Get all creatures owned by user, with creature info.
 */
export async function getUserCreatures(userId: string) {
    try {
        const rows = await db
            .select({
                userCreatureId: userCreatures.id,
                creatureId: userCreatures.creatureId,
                level: userCreatures.level,
                xpFed: userCreatures.xpFed,
                isEquipped: userCreatures.isEquipped,
                obtainedAt: userCreatures.obtainedAt,
                name: creatures.name,
                description: creatures.description,
                rarity: creatures.rarity,
                element: creatures.element,
                imageUrl: creatures.imageUrl,
                baseXpBonus: creatures.baseXpBonus,
                baseCoinBonus: creatures.baseCoinBonus,
                maxLevel: creatures.maxLevel,
            })
            .from(userCreatures)
            .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
            .where(eq(userCreatures.userId, userId));

        return rows;
    } catch (error) {
        console.error("Errore getUserCreatures:", error);
        return [];
    }
}

/**
 * Equip a creature. Un-equips the currently equipped one first.
 */
export async function equipCreature(userId: string, userCreatureId: string) {
    try {
        // Un-equip all currently equipped
        await db.update(userCreatures)
            .set({ isEquipped: false })
            .where(and(eq(userCreatures.userId, userId), eq(userCreatures.isEquipped, true)));

        // Equip the selected one
        await db.update(userCreatures)
            .set({ isEquipped: true })
            .where(and(eq(userCreatures.id, userCreatureId), eq(userCreatures.userId, userId)));

        return { success: true };
    } catch (error) {
        console.error("Errore equipCreature:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Fuse 3 copies of the same creature to level up one of them.
 * Consumes 3 duplicates (non-equipped) and increments level of one copy by 1.
 * Max level = 10.
 */
export async function fuseCreatures(userId: string, creatureId: string) {
    try {
        // Get all copies of this creature owned by user
        const copies = await db.select().from(userCreatures)
            .where(and(eq(userCreatures.userId, userId), eq(userCreatures.creatureId, creatureId)));

        if (copies.length < 3) {
            return { success: false, error: 'Servono almeno 3 copie per la fusione' };
        }

        // Find the highest-level copy to keep (prefer equipped)
        const sorted = [...copies].sort((a, b) => {
            if (a.isEquipped && !b.isEquipped) return -1;
            if (!a.isEquipped && b.isEquipped) return 1;
            return b.level - a.level;
        });

        const keeper = sorted[0];

        if (keeper.level >= 10) {
            return { success: false, error: 'Creatura gia al livello massimo (10)' };
        }

        // Find 3 copies to consume (excluding the keeper)
        const toConsume = sorted.filter(c => c.id !== keeper.id).slice(0, 3);
        if (toConsume.length < 3) {
            return { success: false, error: 'Servono almeno 3 copie extra per la fusione' };
        }

        // Delete the consumed copies
        for (const c of toConsume) {
            await db.delete(userCreatures).where(eq(userCreatures.id, c.id));
        }

        // Level up the keeper
        await db.update(userCreatures)
            .set({ level: keeper.level + 1 })
            .where(eq(userCreatures.id, keeper.id));

        return {
            success: true,
            newLevel: keeper.level + 1,
            consumed: toConsume.length,
        };
    } catch (error) {
        console.error("Errore fuseCreatures:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get all creature definitions (for collection counter).
 */
export async function getAllCreatureDefinitions() {
    try {
        return await db.select().from(creatures).where(eq(creatures.isActive, true));
    } catch (error) {
        console.error("Errore getAllCreatureDefinitions:", error);
        return [];
    }
}

/**
 * Get the XP and coin bonus from the user's equipped creature.
 * Bonus scales with level: level 1 = base, level 10 = base * 3.
 */
export async function getEquippedCreatureBonus(userId: string): Promise<{ xpBonus: number; coinBonus: number }> {
    try {
        const rows = await db
            .select({
                level: userCreatures.level,
                baseXpBonus: creatures.baseXpBonus,
                baseCoinBonus: creatures.baseCoinBonus,
            })
            .from(userCreatures)
            .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
            .where(and(eq(userCreatures.userId, userId), eq(userCreatures.isEquipped, true)))
            .limit(1);

        if (rows.length === 0) return { xpBonus: 0, coinBonus: 0 };

        const { level, baseXpBonus, baseCoinBonus } = rows[0];

        // Scale: level 1 = 1x base, level 10 = 3x base (linear interpolation)
        const scaleFactor = 1 + ((level - 1) / 9) * 2; // 1.0 at level 1, 3.0 at level 10

        return {
            xpBonus: baseXpBonus * scaleFactor,
            coinBonus: baseCoinBonus * scaleFactor,
        };
    } catch (error) {
        console.error("Errore getEquippedCreatureBonus:", error);
        return { xpBonus: 0, coinBonus: 0 };
    }
}
