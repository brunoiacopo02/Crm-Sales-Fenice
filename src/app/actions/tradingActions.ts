'use server';

import { db } from "@/db";
import { tradingOffers, userCreatures, creatures, users } from "@/db/schema";
import { eq, and, or, ne, desc } from "drizzle-orm";

/**
 * Create a trade offer between two GDO users.
 * Leggendarie and equipped creatures are NOT tradable.
 */
export async function createTradeOffer(fromUserId: string, toUserId: string, offeredCreatureId: string, requestedCreatureId: string) {
    try {
        // Validate offered creature belongs to sender and is tradable
        const [offered] = await db
            .select({
                id: userCreatures.id,
                isEquipped: userCreatures.isEquipped,
                rarity: creatures.rarity,
            })
            .from(userCreatures)
            .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
            .where(and(eq(userCreatures.id, offeredCreatureId), eq(userCreatures.userId, fromUserId)));

        if (!offered) return { success: false, error: 'Creatura offerta non trovata nel tuo inventario' };
        if (offered.isEquipped) return { success: false, error: 'Non puoi scambiare una creatura equipaggiata' };
        if (offered.rarity === 'legendary') return { success: false, error: 'Le creature leggendarie non sono scambiabili' };

        // Validate requested creature belongs to recipient and is tradable
        const [requested] = await db
            .select({
                id: userCreatures.id,
                isEquipped: userCreatures.isEquipped,
                rarity: creatures.rarity,
            })
            .from(userCreatures)
            .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
            .where(and(eq(userCreatures.id, requestedCreatureId), eq(userCreatures.userId, toUserId)));

        if (!requested) return { success: false, error: 'Creatura richiesta non trovata nell\'inventario del destinatario' };
        if (requested.isEquipped) return { success: false, error: 'La creatura richiesta e equipaggiata' };
        if (requested.rarity === 'legendary') return { success: false, error: 'Le creature leggendarie non sono scambiabili' };

        // Create offer
        const offer = {
            id: crypto.randomUUID(),
            fromUserId,
            toUserId,
            offeredCreatureId,
            requestedCreatureId,
            status: 'pending',
            createdAt: new Date(),
        };

        await db.insert(tradingOffers).values(offer);

        return { success: true, offerId: offer.id };
    } catch (error) {
        console.error("Errore createTradeOffer:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Accept a trade offer — swap creature ownership.
 */
export async function acceptTradeOffer(offerId: string, acceptingUserId: string) {
    try {
        const result = await db.transaction(async (tx) => {
            const [offer] = await tx.select().from(tradingOffers)
                .where(and(eq(tradingOffers.id, offerId), eq(tradingOffers.toUserId, acceptingUserId), eq(tradingOffers.status, 'pending')));

            if (!offer) return { success: false, error: 'Offerta non trovata o non piu valida' };

            // Swap ownership: offered creature goes to recipient, requested goes to sender
            await tx.update(userCreatures)
                .set({ userId: offer.toUserId })
                .where(eq(userCreatures.id, offer.offeredCreatureId));

            await tx.update(userCreatures)
                .set({ userId: offer.fromUserId })
                .where(eq(userCreatures.id, offer.requestedCreatureId));

            // Mark offer as accepted
            await tx.update(tradingOffers)
                .set({ status: 'accepted' })
                .where(eq(tradingOffers.id, offerId));

            return { success: true, fromUserId: offer.fromUserId, toUserId: offer.toUserId };
        });

        // Check achievements for both users
        if (result && 'fromUserId' in result && result.success) {
            try {
                const { checkAchievements } = await import('./achievementActions');
                checkAchievements(result.fromUserId as string).catch(e => console.error("Achievement check trade err:", e));
                checkAchievements(result.toUserId as string).catch(e => console.error("Achievement check trade err:", e));
            } catch { /* ignore */ }
        }

        return result;
    } catch (error) {
        console.error("Errore acceptTradeOffer:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Reject a trade offer.
 */
export async function rejectTradeOffer(offerId: string, rejectingUserId: string) {
    try {
        const [offer] = await db.select().from(tradingOffers)
            .where(and(eq(tradingOffers.id, offerId), eq(tradingOffers.toUserId, rejectingUserId), eq(tradingOffers.status, 'pending')));

        if (!offer) return { success: false, error: 'Offerta non trovata' };

        await db.update(tradingOffers)
            .set({ status: 'rejected' })
            .where(eq(tradingOffers.id, offerId));

        return { success: true };
    } catch (error) {
        console.error("Errore rejectTradeOffer:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get pending trade offers for a user (both sent and received).
 */
export async function getPendingOffers(userId: string) {
    try {
        const offers = await db.select().from(tradingOffers)
            .where(and(
                or(eq(tradingOffers.fromUserId, userId), eq(tradingOffers.toUserId, userId)),
                eq(tradingOffers.status, 'pending')
            ));

        return offers;
    } catch (error) {
        console.error("Errore getPendingOffers:", error);
        return [];
    }
}

/**
 * Get all GDO users except the current one (for trade partner selection).
 */
export async function getGdoUsersForTrading(currentUserId: string) {
    try {
        return await db.select({
            id: users.id,
            name: users.name,
            displayName: users.displayName,
            gdoCode: users.gdoCode,
        }).from(users)
            .where(and(eq(users.role, 'GDO'), eq(users.isActive, true), ne(users.id, currentUserId)));
    } catch (error) {
        console.error("Errore getGdoUsersForTrading:", error);
        return [];
    }
}

/**
 * Get tradable creatures of another user (not equipped, not legendary).
 */
export async function getOtherUserCreatures(userId: string) {
    try {
        return await db.select({
            userCreatureId: userCreatures.id,
            creatureId: userCreatures.creatureId,
            level: userCreatures.level,
            isEquipped: userCreatures.isEquipped,
            name: creatures.name,
            rarity: creatures.rarity,
            element: creatures.element,
            imageUrl: creatures.imageUrl,
        }).from(userCreatures)
            .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
            .where(and(
                eq(userCreatures.userId, userId),
                eq(userCreatures.isEquipped, false),
                ne(creatures.rarity, 'legendary')
            ));
    } catch (error) {
        console.error("Errore getOtherUserCreatures:", error);
        return [];
    }
}

/**
 * Get all offers for a user (all statuses) with creature info.
 */
export async function getAllOffers(userId: string) {
    try {
        const offers = await db.select().from(tradingOffers)
            .where(or(eq(tradingOffers.fromUserId, userId), eq(tradingOffers.toUserId, userId)))
            .orderBy(desc(tradingOffers.createdAt));

        // Enrich with creature and user info
        const enriched = await Promise.all(offers.map(async (offer) => {
            const [offeredUC] = await db.select({
                name: creatures.name, rarity: creatures.rarity, element: creatures.element, level: userCreatures.level,
            }).from(userCreatures)
                .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
                .where(eq(userCreatures.id, offer.offeredCreatureId));

            const [requestedUC] = await db.select({
                name: creatures.name, rarity: creatures.rarity, element: creatures.element, level: userCreatures.level,
            }).from(userCreatures)
                .innerJoin(creatures, eq(userCreatures.creatureId, creatures.id))
                .where(eq(userCreatures.id, offer.requestedCreatureId));

            const [fromUser] = await db.select({ name: users.name, displayName: users.displayName })
                .from(users).where(eq(users.id, offer.fromUserId));
            const [toUser] = await db.select({ name: users.name, displayName: users.displayName })
                .from(users).where(eq(users.id, offer.toUserId));

            return {
                ...offer,
                offeredCreature: offeredUC || null,
                requestedCreature: requestedUC || null,
                fromUserName: fromUser?.displayName || fromUser?.name || 'Sconosciuto',
                toUserName: toUser?.displayName || toUser?.name || 'Sconosciuto',
            };
        }));

        return enriched;
    } catch (error) {
        console.error("Errore getAllOffers:", error);
        return [];
    }
}
