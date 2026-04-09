'use server';

import { db } from '@/db';
import { bossBattles, bossContributions, users, coinTransactions, notifications } from '@/db/schema';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { GAME_CONSTANTS } from '@/lib/gamificationEngine';
import { getActiveEventMultipliers } from '@/lib/seasonalEventUtils';

/**
 * Create a new boss battle (Manager only).
 */
export async function createBossBattle(params: {
    title: string;
    description: string;
    totalHp: number;
    rewardCoins: number;
    rewardXp: number;
    startTime: Date;
    endTime: Date;
    createdBy: string;
}) {
    try {
        const id = crypto.randomUUID();
        await db.insert(bossBattles).values({
            id,
            title: params.title,
            description: params.description,
            totalHp: params.totalHp,
            currentHp: params.totalHp,
            rewardCoins: params.rewardCoins,
            rewardXp: params.rewardXp,
            startTime: params.startTime,
            endTime: params.endTime,
            status: 'active',
            createdBy: params.createdBy,
        });
        return { success: true, id };
    } catch (error: any) {
        console.error('Error creating boss battle:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get the currently active boss battle (if any).
 */
export async function getActiveBossBattle() {
    try {
        const now = new Date();
        const battles = await db.select()
            .from(bossBattles)
            .where(eq(bossBattles.status, 'active'))
            .orderBy(desc(bossBattles.startTime))
            .limit(1);

        if (battles.length === 0) return null;

        const battle = battles[0];

        // Check if expired
        if (now > battle.endTime) {
            await db.update(bossBattles)
                .set({ status: 'expired' })
                .where(eq(bossBattles.id, battle.id));
            return null;
        }

        // Get top contributors
        const contributors = await db.select({
            userId: bossContributions.userId,
            totalDamage: sql<number>`SUM(${bossContributions.damage})::int`,
            userName: users.name,
            displayName: users.displayName,
        })
            .from(bossContributions)
            .innerJoin(users, eq(bossContributions.userId, users.id))
            .where(eq(bossContributions.battleId, battle.id))
            .groupBy(bossContributions.userId, users.name, users.displayName)
            .orderBy(sql`SUM(${bossContributions.damage}) DESC`)
            .limit(5);

        const totalContributors = await db.select({
            count: sql<number>`COUNT(DISTINCT ${bossContributions.userId})::int`,
        })
            .from(bossContributions)
            .where(eq(bossContributions.battleId, battle.id));

        return {
            ...battle,
            topContributors: contributors.map(c => ({
                userId: c.userId,
                name: c.displayName || c.userName || 'GDO',
                totalDamage: c.totalDamage,
            })),
            totalContributors: totalContributors[0]?.count || 0,
        };
    } catch (error) {
        console.error('Error getting active boss battle:', error);
        return null;
    }
}

/**
 * Contribute damage to the active boss battle.
 * Called after each appointment set by a GDO.
 */
export async function contributeToBoss(userId: string) {
    try {
        // Find active battle
        const battles = await db.select()
            .from(bossBattles)
            .where(eq(bossBattles.status, 'active'))
            .orderBy(desc(bossBattles.startTime))
            .limit(1);

        if (battles.length === 0) return { success: false, noBattle: true };

        const battle = battles[0];
        const now = new Date();

        // Check if expired
        if (now > battle.endTime) {
            await db.update(bossBattles)
                .set({ status: 'expired' })
                .where(eq(bossBattles.id, battle.id));
            return { success: false, expired: true };
        }

        const damage = GAME_CONSTANTS.BOSS_BATTLE.DAMAGE_PER_APPOINTMENT;

        // Record contribution
        await db.insert(bossContributions).values({
            id: crypto.randomUUID(),
            battleId: battle.id,
            userId,
            damage,
            action: 'appointment_set',
        });

        // Reduce HP
        const newHp = Math.max(0, battle.currentHp - damage);
        await db.update(bossBattles)
            .set({ currentHp: newHp })
            .where(eq(bossBattles.id, battle.id));

        // Check if boss is defeated
        if (newHp <= 0) {
            await defeatBoss(battle.id, battle.rewardCoins, battle.rewardXp);
        }

        return { success: true, damage, newHp, defeated: newHp <= 0 };
    } catch (error: any) {
        console.error('Error contributing to boss:', error);
        return { success: false, error: error.message };
    }
}

/**
 * When boss is defeated, reward all contributing GDOs.
 */
async function defeatBoss(battleId: string, rewardCoins: number, rewardXp: number) {
    try {
        // Mark as defeated
        await db.update(bossBattles)
            .set({ status: 'defeated', defeatedAt: new Date() })
            .where(eq(bossBattles.id, battleId));

        // Get all distinct contributors
        const contributors = await db.select({
            userId: bossContributions.userId,
        })
            .from(bossContributions)
            .where(eq(bossContributions.battleId, battleId))
            .groupBy(bossContributions.userId);

        const battle = (await db.select().from(bossBattles).where(eq(bossBattles.id, battleId)))[0];

        // Apply seasonal event multipliers to boss rewards
        const eventMult = await getActiveEventMultipliers();
        const effectiveCoins = Math.floor(rewardCoins * eventMult.coins);
        const effectiveXp = Math.floor(rewardXp * eventMult.xp);

        // Award coins and XP to all contributors (batch operations)
        const contributorIds = contributors.map(c => c.userId);
        if (contributorIds.length > 0) {
            // Single UPDATE for all contributors
            await db.update(users)
                .set({
                    walletCoins: sql`${users.walletCoins} + ${effectiveCoins}`,
                    experience: sql`${users.experience} + ${effectiveXp}`,
                })
                .where(inArray(users.id, contributorIds));

            const bossReason = eventMult.coins > 1
                ? `Boss sconfitto: ${battle?.title || 'Boss Battle'} (x${eventMult.coins} evento)`
                : `Boss sconfitto: ${battle?.title || 'Boss Battle'}`;

            // Batch INSERT coin transactions
            await db.insert(coinTransactions).values(
                contributorIds.map(uid => ({
                    id: crypto.randomUUID(),
                    userId: uid,
                    amount: effectiveCoins,
                    reason: bossReason,
                }))
            );

            // Batch INSERT notifications
            await db.insert(notifications).values(
                contributorIds.map(uid => ({
                    id: crypto.randomUUID(),
                    recipientUserId: uid,
                    type: 'boss_defeated',
                    title: 'Boss Sconfitto! 🎉',
                    body: `Il team ha sconfitto "${battle?.title}"! Hai guadagnato ${effectiveCoins} coins e ${effectiveXp} XP!`,
                    metadata: { battleId, rewardCoins: effectiveCoins, rewardXp: effectiveXp, bossTitle: battle?.title },
                }))
            );
        }
    } catch (error) {
        console.error('Error defeating boss:', error);
    }
}

/**
 * Get user's contribution to the active boss battle.
 */
export async function getUserBossContribution(userId: string, battleId: string) {
    try {
        const result = await db.select({
            totalDamage: sql<number>`COALESCE(SUM(${bossContributions.damage}), 0)::int`,
            hitCount: sql<number>`COUNT(*)::int`,
        })
            .from(bossContributions)
            .where(and(
                eq(bossContributions.battleId, battleId),
                eq(bossContributions.userId, userId),
            ));

        return {
            totalDamage: result[0]?.totalDamage || 0,
            hitCount: result[0]?.hitCount || 0,
        };
    } catch (error) {
        console.error('Error getting user boss contribution:', error);
        return { totalDamage: 0, hitCount: 0 };
    }
}
