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

    // Recupero il Gamification State di questa settimana correntemente in corso
    const weekState = await getCurrentGdoGamificationState(userId);

    // Potremmo ricalcolare live i bonus del mese intero incrociando i target, ma per l'MVP
    // simuliamo lo sblocco live incrociando i dati settimanali attuali.
    let expectedMonthBonus = 0;
    if (weekState.currentPresences >= weekState.target2) expectedMonthBonus += weekState.reward2;
    // se non raggiunge il T2 ma raggiunge il T1
    else if (weekState.currentPresences >= weekState.target1) expectedMonthBonus += weekState.reward1;

    // A scopi illustrativi sulla Dashboard, usiamo totalBonusesEur come cassaforte storica.
    const expectedSalaryGross = user.baseSalaryEur + expectedMonthBonus + user.totalBonusesEur;

    const currentStage = getEvolutionStage(user.level);
    const targetXpForNext = GAME_CONSTANTS.calculateTargetXp(user.level);

    return {
        ...user,
        stage: currentStage,
        targetXpForNext,
        weekState,
        financials: {
            expectedSalaryGross,
            earnedMonthBonus: expectedMonthBonus,
            historicalBonus: user.totalBonusesEur
        },
        roadmap: ROADMAP_REWARDS.filter(r => r.level >= user.level).slice(0, 3) // Le prossime 3 milestone
    }
}
