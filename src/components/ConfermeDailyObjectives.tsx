'use client';

import { useEffect, useState } from 'react';
import { getConfermeDailyObjectives } from '@/app/actions/confermeKpiActions';
import { CheckCircle, Target } from 'lucide-react';

interface ConfermeDailyObjectivesProps {
    confermeUserId: string;
}

interface Objectives {
    confirmationsDone: number;
    confirmationsTarget: number;
}

export function ConfermeDailyObjectives({ confermeUserId }: ConfermeDailyObjectivesProps) {
    const [data, setData] = useState<Objectives | null>(null);

    useEffect(() => {
        getConfermeDailyObjectives(confermeUserId).then(setData);

        const handler = () => {
            getConfermeDailyObjectives(confermeUserId).then(setData);
        };
        window.addEventListener('realtime_update', handler);
        return () => window.removeEventListener('realtime_update', handler);
    }, [confermeUserId]);

    if (!data) {
        return (
            <div className="bg-gradient-to-br from-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-surface)] border border-[var(--color-gaming-border)] rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-[var(--color-gaming-bg-card)] rounded w-40 mb-3" />
                <div className="h-16 bg-[var(--color-gaming-bg-card)] rounded-lg" />
            </div>
        );
    }

    const pct = data.confirmationsTarget > 0
        ? Math.min((data.confirmationsDone / data.confirmationsTarget) * 100, 100)
        : 0;
    const pctRounded = Math.round(pct);
    const isComplete = data.confirmationsDone >= data.confirmationsTarget;
    const barColor = isComplete ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';

    return (
        <div className="bg-gradient-to-br from-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-surface)] border border-[var(--color-gaming-border)] rounded-xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[var(--color-gaming-text-muted)]" />
                <div className="text-sm font-semibold text-[var(--color-gaming-text-muted)]">Obiettivo di Oggi</div>
            </div>
            <div className={`rounded-lg p-3 ${isComplete ? 'bg-green-500/20 ring-1 ring-green-500/40' : 'bg-[color-mix(in_oklab,var(--color-gaming-text)_10%,transparent)]'}`}>
                <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <div className="text-xs text-[var(--color-gaming-text-muted)]">Confermati oggi</div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-1">
                        <div className={`text-2xl font-bold ${isComplete ? 'text-green-400' : 'text-[var(--color-gaming-text)]'}`}>
                            {data.confirmationsDone}
                        </div>
                        <div className="text-sm text-[var(--color-gaming-text-muted)]">/ {data.confirmationsTarget}</div>
                    </div>
                    <div className="flex-1">
                        <div className="w-full bg-[color-mix(in_oklab,var(--color-gaming-text)_10%,transparent)] rounded-full h-2">
                            <div
                                className={`${barColor} h-2 rounded-full transition-[width] duration-500`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                    <div className={`text-sm font-semibold ${isComplete ? 'text-green-400' : 'text-[var(--color-gaming-text-muted)]'}`}>
                        {isComplete ? 'Fatto!' : `${pctRounded}%`}
                    </div>
                </div>
            </div>
        </div>
    );
}
