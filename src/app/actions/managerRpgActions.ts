'use server';

import { db } from "@/db";
import { users, questProgress, quests, coinTransactions } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getGdoRpgProfile } from "@/app/actions/rpgProfileActions";

export async function fetchAllGdoRpgProfiles() {
    const allUsers = await db.select().from(users).where(eq(users.role, 'GDO'));
    const results = [];

    for (const u of allUsers) {
        if (!u.isActive) continue;
        try {
            const profile = await getGdoRpgProfile(u.id);
            results.push(profile);
        } catch (e) {
            console.error(`Errore fetch profilo RPG per ${u.id}:`, e);
        }
    }

    return results.sort((a, b) => b.level - a.level);
}

/**
 * Fetch RPG profiles for ALL gamification roles (GDO + CONFERME).
 */
export async function fetchAllTeamRpgProfiles() {
    const allUsers = await db.select().from(users).where(
        inArray(users.role, ['GDO', 'CONFERME'])
    );
    const results = [];

    for (const u of allUsers) {
        if (!u.isActive) continue;
        try {
            const profile = await getGdoRpgProfile(u.id);
            results.push({ ...profile, role: u.role });
        } catch (e) {
            console.error(`Errore fetch profilo RPG per ${u.id}:`, e);
        }
    }

    return results.sort((a, b) => b.level - a.level);
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
