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
    },

    // Economy rebalancing (F2-026)
    SPRINT_WIN: {
        MAX_COINS: 25, // 1-25 proportional to sprint duration
        BASE_DURATION_MINUTES: 120, // duration that yields max reward
    },
    ACHIEVEMENT_COINS: {
        BRONZE: 20,
        SILVER: 75,
        GOLD: 200,
    } as Record<string, number>,
    STREAK_MILESTONE: {
        COINS: 50, // awarded every INTERVAL days
        INTERVAL: 7,
    },
    LOOT_DROP: {
        TRIGGER_EVERY: 10, // every N appointments
        RARITY_WEIGHTS: [
            { rarity: 'common', weight: 60, minCoins: 10, maxCoins: 30, rewardType: 'coins' },
            { rarity: 'rare', weight: 25, minCoins: 50, maxCoins: 100, rewardType: 'coins' },
            { rarity: 'epic', weight: 12, minCoins: 200, maxCoins: 200, rewardType: 'coins_xp', bonusXp: 500 },
            { rarity: 'legendary', weight: 3, minCoins: 500, maxCoins: 500, rewardType: 'coins_title' },
        ] as const,
        LEGENDARY_TITLES: [
            'Il Drago d\'Oro',
            'La Fenice Immortale',
            'Il Conquistatore',
            'L\'Inarrestabile',
            'Il Mito Vivente',
        ],
    },
};

/**
 * Unlockable titles based on lifetime stats.
 * Each title has a metric requirement that maps to measureAchievementMetric() in achievementActions.
 * Legendary titles from loot drops are tracked separately (stored directly on lootDrops.bonusTitle).
 */
export const UNLOCKABLE_TITLES: Array<{
    id: string;
    name: string;
    description: string;
    metric: string;
    requiredValue: number;
    icon: string;
    category: 'calls' | 'appointments' | 'streak' | 'level' | 'quests' | 'legendary';
}> = [
    // Call-based
    { id: 'shark', name: 'Lo Squalo', description: '500 chiamate effettuate', metric: 'total_calls', requiredValue: 500, icon: 'Fish', category: 'calls' },
    { id: 'switchboard', name: 'Centralino Vivente', description: '2000 chiamate effettuate', metric: 'total_calls', requiredValue: 2000, icon: 'Phone', category: 'calls' },
    { id: 'the_voice', name: 'La Voce', description: '5000 chiamate effettuate', metric: 'total_calls', requiredValue: 5000, icon: 'Mic', category: 'calls' },

    // Appointment-based
    { id: 'fixer', name: 'Il Fissatore', description: '50 appuntamenti fissati', metric: 'total_appointments', requiredValue: 50, icon: 'CalendarCheck', category: 'appointments' },
    { id: 'king_appts', name: 'Re degli Appuntamenti', description: '200 appuntamenti fissati', metric: 'total_appointments', requiredValue: 200, icon: 'Crown', category: 'appointments' },
    { id: 'ace', name: "L'Asso", description: '500 appuntamenti fissati', metric: 'total_appointments', requiredValue: 500, icon: 'Star', category: 'appointments' },

    // Streak-based
    { id: 'steady', name: 'Il Costante', description: '14 giorni di streak', metric: 'current_streak', requiredValue: 14, icon: 'Flame', category: 'streak' },
    { id: 'marathoner', name: 'Il Maratoneta', description: '45 giorni di streak', metric: 'current_streak', requiredValue: 45, icon: 'Timer', category: 'streak' },
    { id: 'veteran', name: 'Il Veterano', description: '90 giorni di streak', metric: 'current_streak', requiredValue: 90, icon: 'Shield', category: 'streak' },

    // Level-based
    { id: 'golden_phoenix', name: "La Fenice d'Oro", description: 'Raggiungi il livello 30', metric: 'current_level', requiredValue: 30, icon: 'Sparkles', category: 'level' },
    { id: 'divinity', name: 'La Divinità', description: 'Raggiungi il livello 40', metric: 'current_level', requiredValue: 40, icon: 'Zap', category: 'level' },
    { id: 'legend', name: 'La Leggenda', description: 'Raggiungi il livello 50', metric: 'current_level', requiredValue: 50, icon: 'Award', category: 'level' },

    // Quest-based
    { id: 'adventurer', name: "L'Avventuriero", description: '100 quest completate', metric: 'total_quests_completed', requiredValue: 100, icon: 'Compass', category: 'quests' },
    { id: 'quest_hunter', name: 'Il Cacciatore di Quest', description: '500 quest completate', metric: 'total_quests_completed', requiredValue: 500, icon: 'Crosshair', category: 'quests' },
];

export const EVOLUTION_STAGES = [
    { minLevel: 1, maxLevel: 7, name: 'Uovo', imageUrl: '/avatars/evo-1-uovo.png', color: 'text-slate-400', badgeClass: 'bg-slate-100 text-slate-600 border-slate-300' },
    { minLevel: 8, maxLevel: 17, name: 'Pulcino', imageUrl: '/avatars/evo-2-pulcino.png', color: 'text-yellow-600', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { minLevel: 18, maxLevel: 25, name: 'Fenice Giovane', imageUrl: '/avatars/evo-3-giovane.png', color: 'text-orange-500', badgeClass: 'bg-orange-100 text-orange-800 border-orange-300' },
    { minLevel: 26, maxLevel: 34, name: 'Fenice di Fuoco', imageUrl: '/avatars/evo-4-adulta.png', color: 'text-red-600', badgeClass: 'bg-red-100 text-red-800 border-red-300' },
    { minLevel: 35, maxLevel: 999, name: 'Divinità Fenice', imageUrl: '/avatars/evo-5-divinita.png', color: 'text-purple-600', badgeClass: 'bg-purple-100 text-purple-800 border-purple-400' },
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
