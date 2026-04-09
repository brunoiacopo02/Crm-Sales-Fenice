'use server';

import { db } from "@/db";
import { teamRpgProfile, teamCreatures, adventureBosses, creatures, users, coinTransactions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { dropCreature } from "./creatureActions";
import { createClient } from "@/utils/supabase/server";

const TEAM_ID = 'team-conferme';

// XP needed per team level (grows faster than individual)
function teamLevelXp(level: number): number {
    return Math.floor(200 + 30 * level + level * level * 2);
}

// Boss damage values
const DAMAGE_MAP: Record<string, number> = {
    conferma: 30,
    presenza: 40,
    chiusura: 100,
};

/**
 * Get or create the single team RPG profile for Conferme.
 */
export async function getOrCreateTeamProfile() {
    try {
        let [profile] = await db.select().from(teamRpgProfile)
            .where(eq(teamRpgProfile.id, TEAM_ID));

        if (!profile) {
            const newProfile = {
                id: TEAM_ID,
                teamName: 'Team Conferme',
                level: 1,
                totalXp: 0,
                currentStage: 1,
                currentBossHp: null,
                createdAt: new Date(),
            };
            await db.insert(teamRpgProfile).values(newProfile);
            profile = newProfile as typeof profile;
        }

        // Check if current stage is a boss stage
        let activeBoss = null;
        if (profile.currentStage % 10 === 0) {
            const [boss] = await db.select().from(adventureBosses)
                .where(eq(adventureBosses.stageNumber, profile.currentStage));
            if (boss) {
                activeBoss = {
                    ...boss,
                    currentHp: profile.currentBossHp ?? boss.totalHp,
                };
            }
        }

        return {
            ...profile,
            activeBoss,
            xpForNextLevel: teamLevelXp(profile.level),
        };
    } catch (error) {
        console.error("Errore getOrCreateTeamProfile:", error);
        return null;
    }
}

/**
 * Contribute XP to the team. Handles level-ups.
 */
export async function contributeToTeam(confermeUserId: string, xpAmount: number) {
    try {
        const profile = await getOrCreateTeamProfile();
        if (!profile) return null;

        let newXp = profile.totalXp + xpAmount;
        let newLevel = profile.level;
        let targetXp = teamLevelXp(newLevel);

        // Handle level ups
        let didLevelUp = false;
        while (newXp >= targetXp) {
            newXp -= targetXp;
            newLevel++;
            didLevelUp = true;
            targetXp = teamLevelXp(newLevel);
        }

        await db.update(teamRpgProfile)
            .set({ totalXp: newXp, level: newLevel })
            .where(eq(teamRpgProfile.id, TEAM_ID));

        return { newLevel, newXp, didLevelUp };
    } catch (error) {
        console.error("Errore contributeToTeam:", error);
        return null;
    }
}

/**
 * Drop a creature to the team deck. Tracks which user contributed it.
 */
export async function teamDropCreature(confermeUserId: string) {
    try {
        // Random rarity (same weights as individual)
        const rarityRoll = Math.random() * 100;
        let rarity = 'common';
        if (rarityRoll >= 97) rarity = 'legendary';
        else if (rarityRoll >= 88) rarity = 'epic';
        else if (rarityRoll >= 60) rarity = 'rare';

        const pool = await db.select().from(creatures)
            .where(and(eq(creatures.rarity, rarity), eq(creatures.isActive, true)));

        if (pool.length === 0) return null;

        const picked = pool[Math.floor(Math.random() * pool.length)];

        const teamCreature = {
            id: crypto.randomUUID(),
            teamId: TEAM_ID,
            creatureId: picked.id,
            level: 1,
            xpFed: 0,
            isEquipped: false,
            obtainedAt: new Date(),
            contributedByUserId: confermeUserId,
        };

        await db.insert(teamCreatures).values(teamCreature);

        return {
            teamCreatureId: teamCreature.id,
            creature: picked,
            contributedBy: confermeUserId,
        };
    } catch (error) {
        console.error("Errore teamDropCreature:", error);
        return null;
    }
}

/**
 * Get all creatures owned by the team.
 */
export async function getTeamCreatures() {
    try {
        const rows = await db
            .select({
                teamCreatureId: teamCreatures.id,
                creatureId: teamCreatures.creatureId,
                level: teamCreatures.level,
                xpFed: teamCreatures.xpFed,
                isEquipped: teamCreatures.isEquipped,
                obtainedAt: teamCreatures.obtainedAt,
                contributedByUserId: teamCreatures.contributedByUserId,
                name: creatures.name,
                description: creatures.description,
                rarity: creatures.rarity,
                element: creatures.element,
                imageUrl: creatures.imageUrl,
                baseXpBonus: creatures.baseXpBonus,
                baseCoinBonus: creatures.baseCoinBonus,
                contributedByName: users.displayName,
            })
            .from(teamCreatures)
            .innerJoin(creatures, eq(teamCreatures.creatureId, creatures.id))
            .leftJoin(users, eq(teamCreatures.contributedByUserId, users.id))
            .where(eq(teamCreatures.teamId, TEAM_ID));
        return rows;
    } catch (error) {
        console.error("Errore getTeamCreatures:", error);
        return [];
    }
}

/**
 * Equip a team creature. Un-equips the currently equipped one first.
 */
export async function equipTeamCreature(teamCreatureId: string) {
    try {
        // Un-equip all currently equipped
        await db.update(teamCreatures)
            .set({ isEquipped: false })
            .where(and(eq(teamCreatures.teamId, TEAM_ID), eq(teamCreatures.isEquipped, true)));

        // Equip the selected one
        await db.update(teamCreatures)
            .set({ isEquipped: true })
            .where(and(eq(teamCreatures.id, teamCreatureId), eq(teamCreatures.teamId, TEAM_ID)));

        return { success: true };
    } catch (error) {
        console.error("Errore equipTeamCreature:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Fuse 3 copies of the same creature in team inventory to level up one.
 */
export async function fuseTeamCreatures(creatureId: string) {
    try {
        const copies = await db.select().from(teamCreatures)
            .where(and(eq(teamCreatures.teamId, TEAM_ID), eq(teamCreatures.creatureId, creatureId)));

        if (copies.length < 3) {
            return { success: false, error: 'Servono almeno 3 copie per la fusione' };
        }

        const sorted = [...copies].sort((a, b) => {
            if (a.isEquipped && !b.isEquipped) return -1;
            if (!a.isEquipped && b.isEquipped) return 1;
            return b.level - a.level;
        });

        const keeper = sorted[0];
        if (keeper.level >= 10) {
            return { success: false, error: 'Creatura già al livello massimo (10)' };
        }

        const toConsume = sorted.filter(c => c.id !== keeper.id).slice(0, 3);
        if (toConsume.length < 3) {
            return { success: false, error: 'Servono almeno 3 copie extra per la fusione' };
        }

        for (const c of toConsume) {
            await db.delete(teamCreatures).where(eq(teamCreatures.id, c.id));
        }

        await db.update(teamCreatures)
            .set({ level: keeper.level + 1 })
            .where(eq(teamCreatures.id, keeper.id));

        return { success: true, newLevel: keeper.level + 1, consumed: toConsume.length };
    } catch (error) {
        console.error("Errore fuseTeamCreatures:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * Get team adventure progress (stage + boss).
 */
export async function getTeamAdventureProgress() {
    return getOrCreateTeamProfile();
}

/**
 * Attack the team's current boss.
 */
export async function teamAttackBoss(actionType: string, confermeUserId: string) {
    try {
        const damage = DAMAGE_MAP[actionType] || 0;
        if (damage === 0) return null;

        const profile = await getOrCreateTeamProfile();
        if (!profile) return null;

        if (profile.currentStage % 10 !== 0) return null;
        if (profile.currentBossHp === null && !profile.activeBoss) return null;

        const [boss] = await db.select().from(adventureBosses)
            .where(eq(adventureBosses.stageNumber, profile.currentStage));
        if (!boss) return null;

        const currentHp = profile.currentBossHp ?? boss.totalHp;
        const newHp = Math.max(0, currentHp - damage);

        if (newHp <= 0) {
            // Boss defeated! Award to all conferme team members
            const nextStage = profile.currentStage + 1;

            // Drop creature to team
            await teamDropCreature(confermeUserId);

            // Advance stage
            await db.update(teamRpgProfile)
                .set({
                    currentStage: nextStage > 100 ? 100 : nextStage,
                    currentBossHp: null,
                })
                .where(eq(teamRpgProfile.id, TEAM_ID));

            return {
                bossDefeated: true,
                bossName: boss.name,
                rewardCoins: boss.rewardCoins,
                rewardTitle: boss.rewardTitle,
                newStage: nextStage > 100 ? 100 : nextStage,
            };
        } else {
            await db.update(teamRpgProfile)
                .set({ currentBossHp: newHp })
                .where(eq(teamRpgProfile.id, TEAM_ID));

            // Broadcast damage event for live updates
            try {
                const [confermeUser] = await db.select({ displayName: users.displayName, name: users.name })
                    .from(users).where(eq(users.id, confermeUserId));
                const userName = confermeUser?.displayName || confermeUser?.name || 'Operatore';
                const supabase = await createClient();
                const channel = supabase.channel('team-adventure');
                await channel.send({
                    type: 'broadcast',
                    event: 'team_boss_damage',
                    payload: { bossHp: newHp, totalHp: boss.totalHp, damage, userName, action: actionType },
                });
                supabase.removeChannel(channel);
            } catch { /* broadcast errors are non-critical */ }

            return {
                bossDefeated: false,
                damageDealt: damage,
                remainingHp: newHp,
                totalHp: boss.totalHp,
            };
        }
    } catch (error) {
        console.error("Errore teamAttackBoss:", error);
        return null;
    }
}
