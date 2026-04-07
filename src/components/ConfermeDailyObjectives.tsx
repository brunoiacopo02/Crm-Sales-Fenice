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
            <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-blue-700 rounded w-40 mb-3" />
                <div className="h-16 bg-blue-800 rounded-lg" />
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
        <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-blue-300" />
                <div className="text-sm font-semibold text-blue-300">Obiettivo di Oggi</div>
            </div>
            <div className={`rounded-lg p-3 ${isComplete ? 'bg-green-500/20 ring-1 ring-green-500/40' : 'bg-white/10'}`}>
                <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <div className="text-xs text-blue-200">Confermati oggi</div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-1">
                        <div className={`text-2xl font-bold ${isComplete ? 'text-green-400' : 'text-white'}`}>
                            {data.confirmationsDone}
                        </div>
                        <div className="text-sm text-blue-300">/ {data.confirmationsTarget}</div>
                    </div>
                    <div className="flex-1">
                        <div className="w-full bg-white/10 rounded-full h-2">
                            <div
                                className={`${barColor} h-2 rounded-full transition-[width] duration-500`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                    <div className={`text-sm font-semibold ${isComplete ? 'text-green-400' : 'text-blue-200'}`}>
                        {isComplete ? 'Fatto!' : `${pctRounded}%`}
                    </div>
                </div>
            </div>
        </div>
    );
}
