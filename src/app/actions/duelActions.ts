'use server';

import { db } from "@/db";
import { duels, users, coinTransactions } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";

/**
 * Create a duel between two GDO users. Only TL/Manager can create duels.
 */
export async function createDuel(
    challengerId: string,
    opponentId: string,
    metric: string, // 'fissaggi' | 'chiamate'
    durationMinutes: number,
    rewardCoins: number,
    creatorRole: string
) {
    try {
        if (creatorRole !== 'MANAGER' && creatorRole !== 'ADMIN' && creatorRole !== 'TL') {
            return { success: false, error: 'Solo TL/Manager possono creare duelli' };
        }

        if (challengerId === opponentId) {
            return { success: false, error: 'Non puoi sfidare te stesso' };
        }

        const now = new Date();
        const endTime = new Date(now.getTime() + durationMinutes * 60 * 1000);

        const duel = {
            id: crypto.randomUUID(),
            challengerId,
            opponentId,
            metric,
            duration: durationMinutes,
            startTime: now,
            endTime,
            challengerScore: 0,
            opponentScore: 0,
            winnerId: null,
            rewardCoins,
            status: 'active',
        };

        await db.insert(duels).values(duel);

        return { success: true, duelId: duel.id };
    } catch (error) {
        console.error("Errore createDuel:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get status of a duel.
 */
export async function getDuelStatus(duelId: string) {
    try {
        const [duel] = await db.select().from(duels)
            .where(eq(duels.id, duelId));
        if (!duel) return null;

        // Auto-complete if expired
        if (duel.status === 'active' && new Date() > duel.endTime) {
            return completeDuel(duelId);
        }

        return duel;
    } catch (error) {
        console.error("Errore getDuelStatus:", error);
        return null;
    }
}

/**
 * Increment a duel score for a participant.
 */
export async function incrementDuelScore(userId: string, metric: string, amount: number = 1) {
    try {
        // Find active duels for this user matching the metric
        const activeDuels = await db.select().from(duels)
            .where(and(eq(duels.status, 'active'), eq(duels.metric, metric)));

        for (const duel of activeDuels) {
            if (new Date() > duel.endTime) {
                await completeDuel(duel.id);
                continue;
            }

            if (duel.challengerId === userId) {
                await db.update(duels)
                    .set({ challengerScore: duel.challengerScore + amount })
                    .where(eq(duels.id, duel.id));
            } else if (duel.opponentId === userId) {
                await db.update(duels)
                    .set({ opponentScore: duel.opponentScore + amount })
                    .where(eq(duels.id, duel.id));
            }
        }
    } catch (error) {
        console.error("Errore incrementDuelScore:", error);
    }
}

/**
 * Complete a duel — determine winner and award coins.
 */
export async function completeDuel(duelId: string) {
    try {
        return await db.transaction(async (tx) => {
            const [duel] = await tx.select().from(duels)
                .where(eq(duels.id, duelId));
            if (!duel || duel.status === 'completed') return duel;

            let winnerId: string | null = null;
            if (duel.challengerScore > duel.opponentScore) {
                winnerId = duel.challengerId;
            } else if (duel.opponentScore > duel.challengerScore) {
                winnerId = duel.opponentId;
            }
            // If tie, no winner (no reward)

            await tx.update(duels)
                .set({ status: 'completed', winnerId })
                .where(eq(duels.id, duelId));

            // Award coins to winner
            if (winnerId && duel.rewardCoins > 0) {
                const [winner] = await tx.select({ walletCoins: users.walletCoins }).from(users)
                    .where(eq(users.id, winnerId));
                if (winner) {
                    await tx.update(users)
                        .set({ walletCoins: winner.walletCoins + duel.rewardCoins })
                        .where(eq(users.id, winnerId));

                    await tx.insert(coinTransactions).values({
                        id: crypto.randomUUID(),
                        userId: winnerId,
                        amount: duel.rewardCoins,
                        reason: `Duello vinto (${duel.metric})`,
                    });
                }
            }

            return { ...duel, status: 'completed' as const, winnerId };
        });
    } catch (error) {
        console.error("Errore completeDuel:", error);
        return null;
    }
}

/**
 * Get all active duels.
 */
export async function getActiveDuels() {
    try {
        return await db.select().from(duels)
            .where(eq(duels.status, 'active'));
    } catch (error) {
        console.error("Errore getActiveDuels:", error);
        return [];
    }
}

/**
 * Get active duels for a specific user with enriched data.
 */
export async function getActiveDuelsForUser(userId: string) {
    try {
        const activeDuels = await db.select().from(duels)
            .where(and(
                eq(duels.status, 'active'),
                or(eq(duels.challengerId, userId), eq(duels.opponentId, userId))
            ));

        // Auto-complete expired and enrich with names
        const enriched = await Promise.all(activeDuels.map(async (duel) => {
            if (new Date() > duel.endTime) {
                await completeDuel(duel.id);
                return null;
            }
            const [challenger] = await db.select({ name: users.name, displayName: users.displayName })
                .from(users).where(eq(users.id, duel.challengerId));
            const [opponent] = await db.select({ name: users.name, displayName: users.displayName })
                .from(users).where(eq(users.id, duel.opponentId));

            return {
                ...duel,
                challengerName: challenger?.displayName || challenger?.name || 'GDO',
                opponentName: opponent?.displayName || opponent?.name || 'GDO',
            };
        }));

        return enriched.filter(Boolean);
    } catch (error) {
        console.error("Errore getActiveDuelsForUser:", error);
        return [];
    }
}
