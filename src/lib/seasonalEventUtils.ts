import { db } from '@/db';
import { seasonalEvents } from '@/db/schema';
import { and, eq, lte, gte } from 'drizzle-orm';

/**
 * Returns the active seasonal event multipliers.
 * If no event is active, returns { xp: 1, coins: 1 } (no effect).
 * This is a pure async function (not a server action) so it can be imported from anywhere.
 */
export async function getActiveEventMultipliers(): Promise<{ xp: number; coins: number; eventTitle?: string }> {
    try {
        const now = new Date();
        const rows = await db.select({
            xpMultiplier: seasonalEvents.xpMultiplier,
            coinsMultiplier: seasonalEvents.coinsMultiplier,
            title: seasonalEvents.title,
        })
            .from(seasonalEvents)
            .where(and(
                eq(seasonalEvents.isActive, true),
                lte(seasonalEvents.startDate, now),
                gte(seasonalEvents.endDate, now)
            ))
            .limit(1);

        if (rows.length === 0) return { xp: 1, coins: 1 };

        return {
            xp: rows[0].xpMultiplier,
            coins: rows[0].coinsMultiplier,
            eventTitle: rows[0].title,
        };
    } catch (error) {
        console.error('Error getActiveEventMultipliers:', error);
        return { xp: 1, coins: 1 };
    }
}
