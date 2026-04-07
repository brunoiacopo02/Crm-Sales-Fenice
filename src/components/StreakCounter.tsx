'use client';

import { useEffect, useState, useCallback } from 'react';
import { Flame, TrendingUp, Zap } from 'lucide-react';
import { getStreakInfo } from '@/app/actions/streakActions';

interface StreakData {
    streakCount: number;
    multiplier: number;
    tierLabel: string;
    nextMilestone: { daysToNext: number; nextMultiplier: number } | null;
    isActiveToday: boolean;
}

function MultiplierBadge({ multiplier, tierLabel }: { multiplier: number; tierLabel: string }) {
    if (multiplier <= 1) return null;

    const colorClasses = multiplier >= 3
        ? 'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-300'
        : multiplier >= 2
            ? 'from-ember-500/20 to-ember-600/10 border-ember-500/30 text-ember-300'
            : 'from-brand-orange/20 to-brand-orange/10 border-brand-orange/30 text-brand-orange-300';

    return (
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-gradient-to-r ${colorClasses}`}>
            <Zap className="h-3 w-3" />
            {tierLabel}
        </div>
    );
}

export function StreakCounter({ userId }: { userId: string }) {
    const [streak, setStreak] = useState<StreakData | null>(null);
    const [loading, setLoading] = useState(true);

    const loadStreak = useCallback(async () => {
        if (!userId) return;
        try {
            const data = await getStreakInfo(userId);
            setStreak(data);
        } catch (err) {
            console.error('Error loading streak:', err);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadStreak();
    }, [loadStreak]);

    if (loading) return <div className="skeleton-card h-20" />;
    if (!streak) return null;

    const { streakCount, multiplier, tierLabel, nextMilestone, isActiveToday } = streak;

    // Flame animation intensity based on streak tier
    const flameColorClass = streakCount >= 14
        ? 'text-purple-400'
        : streakCount >= 7
            ? 'text-ember-400'
            : streakCount >= 3
                ? 'text-brand-orange'
                : 'text-ash-400';

    const glowClass = streakCount >= 7 ? 'animate-glow-pulse' : '';

    // Progress toward next milestone
    const milestoneProgress = nextMilestone
        ? (() => {
            const tiersStart = [0, 3, 7, 14];
            const currentTierStart = multiplier >= 3 ? 14 : multiplier >= 2 ? 7 : multiplier >= 1.5 ? 3 : 0;
            const tierTarget = nextMilestone.daysToNext + streakCount;
            const progressInTier = streakCount - currentTierStart;
            const tierRange = tierTarget - currentTierStart;
            return tierRange > 0 ? (progressInTier / tierRange) * 100 : 0;
        })()
        : 100;

    return (
        <div className={`w-full border shadow-elevated rounded-2xl p-4 text-white relative overflow-hidden transition-all duration-500 bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900/30 border-ash-700 ${glowClass}`}>
            {/* Background glow for active streaks */}
            {streakCount >= 3 && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-ember-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
            )}

            <div className="relative z-10 flex items-center gap-4">
                {/* Flame icon + count */}
                <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl ${streakCount >= 3 ? 'bg-ember-500/15' : 'bg-ash-800/50'} transition-colors`}>
                        <Flame className={`h-6 w-6 ${flameColorClass} transition-colors`} />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-black tabular-nums text-white">{streakCount}</span>
                            <span className="text-xs font-medium text-ash-400">
                                {streakCount === 1 ? 'giorno' : 'giorni'}
                            </span>
                        </div>
                        <div className="text-xs text-ash-500 -mt-0.5">
                            {isActiveToday ? 'Streak attiva oggi' : streakCount > 0 ? 'Completa una quest!' : 'Inizia la tua streak'}
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="h-10 w-px bg-ash-700/50" />

                {/* Multiplier + progress to next tier */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <MultiplierBadge multiplier={multiplier} tierLabel={tierLabel} />
                        {nextMilestone && (
                            <div className="flex items-center gap-1 text-xs text-ash-400">
                                <TrendingUp className="h-3 w-3" />
                                <span>{nextMilestone.daysToNext}g a x{nextMilestone.nextMultiplier}</span>
                            </div>
                        )}
                        {!nextMilestone && streakCount >= 14 && (
                            <div className="text-xs font-semibold text-purple-400">Livello MAX</div>
                        )}
                    </div>

                    {/* Progress bar to next tier */}
                    {nextMilestone && (
                        <div className="h-1.5 bg-ash-800/80 rounded-full overflow-hidden border border-ash-700/40">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                    multiplier >= 2
                                        ? 'bg-gradient-to-r from-ember-500 to-purple-500'
                                        : multiplier >= 1.5
                                            ? 'bg-gradient-to-r from-brand-orange to-ember-400'
                                            : 'bg-gradient-to-r from-ash-500 to-brand-orange'
                                }`}
                                style={{ width: `${milestoneProgress}%` }}
                            />
                        </div>
                    )}
                    {!nextMilestone && (
                        <div className="h-1.5 bg-ash-800/80 rounded-full overflow-hidden border border-ash-700/40">
                            <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.5)]" style={{ width: '100%' }} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
