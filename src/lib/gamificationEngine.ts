import { db } from "@/db";
import { users, leadEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

export const GAME_CONSTANTS = {
    // Balanced XP curve: slow early (100-350), medium mid (350-800), high late (800-1500), very high endgame (1500+)
    // Level 1→100, Level 10→352, Level 20→822, Level 30→1492, Level 40→2362
    calculateTargetXp: (level: number) => Math.floor(82 + 17 * level + level * level),

    // XP + Coins table for specific actions (rebalanced FA-002)
    ACTIONS: {
        FISSATO: { xp: 15, coins: 10 },
        CONFERMATO: { xp: 20, coins: 8 },
        PRESENZIATO: { xp: 30, coins: 15 },
        CHIUSO: { xp: 50, coins: 25 },
        BONUS_SETTIMANALE: { xp: 500, coins: 100 },
        DEAL_CHIUSO: { xp: 100, coins: 30 },
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
    BOSS_BATTLE: {
        DAMAGE_PER_APPOINTMENT: 10, // HP removed per appointment
        DEFAULT_HP: 500,
        DEFAULT_REWARD_COINS: 100,
        DEFAULT_REWARD_XP: 200,
    },
    SEASONAL_EVENT: {
        THEMES: ['spring', 'summer', 'halloween', 'christmas', 'custom'] as const,
        DEFAULT_XP_MULTIPLIER: 1.5,
        DEFAULT_COINS_MULTIPLIER: 2,
        THEME_CONFIG: {
            spring: { icon: 'Flower2', color: 'emerald', label: 'Primavera' },
            summer: { icon: 'Sun', color: 'amber', label: 'Estate' },
            halloween: { icon: 'Ghost', color: 'purple', label: 'Halloween' },
            christmas: { icon: 'Gift', color: 'red', label: 'Natale' },
            custom: { icon: 'Sparkles', color: 'brand-orange', label: 'Evento Speciale' },
        } as Record<string, { icon: string; color: string; label: string }>,
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
export interface RewardData {
    xpGained: number;
    coinsGained: number;
    actionType: string;
    didLevelUp: boolean;
    newLevel?: number;
}

export async function awardXpAndCoins(userId: string, actionType: keyof typeof GAME_CONSTANTS.ACTIONS, leadIdContext?: string): Promise<RewardData | null> {
    try {
        const userRows = await db.select().from(users).where(eq(users.id, userId));
        if (userRows.length === 0) return null;
        const user = userRows[0];

        const reward = GAME_CONSTANTS.ACTIONS[actionType];
        if (!reward) return null;

        // Apply streak multiplier
        const { getStreakMultiplier } = await import('@/lib/streakUtils');
        const streakMult = getStreakMultiplier(user.streakCount || 0);

        // Apply seasonal event multipliers
        const { getActiveEventMultipliers } = await import('@/lib/seasonalEventUtils');
        const eventMult = await getActiveEventMultipliers();

        // Apply equipped creature bonus
        const { getEquippedCreatureBonus } = await import('@/app/actions/creatureActions');
        const creatureBonus = await getEquippedCreatureBonus(userId);

        // Combined multipliers: streak × event × (1 + creature bonus)
        const effectiveXp = Math.floor(reward.xp * streakMult * eventMult.xp * (1 + creatureBonus.xpBonus));
        const effectiveCoins = Math.floor(reward.coins * streakMult * eventMult.coins * (1 + creatureBonus.coinBonus));

        let newXp = user.experience + effectiveXp;
        let newWalletCoins = user.walletCoins + effectiveCoins;
        let newLevel = user.level;
        let targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);

        // Handle Level up Loop
        let didLevelUp = false;
        while (newXp >= targetXp) {
            newXp -= targetXp;
            newLevel++;
            didLevelUp = true;

            const milestone = ROADMAP_REWARDS.find(r => r.level === newLevel);
            if (milestone) {
                newWalletCoins += milestone.rewardCoins;
            }
            targetXp = GAME_CONSTANTS.calculateTargetXp(newLevel);
        }

        // DB Persist — use walletCoins (the field displayed in UI and used by store)
        await db.update(users).set({
            experience: newXp,
            level: newLevel,
            walletCoins: newWalletCoins
        }).where(eq(users.id, userId));

        // Log coin transaction for audit trail
        if (effectiveCoins > 0) {
            const { coinTransactions } = await import('@/db/schema');
            const multInfo = streakMult > 1 ? ` (x${streakMult} streak)` : '';
            await db.insert(coinTransactions).values({
                id: crypto.randomUUID(),
                userId,
                amount: effectiveCoins,
                reason: `${actionType}${multInfo}`,
            });
        }

        // Log lead event for analytics
        if (leadIdContext) {
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: leadIdContext,
                eventType: `RPG_AWARD_${actionType}`,
                userId: userId,
                metadata: { xpGained: effectiveXp, coinsGained: effectiveCoins, levelUp: didLevelUp, streakMult, eventMultiplier: eventMult.xp > 1 || eventMult.coins > 1 ? eventMult : undefined, creatureBonus: creatureBonus.xpBonus > 0 ? creatureBonus : undefined }
            });
        }

        return { xpGained: effectiveXp, coinsGained: effectiveCoins, actionType, didLevelUp, newLevel: didLevelUp ? newLevel : undefined };

    } catch (error) {
        console.error("Errore Gamification awardXpAndCoins:", error);
        return null;
    }
}
