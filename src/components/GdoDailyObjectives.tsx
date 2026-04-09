'use client';

import { useEffect, useState } from 'react';
import { getGdoDailyObjectives } from '@/app/actions/gdoPerformanceActions';
import { Phone, CalendarPlus, Target } from 'lucide-react';

interface GdoDailyObjectivesProps {
    gdoUserId: string;
}

interface Objectives {
    callsDone: number;
    callsTarget: number;
    pipelineSize: number;
    appointmentsDone: number;
    appointmentsTarget: number;
}

function ProgressBar({ current, target }: { current: number; target: number }) {
    const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    const color = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';

    return (
        <div className="w-full bg-gray-200 rounded-full h-2 mt-1.5">
            <div
                className={`${color} h-2 rounded-full transition-[width] duration-500`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

export function GdoDailyObjectives({ gdoUserId }: GdoDailyObjectivesProps) {
    const [data, setData] = useState<Objectives | null>(null);

    useEffect(() => {
        getGdoDailyObjectives(gdoUserId).then(setData);

        const handler = () => {
            getGdoDailyObjectives(gdoUserId).then(setData);
        };
        window.addEventListener('realtime_update', handler);
        return () => window.removeEventListener('realtime_update', handler);
    }, [gdoUserId]);

    if (!data) {
        return (
            <div className="bg-gradient-to-r from-brand-charcoal to-gray-800 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-gray-600 rounded w-40 mb-3" />
                <div className="grid grid-cols-2 gap-4">
                    <div className="h-16 bg-gray-700 rounded-lg" />
                    <div className="h-16 bg-gray-700 rounded-lg" />
                </div>
            </div>
        );
    }

    const apptPct = data.appointmentsTarget > 0
        ? Math.round((data.appointmentsDone / data.appointmentsTarget) * 100)
        : 0;
    const apptComplete = data.appointmentsDone >= data.appointmentsTarget;

    return (
        <div className="bg-gradient-to-r from-brand-charcoal to-gray-800 rounded-xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-brand-orange" />
                <div className="text-sm font-semibold text-brand-orange">Obiettivi di Oggi</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {/* Chiamate oggi */}
                <div className="bg-white/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Phone className="w-4 h-4 text-blue-400" />
                        <div className="text-xs text-gray-300">Chiamate oggi</div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-bold text-white">{data.callsDone}</div>
                        <div className="text-sm text-gray-400">/ {data.callsTarget}</div>
                    </div>
                    <ProgressBar current={data.callsDone} target={data.callsTarget} />
                </div>

                {/* Fissaggi oggi */}
                <div className={`rounded-lg p-3 ${apptComplete ? 'bg-green-500/20 ring-1 ring-green-500/40' : 'bg-white/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <CalendarPlus className="w-4 h-4 text-amber-400" />
                        <div className="text-xs text-gray-300">Fissaggi oggi</div>
                    </div>
                    <div className="flex items-baseline gap-1">
                        <div className={`text-2xl font-bold ${apptComplete ? 'text-green-400' : 'text-white'}`}>
                            {data.appointmentsDone}
                        </div>
                        <div className="text-sm text-gray-400">/ {data.appointmentsTarget}</div>
                        {apptComplete && (
                            <div className="ml-auto text-xs font-semibold text-green-400 uppercase">Fatto!</div>
                        )}
                    </div>
                    <ProgressBar current={data.appointmentsDone} target={data.appointmentsTarget} />
                </div>
            </div>
        </div>
    );
}
