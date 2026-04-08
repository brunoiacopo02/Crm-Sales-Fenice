'use server';

import { db } from "@/db";
import { users, coinTransactions, userAchievements, achievements, questProgress, quests, lootDrops, leadEvents } from "@/db/schema";
import { eq, desc, sql, and, isNotNull } from "drizzle-orm";

export type ActivityFeedItem = {
    id: string;
    type: 'appointment_set' | 'achievement_unlocked' | 'quest_completed' | 'loot_drop' | 'level_up' | 'coins_earned' | 'call_made' | 'deal_closed';
    userName: string;
    userDisplayName: string | null;
    avatarUrl: string | null;
    description: string;
    detail: string | null;
    timestamp: Date;
    color: 'orange' | 'ember' | 'gold' | 'ash';
};

/**
 * Aggregates recent activity from multiple tables into a unified feed.
 * Returns the last 50 events across all gamification/CRM activity.
 */
export async function getActivityFeed(): Promise<ActivityFeedItem[]> {
    const items: ActivityFeedItem[] = [];

    // 1. Recent lead events (appointments set, calls made)
    const recentLeadEvents = await db
        .select({
            id: leadEvents.id,
            eventType: leadEvents.eventType,
            timestamp: leadEvents.timestamp,
            userName: users.name,
            userDisplayName: users.displayName,
            avatarUrl: users.avatarUrl,
        })
        .from(leadEvents)
        .leftJoin(users, eq(leadEvents.userId, users.id))
        .where(isNotNull(leadEvents.userId))
        .orderBy(desc(leadEvents.timestamp))
        .limit(20);

    for (const ev of recentLeadEvents) {
        const eventMap: Record<string, { type: ActivityFeedItem['type']; desc: string; color: ActivityFeedItem['color'] }> = {
            'appointment_set': { type: 'appointment_set', desc: 'ha fissato un appuntamento', color: 'orange' },
            'call_made': { type: 'call_made', desc: 'ha effettuato una chiamata', color: 'ash' },
            'outcome_set': { type: 'deal_closed', desc: 'ha chiuso un deal', color: 'gold' },
            'confirmed': { type: 'appointment_set', desc: 'ha confermato un appuntamento', color: 'orange' },
            'status_change': { type: 'call_made', desc: 'ha aggiornato un lead', color: 'ash' },
        };
        const mapped = eventMap[ev.eventType] ?? { type: 'call_made' as const, desc: `ha registrato: ${ev.eventType}`, color: 'ash' as const };
        items.push({
            id: ev.id,
            type: mapped.type,
            userName: ev.userName ?? 'Utente',
            userDisplayName: ev.userDisplayName,
            avatarUrl: ev.avatarUrl,
            description: mapped.desc,
            detail: null,
            timestamp: ev.timestamp,
            color: mapped.color,
        });
    }

    // 2. Recent achievements unlocked
    const recentAchievements = await db
        .select({
            id: userAchievements.id,
            tier: userAchievements.tier,
            unlockedAt: userAchievements.unlockedAt,
            achievementName: achievements.name,
            achievementIcon: achievements.icon,
            userName: users.name,
            userDisplayName: users.displayName,
            avatarUrl: users.avatarUrl,
        })
        .from(userAchievements)
        .innerJoin(achievements, eq(userAchievements.achievementId, achievements.id))
        .innerJoin(users, eq(userAchievements.userId, users.id))
        .orderBy(desc(userAchievements.unlockedAt))
        .limit(10);

    const tierLabel = (t: number) => t === 3 ? 'Oro' : t === 2 ? 'Argento' : 'Bronzo';
    for (const a of recentAchievements) {
        items.push({
            id: a.id,
            type: 'achievement_unlocked',
            userName: a.userName ?? 'Utente',
            userDisplayName: a.userDisplayName,
            avatarUrl: a.avatarUrl,
            description: `ha sbloccato "${a.achievementName}"`,
            detail: `Tier ${tierLabel(a.tier)}`,
            timestamp: a.unlockedAt,
            color: a.tier === 3 ? 'gold' : a.tier === 2 ? 'ash' : 'orange',
        });
    }

    // 3. Recent quest completions
    const recentQuests = await db
        .select({
            id: questProgress.id,
            completedAt: questProgress.completedAt,
            questTitle: quests.title,
            questRewardXp: quests.rewardXp,
            questRewardCoins: quests.rewardCoins,
            userName: users.name,
            userDisplayName: users.displayName,
            avatarUrl: users.avatarUrl,
        })
        .from(questProgress)
        .innerJoin(quests, eq(questProgress.questId, quests.id))
        .innerJoin(users, eq(questProgress.userId, users.id))
        .where(eq(questProgress.completed, true))
        .orderBy(desc(questProgress.completedAt))
        .limit(10);

    for (const q of recentQuests) {
        items.push({
            id: q.id,
            type: 'quest_completed',
            userName: q.userName ?? 'Utente',
            userDisplayName: q.userDisplayName,
            avatarUrl: q.avatarUrl,
            description: `ha completato "${q.questTitle}"`,
            detail: `+${q.questRewardXp} XP, +${q.questRewardCoins} coins`,
            timestamp: q.completedAt!,
            color: 'ember',
        });
    }

    // 4. Recent loot drops (opened)
    const recentLoot = await db
        .select({
            id: lootDrops.id,
            rarity: lootDrops.rarity,
            rewardValue: lootDrops.rewardValue,
            bonusXp: lootDrops.bonusXp,
            bonusTitle: lootDrops.bonusTitle,
            droppedAt: lootDrops.droppedAt,
            userName: users.name,
            userDisplayName: users.displayName,
            avatarUrl: users.avatarUrl,
        })
        .from(lootDrops)
        .innerJoin(users, eq(lootDrops.userId, users.id))
        .where(eq(lootDrops.opened, true))
        .orderBy(desc(lootDrops.droppedAt))
        .limit(10);

    const rarityLabel: Record<string, string> = { common: 'Comune', rare: 'Raro', epic: 'Epico', legendary: 'Leggendario' };
    for (const l of recentLoot) {
        items.push({
            id: l.id,
            type: 'loot_drop',
            userName: l.userName ?? 'Utente',
            userDisplayName: l.userDisplayName,
            avatarUrl: l.avatarUrl,
            description: `ha aperto un loot ${rarityLabel[l.rarity] ?? l.rarity}`,
            detail: `+${l.rewardValue} coins${l.bonusXp ? ` +${l.bonusXp} XP` : ''}${l.bonusTitle ? ` "${l.bonusTitle}"` : ''}`,
            timestamp: l.droppedAt,
            color: l.rarity === 'legendary' ? 'gold' : l.rarity === 'epic' ? 'ember' : 'orange',
        });
    }

    // Sort all items by timestamp desc and take top 50
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, 50);
}
