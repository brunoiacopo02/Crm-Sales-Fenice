'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp } from 'lucide-react';
import { getUserLevelProgress } from '@/app/actions/sprintActions';
import { getAnimationsEnabled } from '@/lib/animationUtils';

interface LevelProgress {
    level: number;
    experience: number;
    targetXp: number;
    progressPercent: number;
    remainingXp: number;
}

export function LevelNudge({ userId }: { userId: string }) {
    const [progress, setProgress] = useState<LevelProgress | null>(null);

    const load = useCallback(async () => {
        if (!userId) return;
        try {
            const data = await getUserLevelProgress(userId);
            setProgress(data);
        } catch (err) {
            console.error('LevelNudge: error loading level progress', err);
        }
    }, [userId]);

    useEffect(() => { load(); }, [load]);

    // Refresh on reward_earned events (XP may have changed)
    useEffect(() => {
        const handler = () => { load(); };
        window.addEventListener('reward_earned', handler);
        return () => window.removeEventListener('reward_earned', handler);
    }, [load]);

    if (!progress) return null;
    if (progress.progressPercent < 80) return null;

    const nextLevel = progress.level + 1;
    const animationsEnabled = typeof window !== 'undefined' ? getAnimationsEnabled() : true;
    const pulseClass = animationsEnabled ? 'animate-[level-nudge-pulse_2.5s_ease-in-out_infinite]' : '';

    return (
        <div className={`w-full rounded-xl border border-[var(--color-gaming-gold)]/25 bg-gradient-to-r from-[var(--color-gaming-bg)] via-gold-900/15 to-[var(--color-gaming-bg-card)] px-4 py-3 flex items-center gap-3 ${pulseClass}`}>
            <div className="p-1.5 rounded-lg bg-[var(--color-gaming-gold)]/12 border border-[var(--color-gaming-gold)]/20">
                <TrendingUp className="h-5 w-5 text-[var(--color-gaming-gold)]" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[var(--color-gaming-gold)]">
                    Quasi al livello {nextLevel}!
                </div>
                <div className="text-xs text-[var(--color-gaming-gold)]/70 mt-0.5">
                    Mancano solo {progress.remainingXp} XP — continua cosi!
                </div>
            </div>
            {/* Mini XP progress bar */}
            <div className="w-24 shrink-0">
                <div className="h-2 bg-[var(--color-gaming-bg-deep)] rounded-full overflow-hidden border border-[var(--color-gaming-border)]">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--color-gaming-gold)] to-[var(--color-gaming-amber)] transition-[width] duration-1000 ease-out"
                        style={{ width: `${progress.progressPercent}%` }}
                    />
                </div>
                <div className="text-[10px] text-[var(--color-gaming-text-muted)] text-right mt-0.5 tabular-nums font-mono">
                    {progress.experience}/{progress.targetXp} XP
                </div>
            </div>
        </div>
    );
}
