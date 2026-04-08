'use server';

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentGdoGamificationState } from "@/app/actions/gdoPerformanceActions";
import { getEvolutionStage, GAME_CONSTANTS, ROADMAP_REWARDS, EVOLUTION_STAGES, UNLOCKABLE_TITLES } from "@/lib/gamificationEngine";

export async function getGdoRpgProfile(userId: string) {
    const userRows = await db.select().from(users).where(eq(users.id, userId));
    if (userRows.length === 0) throw new Error("Utente non trovato");

    const user = userRows[0];
    const role = user.role || 'GDO';

    // Recupero il Gamification State di questa settimana correntemente in corso
    let weekState;
    if (role === 'CONFERME') {
        // Per Conferme: target da confermeTargetTier1/Tier2, reward fissi 145/290
        weekState = await getCurrentGdoGamificationState(userId, undefined, {
            role: 'CONFERME',
            target1Override: user.confermeTargetTier1 || 18,
            reward1Override: 145,
            target2Override: user.confermeTargetTier2 || 21,
            reward2Override: 290,
        });
    } else {
        weekState = await getCurrentGdoGamificationState(userId);
    }

    let expectedMonthBonus = 0;
    if (weekState.currentPresences >= weekState.target2) expectedMonthBonus += weekState.reward2;
    else if (weekState.currentPresences >= weekState.target1) expectedMonthBonus += weekState.reward1;

    const currentStage = getEvolutionStage(user.level);
    const targetXpForNext = GAME_CONSTANTS.calculateTargetXp(user.level);

    // Per venditori e manager non mostriamo lo stipendio, solo il bonus
    const showSalary = role === 'GDO' || role === 'CONFERME';
    const expectedSalaryGross = showSalary ? user.baseSalaryEur + expectedMonthBonus + user.totalBonusesEur : 0;

    // XP milestones for the enhanced progress bar (next 3 levels)
    const xpMilestones: Array<{
        level: number;
        xpCumulative: number;
        rewards: string[];
        rewardType: 'coins' | 'evolution' | 'title' | 'level';
    }> = [];
    let cumulativeXp = 0;
    for (let i = 0; i < 3; i++) {
        const lvl = user.level + 1 + i;
        const xpForThisLevel = GAME_CONSTANTS.calculateTargetXp(user.level + i);
        cumulativeXp += xpForThisLevel;

        const rewards: string[] = [];
        const roadmapReward = ROADMAP_REWARDS.find(r => r.level === lvl);
        if (roadmapReward) rewards.push(`${roadmapReward.rewardCoins} Coins`);
        const evolutionStage = EVOLUTION_STAGES.find(s => s.minLevel === lvl);
        if (evolutionStage) rewards.push(`Evoluzione: ${evolutionStage.name}`);
        const titleUnlock = UNLOCKABLE_TITLES.find(t => t.category === 'level' && t.requiredValue === lvl);
        if (titleUnlock) rewards.push(`Titolo: ${titleUnlock.name}`);

        xpMilestones.push({
            level: lvl,
            xpCumulative: cumulativeXp,
            rewards,
            rewardType: roadmapReward ? 'coins' : evolutionStage ? 'evolution' : titleUnlock ? 'title' : 'level',
        });
    }
    const totalThreeLevelXp = cumulativeXp;

    // Upcoming rewards across all types (for "Prossimi premi" section)
    const upcomingRewards: Array<{
        level: number;
        type: 'coins' | 'evolution' | 'title';
        label: string;
        detail: string;
    }> = [];
    ROADMAP_REWARDS.filter(r => r.level > user.level).forEach(r => {
        upcomingRewards.push({ level: r.level, type: 'coins', label: `${r.rewardCoins} Coins`, detail: `Sblocchi ${r.rewardCoins} Fenice Coins` });
    });
    EVOLUTION_STAGES.filter(s => s.minLevel > user.level).forEach(s => {
        upcomingRewards.push({ level: s.minLevel, type: 'evolution', label: s.name, detail: `Evolvi in ${s.name}` });
    });
    UNLOCKABLE_TITLES.filter(t => t.category === 'level' && t.requiredValue > user.level).forEach(t => {
        upcomingRewards.push({ level: t.requiredValue, type: 'title', label: t.name, detail: t.description });
    });
    upcomingRewards.sort((a, b) => a.level - b.level);

    return {
        ...user,
        stage: currentStage,
        targetXpForNext,
        weekState,
        financials: {
            expectedSalaryGross,
            earnedMonthBonus: expectedMonthBonus,
            historicalBonus: user.totalBonusesEur,
            showSalary,
        },
        roadmap: ROADMAP_REWARDS.filter(r => r.level >= user.level).slice(0, 3),
        xpMilestones,
        totalThreeLevelXp,
        upcomingRewards: upcomingRewards.slice(0, 3),
    }
}
