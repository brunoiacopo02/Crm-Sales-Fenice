import { getGdoRpgProfile } from '@/app/actions/rpgProfileActions';
import { getUserAchievements } from '@/app/actions/achievementActions';
import { getUnlockedTitles } from '@/app/actions/titleActions';
import { getStreakInfo } from '@/app/actions/streakActions';
import { getUserQuests } from '@/app/actions/questActions';
import { getUserLifetimeStats } from '@/app/actions/leaderboardActions';
import { getUserInventory } from '@/app/actions/shopActions';
import { getDuelHistory } from '@/app/actions/duelActions';
import { getScriptCompletionRate } from '@/app/actions/gdoPerformanceActions';
import { getAllCreatureDefinitions, getUserCreatures } from '@/app/actions/creatureActions';
import { getTeamCreatures, getTeamAdventureProgress } from '@/app/actions/teamAdventureActions';
import { getAdventureProgress, getAllBosses } from '@/app/actions/adventureActions';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"
import dynamic from 'next/dynamic';

const ProfileClient = dynamic(() => import('./ProfileClient'), { loading: () => <div className="animate-pulse space-y-4"><div className="h-48 bg-ash-100 rounded-xl" /><div className="grid grid-cols-2 gap-4"><div className="h-32 bg-ash-100 rounded-xl" /><div className="h-32 bg-ash-100 rounded-xl" /></div><div className="h-64 bg-ash-100 rounded-xl" /></div> });

export default async function ProfiloPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) {
        redirect('/login');
    }

    const role = supabaseUser.user_metadata?.role;
    const isTeam = role === 'CONFERME';

    try {
        const [profileData, achievementData, titleData, streakData, questData, lifetimeStats, inventory, duelHistoryData, scriptStats, allCreatures, ownedCreatures, adventureProgress, adventureBosses] = await Promise.all([
            getGdoRpgProfile(supabaseUser.id).catch(e => { console.error("Profile error:", e); return null; }),
            getUserAchievements(supabaseUser.id).catch(() => ({ achievements: [] })),
            getUnlockedTitles(supabaseUser.id).catch(() => ({ titles: [], activeTitle: null })),
            getStreakInfo(supabaseUser.id).catch(() => ({ streakCount: 0, isActiveToday: false, multiplier: 1, tierLabel: 'x1' })),
            getUserQuests(supabaseUser.id).catch(() => ({ daily: [], weekly: [] })),
            getUserLifetimeStats(supabaseUser.id).catch(() => undefined),
            getUserInventory(supabaseUser.id).catch(() => []),
            getDuelHistory(supabaseUser.id).catch(() => ({ duels: [], stats: { totalDuels: 0, wins: 0, losses: 0, winRate: 0 } })),
            getScriptCompletionRate(supabaseUser.id).catch(() => ({ totalCalls: 0, scriptCompletedCount: 0, completionRate: 0, scriptStreak: 0 })),
            getAllCreatureDefinitions().catch(() => []),
            (isTeam ? getTeamCreatures() : getUserCreatures(supabaseUser.id)).catch(() => []),
            (isTeam ? getTeamAdventureProgress() : getAdventureProgress(supabaseUser.id)).catch(() => ({ currentStage: 1, currentBossHp: 0, activeBoss: null, stageRequirement: 0 })),
            getAllBosses().catch(() => []),
        ]);

        if (!profileData) {
            return <div className="p-8 text-center text-ash-500">Errore caricamento profilo. Riprova tra qualche secondo.</div>;
        }

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
                duelHistory={duelHistoryData}
                scriptStats={scriptStats}
                allCreatures={allCreatures}
                ownedCreatures={ownedCreatures}
                adventureProgress={adventureProgress}
                adventureBosses={adventureBosses}
                isTeam={isTeam}
                userId={supabaseUser.id}
            />
        );
    } catch (e) {
        console.error(e);
        return <div>Errore caricamento profilo.</div>;
    }
}
