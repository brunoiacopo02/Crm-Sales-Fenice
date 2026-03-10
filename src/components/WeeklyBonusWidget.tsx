'use client';

import { useEffect, useState } from 'react';
import { Trophy, Gift, Zap, TrendingUp, CalendarDays } from 'lucide-react';
import { getCurrentGdoGamificationState } from '@/app/actions/gdoPerformanceActions';

interface WidgetState {
    currentPresences: number;
    target1: number;
    reward1: number;
    target2: number;
    reward2: number;
    currentWeekName: string;
    weekStart: string;
    weekEnd: string;
}

export function WeeklyBonusWidget({ userId }: { userId: string }) {
    const [state, setState] = useState<WidgetState | null>(null);

    useEffect(() => {
        if (!userId) return;
        getCurrentGdoGamificationState(userId).then(setState).catch(console.error);
    }, [userId]);

    if (!state) return null; // Loading state implicito

    const progressPerc = Math.min((state.currentPresences / state.target2) * 100, 100);
    const posTier1 = Math.min((state.target1 / state.target2) * 100, 100);

    const isTier1Reached = state.currentPresences >= state.target1;
    const isTier2Reached = state.currentPresences >= state.target2;

    let message = `Forza! Sei a ${state.target1 - state.currentPresences} presenze dal primo Bonus!`;
    if (isTier2Reached) {
        message = "Assoluta Perfezione! Hai conquistato il Massimo Bonus Settimanale! 🏆";
    } else if (isTier1Reached) {
        message = `Fantastico! Hai sbloccato €${state.reward1}. Te ne mancano ${state.target2 - state.currentPresences} per il Progetto Oro!`;
    }

    return (
        <div className="w-full bg-slate-900 border border-slate-700 shadow-xl rounded-2xl p-6 mb-8 text-white relative overflow-hidden">
            {/* Sfondo Decorativo */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>

            <div className="relative z-10 flex flex-col lg:flex-row items-center gap-6 justify-between">

                {/* Intro e Statistiche Base */}
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <CalendarDays className="h-5 w-5 text-orange-400" />
                        <h2 className="text-xl font-bold tracking-tight text-orange-400">Tracker Settimanale GDO</h2>
                    </div>
                    <p className="text-sm text-slate-400 font-medium">
                        {state.currentWeekName} <span className="text-slate-500 ml-1">({state.weekStart} - {state.weekEnd})</span>
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 bg-slate-800/80 rounded-full px-4 py-1.5 border border-slate-700 shadow-inner">
                        <Zap className="h-4 w-4 text-yellow-400" />
                        <span className="font-semibold">{state.currentPresences} Presenze Effettive</span>
                    </div>
                </div>

                {/* Progress Bar Area */}
                <div className="flex-[2] w-full flex flex-col space-y-4">
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-300">
                        <span className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Progresso</span>
                        <span className={isTier2Reached ? "text-yellow-400 animate-pulse" : "text-white"}>{message}</span>
                    </div>

                    <div className="relative w-full h-8 bg-slate-800 rounded-full border border-slate-700 shadow-inner">

                        {/* Progress Fill Indicator */}
                        <div
                            className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-orange-600 to-yellow-400 transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(251,146,60,0.4)]"
                            style={{ width: `${progressPerc}%` }}
                        ></div>

                        {/* Tier 1 Marker */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -ml-3 flex items-center justify-center transition-all duration-500"
                            style={{ left: `${posTier1}%` }}
                        >
                            <div className="relative group">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-slate-900 z-10 
                                    ${isTier1Reached ? 'border-orange-400 text-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.8)]' : 'border-slate-500 text-slate-500'}`}>
                                    {state.target1}
                                </div>
                                <div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Gift className={`h-3 w-3 ${isTier1Reached ? 'text-orange-400' : 'text-slate-400'}`} />
                                    <span className="font-bold text-white">Tier 1: €{state.reward1}</span>
                                </div>
                            </div>
                        </div>

                        {/* Tier 2 Marker (End) */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -ml-3 flex items-center justify-center transition-all duration-500"
                            style={{ left: `100%` }}
                        >
                            <div className="relative group">
                                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-slate-900 z-10 
                                    ${isTier2Reached ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,1)]' : 'border-slate-500 text-slate-500'}`}>
                                    <Trophy className={`h-4 w-4 ${isTier2Reached ? 'text-yellow-400 scale-110' : ''}`} />
                                </div>
                                <div className="absolute top-10 right-0 lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity transform origin-top-right">
                                    <span className="font-bold text-yellow-500">Tier MAX: €{state.reward2} ({state.target2} app)</span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}
