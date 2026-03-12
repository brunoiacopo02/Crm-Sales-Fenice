'use client';

import {
    Zap, Coins, Trophy, CalendarDays, TrendingUp, HandCoins, Target, ArrowUpCircle
} from 'lucide-react';
import { WeeklyBonusWidget } from "@/components/WeeklyBonusWidget"

export default function ProfileClient({ profileData }: { profileData: any }) {

    const {
        displayName, gdoCode,
        baseSalaryEur, level, experience,
        stage, targetXpForNext, financials, roadmap
    } = profileData;

    const progressPerc = Math.min((experience / targetXpForNext) * 100, 100);

    return (
        <div className="flex-1 space-y-8 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">

            {/* Header Profilo e Level */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                        Lobby Personale
                        <span className={`text-xs px-2 py-1 rounded-full border uppercase tracking-wider font-bold ${stage.badgeClass}`}>
                            {stage.name}
                        </span>
                    </h1>
                    <p className="text-slate-500 mt-1">GDO {gdoCode} - {displayName}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* COLONNA 1: Avatar e XP (RPG) */}
                <div className="col-span-1 border border-slate-200 bg-white rounded-2xl shadow-sm p-6 flex flex-col items-center text-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-100 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

                    {/* Immagine Avatar reale */}
                    <div className="relative w-32 h-32 rounded-full border-4 border-orange-100 shadow-xl bg-orange-50 flex items-center justify-center mb-6 mt-4">
                        {stage.imageUrl ? (
                            <img src={stage.imageUrl} alt={stage.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                            <ArrowUpCircle className={`w-16 h-16 ${stage.color}`} />
                        )}
                        <div className="absolute -bottom-3 bg-slate-900 text-white font-bold text-sm px-3 py-1 rounded-full border-2 border-slate-800 shadow-md">
                            Liv. {level}
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{stage.name}</h2>
                    <p className="text-sm font-medium text-slate-500 mb-6">Stadio Evolutivo Base</p>

                    <div className="w-full space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-600">
                            <span>{experience} XP</span>
                            <span>{targetXpForNext} XP</span>
                        </div>
                        <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="absolute top-0 left-0 h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-1000 ease-out"
                                style={{ width: `${progressPerc}%` }}
                            ></div>
                        </div>
                        <p className="text-xs text-slate-400 font-medium text-right">Mancano {targetXpForNext - experience} XP al Liv. {level + 1}</p>
                    </div>

                </div>

                {/* COLONNA 2: Finanza e Widget */}
                <div className="col-span-1 lg:col-span-2 space-y-8">

                    {/* Finanze Reali Mese */}
                    <div className="border border-green-200 bg-green-50/50 rounded-2xl shadow-sm p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-green-200/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>

                        <div className="flex items-center gap-2 text-green-800 mb-4">
                            <HandCoins className="w-5 h-5" />
                            <h3 className="font-bold tracking-tight">Proiezione Stipendio Lordo Mese</h3>
                        </div>

                        <div className="flex items-baseline gap-2 text-slate-900">
                            <span className="text-5xl font-black tracking-tighter">€ {financials.expectedSalaryGross.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
                        </div>

                        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-green-200/50 pt-6">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Base</p>
                                <p className="text-lg font-bold text-slate-700">€ {baseSalaryEur}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Bonus Mese Stimato</p>
                                <p className="text-lg font-bold text-green-700">+ € {financials.earnedMonthBonus}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Storico Passate Settimane</p>
                                <p className="text-lg font-bold text-slate-700">€ {financials.historicalBonus}</p>
                            </div>
                        </div>
                    </div>

                    {/* Widget settimanale incassato (Gamification Presenze) */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3 ml-1 flex items-center gap-2">
                            <Target className="w-4 h-4 text-orange-500" /> Obiettivo in Corso
                        </h3>
                        <WeeklyBonusWidget userId={profileData.id} />
                    </div>

                </div>

            </div>

            {/* ROADMAP / BATTLE PASS */}
            <div className="border border-slate-200 bg-white rounded-2xl shadow-sm p-6 overflow-hidden">
                <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-6">
                    <Trophy className="w-5 h-5 text-yellow-500" />
                    Prossimi Traguardi
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {roadmap.map((r: any, i: number) => (
                        <div key={i} className="border border-slate-100 bg-slate-50 rounded-xl p-4 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center border-2 border-yellow-200 shadow-sm text-yellow-700 font-black">
                                {r.level}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Al Livello {r.level}</p>
                                <p className="text-sm font-bold text-slate-800 flex items-center gap-1">
                                    Sblocchi <Coins className="w-4 h-4 text-yellow-500" /> {r.rewardCoins} Coins
                                </p>
                            </div>
                        </div>
                    ))}
                    {roadmap.length === 0 && (
                        <div className="col-span-3 text-center p-8 text-slate-400 font-medium">
                            Sei un Dio. Hai sbloccato tutte le roadmap disponibili.
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
