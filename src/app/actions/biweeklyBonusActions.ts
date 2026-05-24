'use server';

/**
 * Server actions per lo storico cicli bisettimanali dei GDO.
 * Mostrato su /kpi-gdo ("Le mie Performance") sotto i widget Target.
 */

import { db } from "@/db";
import { weeklyGamificationRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getBiweeklyCycle, getBiweeklyCycleByIndex, getRecentClosedCycles, type BiweeklyCycle } from "@/lib/biweeklyCycle";
import { countPresences } from "@/lib/presenceCounting";
import { currentTenant, assertSalesArea } from "@/lib/tenancy";

export interface BiweeklyCycleSummary {
    cycleIndex: number;
    label: string;
    startDateStr: string;
    endDateStr: string;
    presences: number;
    target1: number;
    target2: number;
    reward1: number;
    reward2: number;
    tier1Reached: boolean;
    tier2Reached: boolean;
    /** Bonus maturato per quel ciclo, in €. */
    bonusEur: number;
    /** True se il ciclo è quello in corso (non ancora chiuso). */
    isCurrent: boolean;
}

/** Default GDO bisettimanali (sovrascrivibili mese-per-mese in DB). */
const DEFAULT_TARGET1 = 18;
const DEFAULT_TARGET2 = 22;
const DEFAULT_REWARD1 = 270;
const DEFAULT_REWARD2 = 540;

async function loadRuleForMonth(yearMonth: string, companyId: string): Promise<{ target1: number; target2: number; reward1: number; reward2: number }> {
    const rules = await db.select().from(weeklyGamificationRules).where(and(
        eq(weeklyGamificationRules.companyId, companyId),
        eq(weeklyGamificationRules.month, yearMonth),
    ));
    if (rules.length > 0) {
        return {
            target1: rules[0].targetTier1,
            target2: rules[0].targetTier2,
            reward1: rules[0].rewardTier1,
            reward2: rules[0].rewardTier2,
        };
    }
    return { target1: DEFAULT_TARGET1, target2: DEFAULT_TARGET2, reward1: DEFAULT_REWARD1, reward2: DEFAULT_REWARD2 };
}

function yearMonthFromCycle(c: BiweeklyCycle): string {
    return c.startDateStr.slice(0, 7);
}

async function summarizeCycle(userId: string, cycle: BiweeklyCycle, isCurrent: boolean, companyId: string): Promise<BiweeklyCycleSummary> {
    const rule = await loadRuleForMonth(yearMonthFromCycle(cycle), companyId);
    const { total: presences } = await countPresences(userId, cycle.start, cycle.end);
    const tier1Reached = presences >= rule.target1;
    const tier2Reached = presences >= rule.target2;
    // Bonus cumulato come da business rule: T1 sblocca reward1, T2 sblocca anche reward2.
    let bonusEur = 0;
    if (tier1Reached) bonusEur += rule.reward1;
    if (tier2Reached) bonusEur += rule.reward2;
    return {
        cycleIndex: cycle.index,
        label: cycle.label,
        startDateStr: cycle.startDateStr,
        endDateStr: cycle.endDateStr,
        presences,
        target1: rule.target1,
        target2: rule.target2,
        reward1: rule.reward1,
        reward2: rule.reward2,
        tier1Reached,
        tier2Reached,
        bonusEur,
        isCurrent,
    };
}

/**
 * Ritorna il ciclo corrente + ultimi `lookback` cicli chiusi del GDO.
 * Ordinato dal più recente al più vecchio.
 */
export async function getBiweeklyHistory(userId: string, lookback = 8): Promise<BiweeklyCycleSummary[]> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const now = new Date();
    const current = getBiweeklyCycle(now);
    const closed = getRecentClosedCycles(lookback, now);

    const summaries = await Promise.all([
        summarizeCycle(userId, current, true, ctx.companyId),
        ...closed.map(c => summarizeCycle(userId, c, false, ctx.companyId)),
    ]);
    return summaries;
}

/** Singolo ciclo per indice — utility per debug/test. */
export async function getBiweeklyCycleSummary(userId: string, cycleIndex: number): Promise<BiweeklyCycleSummary> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const cycle = getBiweeklyCycleByIndex(cycleIndex);
    const currentIndex = getBiweeklyCycle(new Date()).index;
    return summarizeCycle(userId, cycle, cycleIndex === currentIndex, ctx.companyId);
}
