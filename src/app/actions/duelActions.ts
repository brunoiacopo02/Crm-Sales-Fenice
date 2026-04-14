'use server';

import { db } from "@/db";
import { duels, users, coinTransactions, notifications } from "@/db/schema";
import { eq, and, or, desc, count, sql } from "drizzle-orm";

/**
 * Create a duel between two GDO users. Only TL/Manager can create duels.
 *
 * Wager model: `rewardCoins` is the STAKE each participant contributes.
 * Both GDOs pay the stake upfront; the winner takes the full pot (stake × 2).
 * If they tie, each gets their stake back.
 */
export async function createDuel(
    challengerId: string,
    opponentId: string,
    metric: string, // 'fissaggi' | 'chiamate'
    durationMinutes: number,
    rewardCoins: number, // = stake per partecipante
    creatorRole: string
) {
    try {
        if (creatorRole !== 'MANAGER' && creatorRole !== 'ADMIN' && creatorRole !== 'TL') {
            return { success: false, error: 'Solo TL/Manager possono creare duelli' };
        }

        if (challengerId === opponentId) {
            return { success: false, error: 'Non puoi sfidare te stesso' };
        }

        if (rewardCoins <= 0) {
            return { success: false, error: 'La posta deve essere maggiore di zero' };
        }

        const stake = rewardCoins;

        const result = await db.transaction(async (tx) => {
            // Fetch both users and verify they have enough coins
            const participants = await tx.select({
                id: users.id,
                walletCoins: users.walletCoins,
                name: users.name,
                displayName: users.displayName,
            }).from(users).where(or(eq(users.id, challengerId), eq(users.id, opponentId)));

            const challenger = participants.find(u => u.id === challengerId);
            const opponent = participants.find(u => u.id === opponentId);

            if (!challenger || !opponent) {
                throw new Error('Uno dei partecipanti non esiste');
            }
            if (challenger.walletCoins < stake) {
                throw new Error(`${challenger.displayName || challenger.name} non ha abbastanza monete (servono ${stake}, ne ha ${challenger.walletCoins})`);
            }
            if (opponent.walletCoins < stake) {
                throw new Error(`${opponent.displayName || opponent.name} non ha abbastanza monete (servono ${stake}, ne ha ${opponent.walletCoins})`);
            }

            const now = new Date();
            const endTime = new Date(now.getTime() + durationMinutes * 60 * 1000);

            const duelId = crypto.randomUUID();
            const challengerName = challenger.displayName || challenger.name || 'GDO';
            const opponentName = opponent.displayName || opponent.name || 'GDO';

            // Deduct stake from both participants (SQL increment is safe inside tx)
            await tx.update(users)
                .set({ walletCoins: sql`${users.walletCoins} - ${stake}` })
                .where(eq(users.id, challengerId));
            await tx.update(users)
                .set({ walletCoins: sql`${users.walletCoins} - ${stake}` })
                .where(eq(users.id, opponentId));

            // Log both stake transactions
            await tx.insert(coinTransactions).values([
                {
                    id: crypto.randomUUID(),
                    userId: challengerId,
                    amount: -stake,
                    reason: `Duello: scommessa vs ${opponentName}`,
                },
                {
                    id: crypto.randomUUID(),
                    userId: opponentId,
                    amount: -stake,
                    reason: `Duello: scommessa vs ${challengerName}`,
                },
            ]);

            // Create the duel
            await tx.insert(duels).values({
                id: duelId,
                challengerId,
                opponentId,
                metric,
                duration: durationMinutes,
                startTime: now,
                endTime,
                challengerScore: 0,
                opponentScore: 0,
                winnerId: null,
                rewardCoins: stake, // the stake per side; pot = stake * 2
                status: 'active',
            });

            // Notify both participants — triggers the duel start overlay on their dashboard
            const metricLabel = metric === 'fissaggi' ? 'Appuntamenti fissati' : metric === 'chiamate' ? 'Chiamate' : metric;
            const pot = stake * 2;

            await tx.insert(notifications).values([
                {
                    id: crypto.randomUUID(),
                    recipientUserId: challengerId,
                    type: 'duel_started',
                    title: `⚔️ SFIDA LANCIATA: contro ${opponentName}`,
                    body: `Hai puntato ${stake} monete. Chi farà più ${metricLabel.toLowerCase()} in ${durationMinutes} minuti vince ${pot} monete!`,
                    metadata: {
                        duelId,
                        opponentId,
                        opponentName,
                        metric,
                        metricLabel,
                        durationMinutes,
                        stake,
                        pot,
                    },
                },
                {
                    id: crypto.randomUUID(),
                    recipientUserId: opponentId,
                    type: 'duel_started',
                    title: `⚔️ SEI STATO SFIDATO: da ${challengerName}`,
                    body: `Hai puntato ${stake} monete. Chi farà più ${metricLabel.toLowerCase()} in ${durationMinutes} minuti vince ${pot} monete!`,
                    metadata: {
                        duelId,
                        opponentId: challengerId,
                        opponentName: challengerName,
                        metric,
                        metricLabel,
                        durationMinutes,
                        stake,
                        pot,
                    },
                },
            ]);

            return { duelId, stake, pot };
        });

        return { success: true, duelId: result.duelId, stake: result.stake, pot: result.pot };
    } catch (error: any) {
        console.error("Errore createDuel:", error);
        return { success: false, error: error?.message || String(error) };
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
 * Complete a duel — determine winner and pay out the pot.
 *
 * Wager model:
 *   - Both participants paid `stake` at createDuel. Pot = stake * 2.
 *   - Winner: receives the full pot (stake * 2).
 *   - Tie: refund stake to both (they each get their own money back).
 */
export async function completeDuel(duelId: string) {
    try {
        const result = await db.transaction(async (tx) => {
            const [duel] = await tx.select().from(duels)
                .where(eq(duels.id, duelId));
            if (!duel || duel.status === 'completed') return duel;

            let winnerId: string | null = null;
            if (duel.challengerScore > duel.opponentScore) {
                winnerId = duel.challengerId;
            } else if (duel.opponentScore > duel.challengerScore) {
                winnerId = duel.opponentId;
            }

            // Mark the duel completed first (optimistic locking via status prevents double-payout)
            const updated = await tx.update(duels)
                .set({ status: 'completed', winnerId })
                .where(and(eq(duels.id, duelId), eq(duels.status, 'active')))
                .returning({ id: duels.id });

            if (updated.length === 0) {
                // Another concurrent call already completed this duel — skip payout.
                return duel;
            }

            const stake = duel.rewardCoins; // stake per side
            const pot = stake * 2;

            if (winnerId && stake > 0) {
                // Winner takes the full pot
                await tx.update(users)
                    .set({ walletCoins: sql`${users.walletCoins} + ${pot}` })
                    .where(eq(users.id, winnerId));

                await tx.insert(coinTransactions).values({
                    id: crypto.randomUUID(),
                    userId: winnerId,
                    amount: pot,
                    reason: `Duello vinto (${duel.metric}): +${pot} monete`,
                });

                // Notify winner + loser
                const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
                await tx.insert(notifications).values([
                    {
                        id: crypto.randomUUID(),
                        recipientUserId: winnerId,
                        type: 'duel_won',
                        title: '🏆 Duello VINTO!',
                        body: `Hai vinto il duello e incassato ${pot} monete!`,
                        metadata: { duelId, pot, stake },
                    },
                    {
                        id: crypto.randomUUID(),
                        recipientUserId: loserId,
                        type: 'duel_lost',
                        title: '💀 Duello perso',
                        body: `Hai perso il duello. Hai perso ${stake} monete.`,
                        metadata: { duelId, stake },
                    },
                ]);
            } else if (!winnerId && stake > 0) {
                // Tie: refund stake to both participants
                await tx.update(users)
                    .set({ walletCoins: sql`${users.walletCoins} + ${stake}` })
                    .where(eq(users.id, duel.challengerId));
                await tx.update(users)
                    .set({ walletCoins: sql`${users.walletCoins} + ${stake}` })
                    .where(eq(users.id, duel.opponentId));

                await tx.insert(coinTransactions).values([
                    {
                        id: crypto.randomUUID(),
                        userId: duel.challengerId,
                        amount: stake,
                        reason: `Duello pareggio: rimborso scommessa`,
                    },
                    {
                        id: crypto.randomUUID(),
                        userId: duel.opponentId,
                        amount: stake,
                        reason: `Duello pareggio: rimborso scommessa`,
                    },
                ]);

                await tx.insert(notifications).values([
                    {
                        id: crypto.randomUUID(),
                        recipientUserId: duel.challengerId,
                        type: 'duel_tie',
                        title: '🤝 Duello in pareggio',
                        body: `Pareggio! La tua scommessa di ${stake} monete ti è stata restituita.`,
                        metadata: { duelId, stake },
                    },
                    {
                        id: crypto.randomUUID(),
                        recipientUserId: duel.opponentId,
                        type: 'duel_tie',
                        title: '🤝 Duello in pareggio',
                        body: `Pareggio! La tua scommessa di ${stake} monete ti è stata restituita.`,
                        metadata: { duelId, stake },
                    },
                ]);
            }

            return { ...duel, status: 'completed' as const, winnerId };
        });

        // Check achievements for winner (outside tx to not block it)
        if (result && 'winnerId' in result && result.winnerId) {
            try {
                const { checkAchievements } = await import('./achievementActions');
                checkAchievements(result.winnerId).catch(e => console.error("Achievement check duel err:", e));
            } catch { /* ignore */ }
        }

        return result;
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

/**
 * Get completed duel history for a user (last 20).
 */
export async function getDuelHistory(userId: string) {
    try {
        const completedDuels = await db.select().from(duels)
            .where(and(
                eq(duels.status, 'completed'),
                or(eq(duels.challengerId, userId), eq(duels.opponentId, userId))
            ))
            .orderBy(desc(duels.endTime))
            .limit(20);

        // Enrich with names
        const enriched = await Promise.all(completedDuels.map(async (duel) => {
            const isChallenger = duel.challengerId === userId;
            const opponentId = isChallenger ? duel.opponentId : duel.challengerId;
            const [opponent] = await db.select({ name: users.name, displayName: users.displayName })
                .from(users).where(eq(users.id, opponentId));

            const myScore = isChallenger ? duel.challengerScore : duel.opponentScore;
            const theirScore = isChallenger ? duel.opponentScore : duel.challengerScore;
            const result = duel.winnerId === userId ? 'VINTO' : duel.winnerId === null ? 'PARI' : 'PERSO';

            return {
                id: duel.id,
                opponentName: opponent?.displayName || opponent?.name || 'GDO',
                metric: duel.metric,
                myScore,
                theirScore,
                result,
                rewardCoins: duel.rewardCoins,
                endTime: duel.endTime,
            };
        }));

        // Stats
        const totalDuels = enriched.length;
        const wins = enriched.filter(d => d.result === 'VINTO').length;
        const losses = enriched.filter(d => d.result === 'PERSO').length;
        const winRate = totalDuels > 0 ? Math.round((wins / totalDuels) * 100) : 0;

        return { duels: enriched, stats: { totalDuels, wins, losses, winRate } };
    } catch (error) {
        console.error("Errore getDuelHistory:", error);
        return { duels: [], stats: { totalDuels: 0, wins: 0, losses: 0, winRate: 0 } };
    }
}
