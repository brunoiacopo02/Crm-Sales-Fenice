'use server';

import { db } from "@/db";
import { users, lootDrops } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { UNLOCKABLE_TITLES, GAME_CONSTANTS } from "@/lib/gamificationEngine";
import { measureAchievementMetric } from "@/app/actions/achievementActions";

export type UnlockedTitle = {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    unlocked: boolean;
    source: 'stat' | 'legendary';
};

/**
 * Get all titles with unlock status for a user.
 * Combines stat-based titles (UNLOCKABLE_TITLES) with legendary loot drop titles.
 */
export async function getUnlockedTitles(userId: string): Promise<{
    titles: UnlockedTitle[];
    activeTitle: string | null;
}> {
    try {
        // Get user's active title
        const userRow = (await db.select({ activeTitle: users.activeTitle })
            .from(users)
            .where(eq(users.id, userId)))[0];

        // Measure each unique metric once
        const uniqueMetrics = [...new Set(UNLOCKABLE_TITLES.map(t => t.metric))];
        const metricValues = new Map<string, number>();
        for (const metric of uniqueMetrics) {
            metricValues.set(metric, await measureAchievementMetric(userId, metric));
        }

        // Check stat-based titles
        const statTitles: UnlockedTitle[] = UNLOCKABLE_TITLES.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            icon: t.icon,
            category: t.category,
            unlocked: (metricValues.get(t.metric) || 0) >= t.requiredValue,
            source: 'stat' as const,
        }));

        // Check legendary loot drop titles (opened ones with bonusTitle)
        const legendaryDrops = await db.select({
            bonusTitle: lootDrops.bonusTitle,
        })
            .from(lootDrops)
            .where(and(
                eq(lootDrops.userId, userId),
                eq(lootDrops.opened, true),
            ));

        const legendaryTitles: UnlockedTitle[] = legendaryDrops
            .filter(d => d.bonusTitle)
            .map(d => ({
                id: `legendary_${d.bonusTitle!.replace(/\s+/g, '_').toLowerCase()}`,
                name: d.bonusTitle!,
                description: 'Titolo leggendario da Loot Drop',
                icon: 'Gem',
                category: 'legendary',
                unlocked: true,
                source: 'legendary' as const,
            }));

        // Deduplicate legendary titles (same title could drop multiple times)
        const seenLegendary = new Set<string>();
        const uniqueLegendary = legendaryTitles.filter(t => {
            if (seenLegendary.has(t.name)) return false;
            seenLegendary.add(t.name);
            return true;
        });

        return {
            titles: [...statTitles, ...uniqueLegendary],
            activeTitle: userRow?.activeTitle || null,
        };
    } catch (error) {
        console.error("Errore getUnlockedTitles:", error);
        return { titles: [], activeTitle: null };
    }
}

/**
 * Set the user's active title. Must be an unlocked title or null to unequip.
 */
export async function setActiveTitle(userId: string, titleName: string | null): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        if (titleName === null) {
            // Unequip title
            await db.update(users).set({ activeTitle: null }).where(eq(users.id, userId));
            return { success: true };
        }

        // Verify the title is unlocked
        const { titles } = await getUnlockedTitles(userId);
        const title = titles.find(t => t.name === titleName);

        if (!title || !title.unlocked) {
            return { success: false, error: 'Titolo non sbloccato' };
        }

        await db.update(users).set({ activeTitle: titleName }).where(eq(users.id, userId));
        return { success: true };
    } catch (error) {
        console.error("Errore setActiveTitle:", error);
        return { success: false, error: String(error) };
    }
}
