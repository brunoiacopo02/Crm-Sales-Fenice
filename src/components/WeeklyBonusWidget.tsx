'use client';

import { useEffect, useState } from 'react';
import { Trophy, Gift, Zap, TrendingUp, CalendarDays, Flame, Star } from 'lucide-react';
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

    if (!state) return <div className="skeleton-card h-40" />;

    const progressPerc = Math.min((state.currentPresences / state.target2) * 100, 100);
    const posTier1 = Math.min((state.target1 / state.target2) * 100, 100);

    const isTier1Reached = state.currentPresences >= state.target1;
    const isTier2Reached = state.currentPresences >= state.target2;

    let message = `Forza! Sei a ${state.target1 - state.currentPresences} presenze dal primo Bonus!`;
    if (isTier2Reached) {
        message = "Perfezione Assoluta! Hai conquistato il Massimo Bonus Settimanale!";
    } else if (isTier1Reached) {
        message = `Fantastico! Hai sbloccato €${state.reward1}. Te ne mancano ${state.target2 - state.currentPresences} per il Progetto Oro!`;
    }

    return (
        <div className={`w-full border shadow-elevated rounded-2xl p-6 mb-8 text-white relative overflow-hidden transition-all duration-500 ${isTier2Reached
            ? 'bg-gradient-to-br from-gold-700 via-gold-600 to-ember-600 border-gold-400'
            : 'bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900/60 border-ash-700'
            }`}>
            {/* Decorative fire elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-ember-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-brand-orange/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
            {isTier2Reached && <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,rgba(201,161,60,0.15),transparent_60%)] pointer-events-none"></div>}

            <div className="relative z-10 flex flex-col lg:flex-row items-center gap-6 justify-between">

                {/* Intro e Statistiche Base */}
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-lg bg-ember-500/20">
                            <Flame className="h-5 w-5 text-ember-400" />
                        </div>
                        <h2 className="text-xl font-bold tracking-tight text-brand-orange-300">Tracker Settimanale GDO</h2>
                    </div>
                    <div className="text-sm text-ash-400 font-medium">
                        {state.currentWeekName} <span className="text-ash-500 ml-1">({state.weekStart} - {state.weekEnd})</span>
                    </div>
                    <div className="mt-4 inline-flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2 border border-white/10">
                        <Zap className="h-4 w-4 text-gold-400" />
                        <div className="font-semibold">{state.currentPresences} Presenze Effettive</div>
                    </div>
                </div>

                {/* Progress Bar Area */}
                <div className="flex-[2] w-full flex flex-col space-y-4">
                    <div className="flex items-center justify-between text-sm font-semibold">
                        <div className="flex items-center gap-1.5 text-ash-300">
                            <TrendingUp className="h-4 w-4" /> Progresso
                        </div>
                        <div className={`text-xs sm:text-sm ${isTier2Reached ? "text-gold-300 animate-pulse" : isTier1Reached ? "text-brand-orange-300" : "text-ash-300"}`}>
                            {message}
                        </div>
                    </div>

                    <div className="relative w-full h-9 bg-ash-800/80 rounded-full border border-ash-700/60 shadow-inner">

                        {/* Progress Fill */}
                        <div
                            className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out ${isTier2Reached
                                ? 'bg-gradient-to-r from-gold-500 via-gold-400 to-gold-300 shadow-[0_0_20px_rgba(201,161,60,0.5)]'
                                : 'bg-gradient-to-r from-ember-600 via-brand-orange to-gold-400 shadow-[0_0_15px_rgba(255,190,130,0.3)]'
                                }`}
                            style={{ width: `${progressPerc}%` }}
                        ></div>

                        {/* Tier 1 Marker */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -ml-3 flex items-center justify-center transition-all duration-500"
                            style={{ left: `${posTier1}%` }}
                        >
                            <div className="relative group">
                                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-ash-900 z-10 transition-all duration-300
                                    ${isTier1Reached ? 'border-brand-orange-400 text-brand-orange-400 shadow-glow-orange' : 'border-ash-500 text-ash-500'}`}>
                                    {state.target1}
                                </div>
                                <div className="absolute top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-ash-800 border border-ash-700 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-elevated">
                                    <Gift className={`h-3 w-3 ${isTier1Reached ? 'text-brand-orange-400' : 'text-ash-400'}`} />
                                    <div className="font-bold text-white">Tier 1: €{state.reward1}</div>
                                </div>
                            </div>
                        </div>

                        {/* Tier 2 Marker (End) */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 -ml-4 flex items-center justify-center transition-all duration-500"
                            style={{ left: `100%` }}
                        >
                            <div className="relative group">
                                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-ash-900 z-10 transition-all duration-300
                                    ${isTier2Reached ? 'border-gold-400 shadow-glow-gold' : 'border-ash-500 text-ash-500'}`}>
                                    <Trophy className={`h-4 w-4 transition-all ${isTier2Reached ? 'text-gold-400 scale-110' : 'text-ash-500'}`} />
                                </div>
                                <div className="absolute top-10 right-0 lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-1 bg-ash-800 border border-ash-700 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-elevated transform origin-top-right">
                                    <Star className="h-3 w-3 text-gold-400" />
                                    <div className="font-bold text-gold-400">Tier MAX: €{state.reward2} ({state.target2} app)</div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}
