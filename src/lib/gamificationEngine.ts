import { db } from "@/db";
import { users, leadEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

export const GAME_CONSTANTS = {
    // Math curve: TargetXP = floor(100 * (Level ^ 1.5))
    calculateTargetXp: (level: number) => Math.floor(100 * Math.pow(level, 1.5)),

    // XP table for specific actions
    ACTIONS: {
        FISSATO: { xp: 10, coins: 0 },
        PRESENZIATO: { xp: 50, coins: 0 },
        CHIUSO: { xp: 200, coins: 50 },
        BONUS_SETTIMANALE: { xp: 500, coins: 100 },
    }
};

export const EVOLUTION_STAGES = [
    { minLevel: 1, maxLevel: 7, name: 'Uovo', imageUrl: '/avatars/stage1-egg.png', color: 'text-slate-400', badgeClass: 'bg-slate-100 text-slate-600 border-slate-300' },
    { minLevel: 8, maxLevel: 17, name: 'Pulcino', imageUrl: '/avatars/stage2-chick.png', color: 'text-yellow-600', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { minLevel: 18, maxLevel: 25, name: 'Fenice Giovane', imageUrl: '/avatars/stage3-young.png', color: 'text-orange-500', badgeClass: 'bg-orange-100 text-orange-800 border-orange-300' },
    { minLevel: 26, maxLevel: 34, name: 'Fenice di Fuoco', imageUrl: '/avatars/stage4-fire.png', color: 'text-red-600', badgeClass: 'bg-red-100 text-red-800 border-red-300' },
    { minLevel: 35, maxLevel: 999, name: 'Divinità Fenice', imageUrl: '/avatars/stage5-god.png', color: 'text-purple-600', badgeClass: 'bg-purple-100 text-purple-800 border-purple-400' },
];

export const ROADMAP_REWARDS = [
    // E.g., level milestones drop extra coins
    { level: 5, rewardCoins: 30 },
    { level: 10, rewardCoins: 100 },
    { level: 20, rewardCoins: 300 },
    { level: 30, rewardCoins: 1000 },
    { level: 50, rewardCoins: 5000 }, // Endgame goal
];

export function getEvolutionStage(level: number) {
    return EVOLUTION_STAGES.find(s => level >= s.minLevel && level <= s.maxLevel) || EVOLUTION_STAGES[EVOLUTION_STAGES.length - 1];
}

/**
 * Funzione asincrona da richiamare tramite "fire and forget" o await dentro le Server Actions
 * per incrementare passivamente le stats del GDO in base all'azione compiuta.
 */
export async function awardXpAndCoins(userId: string, actionType: keyof typeof GAME_CONSTANTS.ACTIONS, leadIdContext?: string) {
    try {
        const userRows = await db.select().from(users).where(eq(users.id, userId));
        if (userRows.length === 0) return;
        const user = userRows[0];

        const reward = GAME_CONSTANTS.ACTIONS[actionType];
        if (!reward) return;

        let newXp = user.experience + reward.xp;
        let newCoins = user.coins + reward.coins;
        let newLevel = user.level;
        let targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);

        // Handle Level up Loop (in case they gain enough XP to level up multiple times)
        let didLevelUp = false;
        while (newXp >= targetXp) {
            newXp -= targetXp; // Overflow XP
            newLevel++;
            didLevelUp = true;

            // Check roadmap rewards for the newly reached level
            const milestone = ROADMAP_REWARDS.find(r => r.level === newLevel);
            if (milestone) {
                newCoins += milestone.rewardCoins;
            }
            targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);
        }

        // DB Persist
        await db.update(users).set({
            experience: newXp,
            level: newLevel,
            coins: newCoins
        }).where(eq(users.id, userId));

        // Insert event logic for logging if desired, or let the caller do it.
        // We log it quietly for analytics.
        if (leadIdContext) {
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: leadIdContext,
                eventType: `RPG_AWARD_${actionType}`,
                userId: userId,
                metadata: { xpGained: reward.xp, coinsGained: reward.coins, levelUp: didLevelUp }
            });
        }

    } catch (error) {
        console.error("Errore Gamification awardXpAndCoins:", error);
    }
}
