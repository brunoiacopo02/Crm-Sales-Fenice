'use server';

import { db } from "@/db";
import { users, questProgress, quests, coinTransactions, leads, weeklyGamificationRules, manualAdjustments } from "@/db/schema";
import { eq, and, inArray, sql, gte, lte, isNotNull } from "drizzle-orm";
import { getEvolutionStage, GAME_CONSTANTS, ROADMAP_REWARDS, EVOLUTION_STAGES, UNLOCKABLE_TITLES } from "@/lib/gamificationEngine";
import { parseISO, endOfMonth, getDay, addDays, isWithinInterval } from "date-fns";

// ---- Helpers replicated from gdoPerformanceActions to avoid circular deps ----

function isPresenziato(outcome: string | null) {
    if (!outcome) return false;
    const lower = outcome.toLowerCase();
    return !lower.includes('sparit') && !lower.includes('assent') && !lower.includes('non presenziato');
}

function getMonthWeeks(monthStr: string) {
    const startObj = parseISO(`${monthStr}-01T00:00:00`);
    const endObj = endOfMonth(startObj);
    const weeks: { name: string; start: Date; end: Date }[] = [];
    let currentStart = startObj;
    let weekIndex = 1;
    while (currentStart <= endObj) {
        let daysToSunday = 0;
        const currentDayOfWeek = getDay(currentStart);
        if (currentDayOfWeek === 0) daysToSunday = 0;
        else daysToSunday = 7 - currentDayOfWeek;
        let currentEnd = addDays(currentStart, daysToSunday);
        currentEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth(), currentEnd.getDate(), 23, 59, 59, 999);
        if (currentEnd > endObj) currentEnd = new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate(), 23, 59, 59, 999);
        weeks.push({ name: `Week ${weekIndex}`, start: currentStart, end: currentEnd });
        currentStart = addDays(new Date(currentEnd.getFullYear(), currentEnd.getMonth(), currentEnd.getDate()), 1);
        currentStart = new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate(), 0, 0, 0, 0);
        weekIndex++;
    }
    return weeks;
}

/**
 * Batch-compute RPG profiles for a set of users in a single pass.
 * Replaces the N+1 pattern of calling getGdoRpgProfile per user.
 */
async function batchComputeRpgProfiles(
    activeUsers: (typeof users.$inferSelect)[],
    includeRole: boolean
) {
    if (activeUsers.length === 0) return [];

    const today = new Date();
    const currentMonthStr = today.toISOString().slice(0, 7);
    const weeks = getMonthWeeks(currentMonthStr);

    // Find current week boundaries
    let currentWeekName = "Fuori Mese";
    let currentWeekStart = today;
    let currentWeekEnd = today;
    const w = weeks.find(wk => isWithinInterval(today, { start: wk.start, end: wk.end }));
    if (w) {
        currentWeekName = w.name;
        currentWeekStart = w.start;
        currentWeekEnd = w.end;
    }

    const userIds = activeUsers.map(u => u.id);
    const gdoUserIds = activeUsers.filter(u => u.role === 'GDO').map(u => u.id);
    const confermeUserIds = activeUsers.filter(u => u.role === 'CONFERME').map(u => u.id);

    // --- 1. Gamification rules (one query, same for all GDO users) ---
    const rules = await db.select().from(weeklyGamificationRules)
        .where(eq(weeklyGamificationRules.month, currentMonthStr));
    let gdoTarget1 = 10, gdoReward1 = 135, gdoTarget2 = 13, gdoReward2 = 270;
    if (rules.length > 0) {
        gdoTarget1 = rules[0].targetTier1;
        gdoReward1 = rules[0].rewardTier1;
        gdoTarget2 = rules[0].targetTier2;
        gdoReward2 = rules[0].rewardTier2;
    }

    // --- 2. Bulk leads queries ---
    // GDO leads: appointments in current week window assigned to any GDO user
    const [gdoLeads, confermeLeads] = await Promise.all([
        gdoUserIds.length > 0
            ? db.select({
                assignedToId: leads.assignedToId,
                salespersonOutcome: leads.salespersonOutcome,
            }).from(leads).where(
                and(
                    inArray(leads.assignedToId, gdoUserIds),
                    isNotNull(leads.appointmentDate),
                    gte(leads.appointmentDate, currentWeekStart),
                    lte(leads.appointmentDate, currentWeekEnd)
                )
            )
            : Promise.resolve([]),
        confermeUserIds.length > 0
            ? db.select({
                confirmationsUserId: leads.confirmationsUserId,
            }).from(leads).where(
                and(
                    inArray(leads.confirmationsUserId, confermeUserIds),
                    eq(leads.confirmationsOutcome, 'confermato'),
                    eq(leads.salespersonOutcome, 'Chiuso'),
                    isNotNull(leads.salespersonOutcomeAt),
                    gte(leads.salespersonOutcomeAt, currentWeekStart),
                    lte(leads.salespersonOutcomeAt, currentWeekEnd)
                )
            )
            : Promise.resolve([]),
    ]);

    // --- 3. Bulk manual adjustments ---
    let allAdjustments: { userId: string; type: string; count: number }[] = [];
    try {
        allAdjustments = await db.select({
            userId: manualAdjustments.userId,
            type: manualAdjustments.type,
            count: manualAdjustments.count,
        }).from(manualAdjustments).where(
            and(
                inArray(manualAdjustments.userId, userIds),
                gte(manualAdjustments.createdAt, currentWeekStart),
                lte(manualAdjustments.createdAt, currentWeekEnd)
            )
        );
    } catch { /* table not yet migrated */ }

    // --- Build per-user presence maps ---
    const gdoPresenceMap = new Map<string, number>();
    for (const lead of gdoLeads) {
        if (!lead.assignedToId) continue;
        if (isPresenziato(lead.salespersonOutcome)) {
            gdoPresenceMap.set(lead.assignedToId, (gdoPresenceMap.get(lead.assignedToId) || 0) + 1);
        }
    }

    const confermePresenceMap = new Map<string, number>();
    for (const lead of confermeLeads) {
        if (!lead.confirmationsUserId) continue;
        confermePresenceMap.set(lead.confirmationsUserId, (confermePresenceMap.get(lead.confirmationsUserId) || 0) + 1);
    }

    // Add manual adjustments
    for (const adj of allAdjustments) {
        if (adj.type === 'presenze') {
            gdoPresenceMap.set(adj.userId, (gdoPresenceMap.get(adj.userId) || 0) + adj.count);
        } else if (adj.type === 'chiusure') {
            confermePresenceMap.set(adj.userId, (confermePresenceMap.get(adj.userId) || 0) + adj.count);
        }
    }

    // --- 4. Assemble profiles in memory ---
    const results = [];
    for (const user of activeUsers) {
        try {
            const role = user.role || 'GDO';
            const isConferme = role === 'CONFERME';

            // Compute weekState equivalent
            let target1: number, reward1: number, target2: number, reward2: number;
            if (isConferme) {
                target1 = user.confermeTargetTier1 || 18;
                reward1 = 145;
                target2 = user.confermeTargetTier2 || 21;
                reward2 = 290;
            } else {
                target1 = gdoTarget1;
                reward1 = gdoReward1;
                target2 = gdoTarget2;
                reward2 = gdoReward2;
            }

            const currentPresences = isConferme
                ? (confermePresenceMap.get(user.id) || 0)
                : (gdoPresenceMap.get(user.id) || 0);

            const weekState = {
                currentPresences,
                target1,
                reward1,
                target2,
                reward2,
                currentWeekName,
                weekStart: currentWeekStart.toISOString().split('T')[0],
                weekEnd: currentWeekEnd.toISOString().split('T')[0],
            };

            // Compute financial info
            let expectedMonthBonus = 0;
            if (weekState.currentPresences >= weekState.target2) expectedMonthBonus += weekState.reward2;
            else if (weekState.currentPresences >= weekState.target1) expectedMonthBonus += weekState.reward1;

            const currentStage = getEvolutionStage(user.level);
            const targetXpForNext = GAME_CONSTANTS.calculateTargetXp(user.level);

            const showSalary = role === 'GDO' || role === 'CONFERME';
            const expectedSalaryGross = showSalary ? user.baseSalaryEur + expectedMonthBonus + user.totalBonusesEur : 0;

            // XP milestones
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

            // Upcoming rewards
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

            const profile = {
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
            };

            if (includeRole) {
                results.push({ ...profile, role: user.role });
            } else {
                results.push(profile);
            }
        } catch (e) {
            console.error(`Errore computing profilo RPG per ${user.id}:`, e);
        }
    }

    return results.sort((a, b) => b.level - a.level);
}

export async function fetchAllGdoRpgProfiles() {
    const allUsers = await db.select().from(users).where(eq(users.role, 'GDO'));
    const activeUsers = allUsers.filter(u => u.isActive);
    return batchComputeRpgProfiles(activeUsers, false);
}

/**
 * Fetch RPG profiles for ALL gamification roles (GDO + CONFERME).
 */
export async function fetchAllTeamRpgProfiles() {
    const allUsers = await db.select().from(users).where(
        inArray(users.role, ['GDO', 'CONFERME'])
    );
    const activeUsers = allUsers.filter(u => u.isActive);
    return batchComputeRpgProfiles(activeUsers, true);
}

/**
 * Get team gamification overview stats for TL monitor.
 */
export async function getTeamGamificationOverview() {
    const todayScope = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

    // Get all active GDO + CONFERME users
    const teamUsers = await db.select({
        id: users.id,
        displayName: users.displayName,
        name: users.name,
        role: users.role,
        streakCount: users.streakCount,
        level: users.level,
    }).from(users).where(
        and(
            inArray(users.role, ['GDO', 'CONFERME']),
            eq(users.isActive, true)
        )
    );

    // Count quests completed today per user (completed = true AND dateScope = today)
    const questsToday = await db.select({
        userId: questProgress.userId,
        completedCount: sql<number>`COUNT(*)::int`,
    })
        .from(questProgress)
        .where(
            and(
                eq(questProgress.completed, true),
                eq(questProgress.dateScope, todayScope),
                inArray(questProgress.userId, teamUsers.map(u => u.id))
            )
        )
        .groupBy(questProgress.userId);

    const questMap = new Map(questsToday.map(q => [q.userId, q.completedCount]));

    // Calculate stats
    const totalQuestsToday = questsToday.reduce((sum, q) => sum + q.completedCount, 0);
    const avgStreak = teamUsers.length > 0
        ? Math.round(teamUsers.reduce((sum, u) => sum + u.streakCount, 0) / teamUsers.length)
        : 0;

    // Most active: user with most quests completed today
    let mostActiveUser: { name: string; questsToday: number; role: string } | null = null;
    let maxQuests = 0;
    for (const u of teamUsers) {
        const qCount = questMap.get(u.id) || 0;
        if (qCount > maxQuests) {
            maxQuests = qCount;
            mostActiveUser = {
                name: u.displayName || u.name || 'N/A',
                questsToday: qCount,
                role: u.role || 'GDO',
            };
        }
    }

    // Per-user quest count map for the table
    const userQuestsToday: Record<string, number> = {};
    for (const u of teamUsers) {
        userQuestsToday[u.id] = questMap.get(u.id) || 0;
    }

    return {
        totalQuestsToday,
        avgStreak,
        mostActiveUser,
        teamSize: teamUsers.length,
        userQuestsToday,
    };
}

export async function updateGdoBaseSalary(userId: string, newSalary: number) {
    if (newSalary < 0) throw new Error("Salario non valido");
    await db.update(users).set({ baseSalaryEur: newSalary }).where(eq(users.id, userId));
}

export async function addGdoCoins(userId: string, amount: number) {
    const u = await db.select().from(users).where(eq(users.id, userId));
    if (u.length > 0) {
        await db.update(users).set({ walletCoins: sql`${users.walletCoins} + ${amount}` }).where(eq(users.id, userId));
        // Log the transaction
        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount,
            reason: `Bonus manuale dal TL`,
        });
    }
}

export async function updateVenditoreSalesTarget(userId: string, salesTargetEur: number) {
    if (salesTargetEur < 0) throw new Error("Target non valido");
    await db.update(users).set({ salesTargetEur }).where(eq(users.id, userId));
}

export async function getVenditoriWithTargets() {
    const venditori = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        email: users.email,
        isActive: users.isActive,
        salesTargetEur: users.salesTargetEur,
    }).from(users).where(eq(users.role, 'VENDITORE'));
    return venditori.filter(v => v.isActive);
}
