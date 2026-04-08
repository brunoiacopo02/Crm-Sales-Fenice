'use server';

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentGdoGamificationState } from "@/app/actions/gdoPerformanceActions";
import { getEvolutionStage, GAME_CONSTANTS, ROADMAP_REWARDS } from "@/lib/gamificationEngine";

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
        roadmap: ROADMAP_REWARDS.filter(r => r.level >= user.level).slice(0, 3)
    }
}
