'use client';

import { useEffect, useState, useCallback } from 'react';
import { Scroll, Swords, Star, Coins, Zap, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { generateDailyQuests, getUserQuests, checkQuestProgress, completeQuest } from '@/app/actions/questActions';
import { QuestChainModal } from '@/components/QuestChainModal';

interface QuestItem {
    progressId: string;
    questId: string;
    title: string;
    description: string;
    targetValue: number;
    currentValue: number;
    rewardXp: number;
    rewardCoins: number;
    completed: boolean;
}

interface QuestData {
    daily: QuestItem[];
    weekly: QuestItem[];
}

function QuestCard({ quest, onClaim }: { quest: QuestItem; onClaim: (id: string) => void }) {
    const progress = Math.min((quest.currentValue / quest.targetValue) * 100, 100);
    const isComplete = quest.completed;

    return (
        <div className={`relative rounded-xl p-3.5 transition-all duration-500 border ${
            isComplete
                ? 'bg-gradient-to-r from-gold-900/40 to-gold-800/20 border-gold-500/40 shadow-glow-gold'
                : 'bg-white/5 border-white/10 hover:border-white/20'
        }`}>
            {/* Completion glow overlay */}
            {isComplete && (
                <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_50%_50%,rgba(201,161,60,0.08),transparent_70%)] pointer-events-none" />
            )}

            <div className="relative z-10">
                {/* Title + Rewards row */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-white/90 truncate">{quest.title}</div>
                        <div className="text-xs text-ash-400 mt-0.5 line-clamp-1">{quest.description}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-0.5 text-xs font-medium text-brand-orange-300">
                            <Zap className="h-3 w-3" />
                            {quest.rewardXp}
                        </div>
                        <div className="flex items-center gap-0.5 text-xs font-medium text-gold-400">
                            <Coins className="h-3 w-3" />
                            {quest.rewardCoins}
                        </div>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-2 bg-ash-800/80 rounded-full overflow-hidden border border-ash-700/40">
                        <div
                            className={`h-full rounded-full transition-[width] duration-1000 ease-out ${
                                isComplete
                                    ? 'bg-gradient-to-r from-gold-500 to-gold-300 shadow-[0_0_8px_rgba(201,161,60,0.5)]'
                                    : 'bg-gradient-to-r from-ember-500 via-brand-orange to-gold-400'
                            }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="text-xs font-mono text-ash-300 tabular-nums shrink-0 w-14 text-right">
                        {quest.currentValue}/{quest.targetValue}
                    </div>
                </div>

                {/* Claim button for completed quests */}
                {isComplete && (
                    <div className="mt-2 flex justify-end">
                        <button
                            onClick={() => onClaim(quest.progressId)}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-gold-500/20 text-gold-300 border border-gold-500/30 hover:bg-gold-500/30 transition-all"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Riscuoti
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

interface ChainModalData {
    completedQuest: { title: string; rewardXp: number; rewardCoins: number };
    nextQuest: { title: string; description: string; targetValue: number; rewardXp: number; rewardCoins: number } | null;
}

export function QuestPanel({ userId }: { userId: string }) {
    const [quests, setQuests] = useState<QuestData | null>(null);
    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set());
    const [chainModal, setChainModal] = useState<ChainModalData | null>(null);

    const loadQuests = useCallback(async () => {
        if (!userId) return;
        try {
            await generateDailyQuests(userId);
            await checkQuestProgress(userId);
            const data = await getUserQuests(userId);
            setQuests(data);
        } catch (err) {
            console.error('Error loading quests:', err);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadQuests();
    }, [loadQuests]);

    const handleClaim = async (progressId: string) => {
        setClaiming(progressId);
        try {
            const result = await completeQuest(userId, progressId);
            if (result.success) {
                setJustClaimed(prev => new Set(prev).add(progressId));

                // Find the claimed quest info for the chain modal
                const allQuests = [...(quests?.daily || []), ...(quests?.weekly || [])];
                const claimedQuest = allQuests.find(q => q.progressId === progressId);

                // Reload quests to reflect updated state
                const data = await getUserQuests(userId);
                setQuests(data);

                if (claimedQuest) {
                    // Find next uncompleted quest as teaser
                    const updatedAll = [...data.daily, ...data.weekly];
                    const nextUncompleted = updatedAll.find(q => !q.completed && q.progressId !== progressId);

                    setChainModal({
                        completedQuest: {
                            title: claimedQuest.title,
                            rewardXp: claimedQuest.rewardXp,
                            rewardCoins: claimedQuest.rewardCoins,
                        },
                        nextQuest: nextUncompleted ? {
                            title: nextUncompleted.title,
                            description: nextUncompleted.description,
                            targetValue: nextUncompleted.targetValue,
                            rewardXp: nextUncompleted.rewardXp,
                            rewardCoins: nextUncompleted.rewardCoins,
                        } : null,
                    });
                }
            }
        } catch (err) {
            console.error('Error claiming quest:', err);
        } finally {
            setClaiming(null);
        }
    };

    if (loading) return <div className="skeleton-card h-48" />;
    if (!quests || (quests.daily.length === 0 && quests.weekly.length === 0)) return null;

    const totalDaily = quests.daily.length;
    const completedDaily = quests.daily.filter(q => q.completed).length;
    const totalWeekly = quests.weekly.length;
    const completedWeekly = quests.weekly.filter(q => q.completed).length;

    return (
        <div className="w-full border shadow-elevated rounded-2xl p-5 text-white relative overflow-hidden transition-all duration-500 bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900/40 border-ash-700">
            {/* Decorative blurs */}
            <div className="absolute top-0 left-0 w-48 h-48 bg-brand-orange/8 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-36 h-36 bg-ember-500/8 rounded-full blur-3xl translate-y-1/3 translate-x-1/4 pointer-events-none" />

            <div className="relative z-10">
                {/* Header */}
                <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => setCollapsed(!collapsed)}
                >
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-brand-orange/15">
                            <Scroll className="h-5 w-5 text-brand-orange" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold tracking-tight text-white">Quest Attive</h3>
                            <div className="text-xs text-ash-400 mt-0.5">
                                {completedDaily}/{totalDaily} giornaliere · {completedWeekly}/{totalWeekly} settimanali
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Mini completion badges */}
                        {completedDaily + completedWeekly > 0 && (
                            <div className="flex items-center gap-1 bg-gold-500/10 rounded-full px-2.5 py-1 text-xs font-semibold text-gold-400 border border-gold-500/20">
                                <Star className="h-3 w-3" />
                                {completedDaily + completedWeekly} completate
                            </div>
                        )}
                        <div className="p-1 rounded-lg hover:bg-white/5 transition-colors">
                            {collapsed ? <ChevronDown className="h-4 w-4 text-ash-400" /> : <ChevronUp className="h-4 w-4 text-ash-400" />}
                        </div>
                    </div>
                </div>

                {/* Content */}
                {!collapsed && (
                    <div className="mt-4 space-y-4 animate-fade-in">
                        {/* Daily Quests */}
                        {quests.daily.length > 0 && (
                            <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Swords className="h-3.5 w-3.5 text-ember-400" />
                                    <div className="text-xs font-semibold text-ash-300 uppercase tracking-wider">Giornaliere</div>
                                </div>
                                <div className="space-y-2">
                                    {quests.daily.map(quest => (
                                        <QuestCard
                                            key={quest.progressId}
                                            quest={quest}
                                            onClaim={handleClaim}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Weekly Quests */}
                        {quests.weekly.length > 0 && (
                            <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Star className="h-3.5 w-3.5 text-gold-400" />
                                    <div className="text-xs font-semibold text-ash-300 uppercase tracking-wider">Settimanali</div>
                                </div>
                                <div className="space-y-2">
                                    {quests.weekly.map(quest => (
                                        <QuestCard
                                            key={quest.progressId}
                                            quest={quest}
                                            onClaim={handleClaim}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quest Chain Modal — shown after claiming a quest */}
            {chainModal && (
                <QuestChainModal
                    completedQuest={chainModal.completedQuest}
                    nextQuest={chainModal.nextQuest}
                    onClose={() => setChainModal(null)}
                />
            )}
        </div>
    );
}
