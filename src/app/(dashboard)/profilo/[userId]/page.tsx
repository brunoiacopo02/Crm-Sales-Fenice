import { getGdoRpgProfile } from '@/app/actions/rpgProfileActions';
import { getUserAchievements } from '@/app/actions/achievementActions';
import { getUnlockedTitles } from '@/app/actions/titleActions';
import { getStreakInfo } from '@/app/actions/streakActions';
import { getUserQuests } from '@/app/actions/questActions';
import { getUserLifetimeStats } from '@/app/actions/leaderboardActions';
import { getUserInventory } from '@/app/actions/shopActions';
import ProfileClient from '../ProfileClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Dynamic profile view for TL/Manager to see any GDO's profile.
 * Access: MANAGER, ADMIN, TEAM_LEADER only.
 */
export default async function ViewGdoProfilePage({ params }: { params: Promise<{ userId: string }> }) {
    const { userId: targetUserId } = await params;
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) {
        redirect('/login');
    }

    // Check caller is a Manager/Admin/TL
    const callerRows = await db.select({ role: users.role }).from(users).where(eq(users.id, supabaseUser.id));
    const callerRole = callerRows[0]?.role;
    if (!callerRole || !['MANAGER', 'ADMIN', 'TEAM_LEADER'].includes(callerRole)) {
        redirect('/profilo');
    }

    try {
        const [profileData, achievementData, titleData, streakData, questData, lifetimeStats, inventory] = await Promise.all([
            getGdoRpgProfile(targetUserId).catch(e => { console.error("Profile error:", e); return null; }),
            getUserAchievements(targetUserId).catch(() => ({ achievements: [] })),
            getUnlockedTitles(targetUserId).catch(() => ({ titles: [], activeTitle: null })),
            getStreakInfo(targetUserId).catch(() => ({ streakCount: 0, isActiveToday: false, multiplier: 1, tierLabel: 'x1' })),
            getUserQuests(targetUserId).catch(() => ({ daily: [], weekly: [] })),
            getUserLifetimeStats(targetUserId).catch(() => undefined),
            getUserInventory(targetUserId).catch(() => []),
        ]);

        if (!profileData) {
            return <div className="p-8 text-center text-ash-500">Profilo GDO non trovato.</div>;
        }

        const equippedItemId = profileData.equippedItemId;
        const equippedItemInfo = equippedItemId
            ? inventory.find(item => item.id === equippedItemId) || null
            : null;

        return (
            <div>
                {/* Back to Monitor */}
                <div className="px-4 lg:px-8 pt-4">
                    <Link
                        href="/manager-rpg-monitor"
                        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-gaming-text-muted)] hover:text-[var(--color-gaming-text)] transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Torna al Monitor RPG
                    </Link>
                </div>
                <ProfileClient
                    profileData={profileData}
                    achievements={achievementData.achievements}
                    titleData={titleData}
                    streakInfo={{
                        streakCount: streakData.streakCount,
                        lastStreakDate: null,
                        isActiveToday: streakData.isActiveToday,
                        multiplier: streakData.multiplier,
                        tierLabel: streakData.tierLabel,
                    }}
                    activeQuests={{
                        daily: questData.daily.map(q => ({
                            progressId: q.progressId,
                            title: q.title,
                            description: q.description || '',
                            type: 'daily',
                            currentValue: q.currentValue,
                            targetValue: q.targetValue,
                            completed: q.completed,
                            rewardXp: q.rewardXp,
                            rewardCoins: q.rewardCoins,
                        })),
                        weekly: questData.weekly.map(q => ({
                            progressId: q.progressId,
                            title: q.title,
                            description: q.description || '',
                            type: 'weekly',
                            currentValue: q.currentValue,
                            targetValue: q.targetValue,
                            completed: q.completed,
                            rewardXp: q.rewardXp,
                            rewardCoins: q.rewardCoins,
                        })),
                    }}
                    lifetimeStats={lifetimeStats}
                    equippedItems={inventory.map(item => ({
                        id: item.id,
                        name: item.name,
                        description: item.description,
                        cssValue: item.cssValue,
                    }))}
                    equippedItemInfo={equippedItemInfo ? {
                        id: equippedItemInfo.id,
                        name: equippedItemInfo.name,
                        description: equippedItemInfo.description,
                        cssValue: equippedItemInfo.cssValue,
                    } : null}
                />
            </div>
        );
    } catch (e) {
        console.error(e);
        return <div className="p-8 text-center text-ash-500">Errore caricamento profilo GDO.</div>;
    }
}
