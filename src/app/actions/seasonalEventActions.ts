'use server';

import { db } from '@/db';
import { seasonalEvents } from '@/db/schema';
import { and, eq, lte, gte } from 'drizzle-orm';

/**
 * Get the currently active seasonal event (if any).
 * An event is active if: isActive = true AND now is between startDate and endDate.
 */
export async function getActiveEvent(): Promise<{
    id: string;
    title: string;
    description: string;
    theme: string;
    startDate: Date;
    endDate: Date;
    xpMultiplier: number;
    coinsMultiplier: number;
} | null> {
    try {
        const now = new Date();
        const rows = await db.select()
            .from(seasonalEvents)
            .where(and(
                eq(seasonalEvents.isActive, true),
                lte(seasonalEvents.startDate, now),
                gte(seasonalEvents.endDate, now)
            ))
            .limit(1);

        if (rows.length === 0) return null;

        const event = rows[0];
        return {
            id: event.id,
            title: event.title,
            description: event.description,
            theme: event.theme,
            startDate: event.startDate,
            endDate: event.endDate,
            xpMultiplier: event.xpMultiplier,
            coinsMultiplier: event.coinsMultiplier,
        };
    } catch (error) {
        console.error('Error getActiveEvent:', error);
        return null;
    }
}

/**
 * Create a new seasonal event (Manager only).
 */
export async function createSeasonalEvent(params: {
    title: string;
    description: string;
    theme: string;
    startDate: string; // ISO string
    endDate: string; // ISO string
    xpMultiplier: number;
    coinsMultiplier: number;
    createdBy: string;
}): Promise<{ success: boolean; error?: string; eventId?: string }> {
    try {
        const eventId = crypto.randomUUID();

        await db.insert(seasonalEvents).values({
            id: eventId,
            title: params.title,
            description: params.description,
            theme: params.theme,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            xpMultiplier: params.xpMultiplier,
            coinsMultiplier: params.coinsMultiplier,
            createdBy: params.createdBy,
        });

        return { success: true, eventId };
    } catch (error) {
        console.error('Error createSeasonalEvent:', error);
        return { success: false, error: String(error) };
    }
}

/**
 * Deactivate a seasonal event (Manager only).
 */
export async function deactivateSeasonalEvent(eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await db.update(seasonalEvents)
            .set({ isActive: false })
            .where(eq(seasonalEvents.id, eventId));

        return { success: true };
    } catch (error) {
        console.error('Error deactivateSeasonalEvent:', error);
        return { success: false, error: String(error) };
    }
}
