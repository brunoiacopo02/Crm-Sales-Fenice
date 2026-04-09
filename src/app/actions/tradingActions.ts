'use server';

import { db } from "@/db";
import { tradingOffers, userCreatures, creatures } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";

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
        return await db.transaction(async (tx) => {
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

            return { success: true };
        });
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
