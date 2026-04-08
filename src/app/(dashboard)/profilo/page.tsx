import { getGdoRpgProfile } from '@/app/actions/rpgProfileActions';
import { getUserAchievements } from '@/app/actions/achievementActions';
import { getUnlockedTitles } from '@/app/actions/titleActions';
import { getStreakInfo } from '@/app/actions/streakActions';
import { getUserQuests } from '@/app/actions/questActions';
import { getUserLifetimeStats } from '@/app/actions/leaderboardActions';
import { getUserInventory, getEquippedSkinCss } from '@/app/actions/shopActions';
import ProfileClient from './ProfileClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"

export default async function ProfiloPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) {
        redirect('/login');
    }

    try {
        const [profileData, achievementData, titleData, streakData, questData, lifetimeStats, inventory] = await Promise.all([
            getGdoRpgProfile(supabaseUser.id),
            getUserAchievements(supabaseUser.id),
            getUnlockedTitles(supabaseUser.id),
            getStreakInfo(supabaseUser.id),
            getUserQuests(supabaseUser.id),
            getUserLifetimeStats(supabaseUser.id),
            getUserInventory(supabaseUser.id),
        ]);

        // Find equipped item from inventory
        const equippedItemId = profileData.equippedItemId;
        const equippedItemInfo = equippedItemId
            ? inventory.find(item => item.id === equippedItemId) || null
            : null;

        return (
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
        );
    } catch (e) {
        console.error(e);
        return <div>Errore caricamento profilo.</div>;
    }
}
