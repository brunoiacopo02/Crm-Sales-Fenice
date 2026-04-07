'use client';

import {
    Zap, Coins, Trophy, CalendarDays, TrendingUp, HandCoins, Target, ArrowUpCircle, Flame, Crown, Star, Sparkles
} from 'lucide-react';
import { WeeklyBonusWidget } from "@/components/WeeklyBonusWidget"
import AchievementShowcase from "@/components/AchievementShowcase"

export default function ProfileClient({ profileData, achievements = [] }: { profileData: any; achievements?: any[] }) {

    const {
        displayName, gdoCode,
        baseSalaryEur, level, experience,
        stage, targetXpForNext, financials, roadmap
    } = profileData;

    const progressPerc = Math.min((experience / targetXpForNext) * 100, 100);

    return (
        <div className="flex-1 space-y-8 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">

            {/* Header Profilo e Level */}
            <div className="flex items-center justify-between animate-fade-in">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-ash-800 flex items-center gap-3">
                        <Flame className="h-7 w-7 text-ember-500" />
                        Lobby Personale
                        <div className={`text-xs px-3 py-1 rounded-full border uppercase tracking-wider font-bold ${stage.badgeClass}`}>
                            {stage.name}
                        </div>
                    </h1>
                    <div className="text-ash-500 mt-1">GDO {gdoCode} - {displayName}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* COLONNA 1: Avatar e XP (RPG) — Fenice Fire Theme */}
                <div className="col-span-1 border border-ember-200/60 bg-gradient-to-b from-brand-charcoal via-ash-900 to-ember-900/80 rounded-2xl shadow-elevated p-6 flex flex-col items-center text-center relative overflow-hidden">
                    {/* Fire/flame decorative elements */}
                    <div className="absolute top-0 left-0 w-48 h-48 bg-ember-500/15 rounded-full blur-3xl -translate-y-1/4 -translate-x-1/4 pointer-events-none"></div>
                    <div className="absolute top-0 right-0 w-40 h-40 bg-brand-orange/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none"></div>
                    <div className="absolute bottom-0 left-1/2 w-64 h-32 bg-gold-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>

                    {/* Avatar */}
                    <div className="relative w-36 h-36 rounded-full border-4 border-ember-400/60 shadow-glow-ember bg-gradient-to-br from-ember-800 to-brand-charcoal flex items-center justify-center mb-6 mt-4 z-10">
                        {stage.imageUrl ? (
                            <img src={stage.imageUrl} alt={stage.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                            <ArrowUpCircle className="w-16 h-16 text-ember-400" />
                        )}
                        {/* Level Badge */}
                        <div className="absolute -bottom-3 bg-gradient-to-r from-brand-orange to-brand-orange-500 text-brand-charcoal font-bold text-sm px-4 py-1 rounded-full border-2 border-brand-orange-300 shadow-glow-orange">
                            Liv. {level}
                        </div>
                        {/* Glow ring */}
                        <div className="absolute inset-0 rounded-full animate-glow-pulse border-2 border-ember-400/30"></div>
                    </div>

                    <h2 className="text-2xl font-bold text-white tracking-tight z-10">{stage.name}</h2>
                    <div className="text-sm font-medium text-ember-300/80 mb-6 z-10">Stadio Evolutivo</div>

                    {/* XP Bar */}
                    <div className="w-full space-y-2 z-10">
                        <div className="flex justify-between text-xs font-bold">
                            <div className="text-brand-orange-300">{experience} XP</div>
                            <div className="text-ash-400">{targetXpForNext} XP</div>
                        </div>
                        <div className="relative w-full h-3.5 bg-ash-800 rounded-full overflow-hidden shadow-inner border border-ash-700">
                            <div
                                className="absolute top-0 left-0 h-full bg-gradient-to-r from-ember-500 via-brand-orange to-gold-400 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(255,190,130,0.4)]"
                                style={{ width: `${progressPerc}%` }}
                            ></div>
                        </div>
                        <div className="text-xs text-ash-500 font-medium text-right">Mancano {targetXpForNext - experience} XP al Liv. {level + 1}</div>
                    </div>

                    {/* Mini stats */}
                    <div className="mt-6 w-full grid grid-cols-2 gap-3 z-10">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                            <Flame className="h-4 w-4 text-ember-400 mx-auto mb-1" />
                            <div className="text-lg font-bold text-white">{level}</div>
                            <div className="text-[10px] uppercase tracking-wider text-ash-500 font-bold">Livello</div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                            <Zap className="h-4 w-4 text-gold-400 mx-auto mb-1" />
                            <div className="text-lg font-bold text-white">{experience}</div>
                            <div className="text-[10px] uppercase tracking-wider text-ash-500 font-bold">XP</div>
                        </div>
                    </div>
                </div>

                {/* COLONNA 2: Finanza e Widget */}
                <div className="col-span-1 lg:col-span-2 space-y-8">

                    {/* Finanze Reali Mese */}
                    <div className="border border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-emerald-100/30 rounded-2xl shadow-card p-6 relative overflow-hidden animate-fade-in">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-200/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

                        <div className="flex items-center gap-2 text-emerald-800 mb-4">
                            <div className="p-2 rounded-xl bg-emerald-100 border border-emerald-200">
                                <HandCoins className="w-5 h-5" />
                            </div>
                            <h3 className="font-bold tracking-tight">Proiezione Stipendio Lordo Mese</h3>
                        </div>

                        <div className="flex items-baseline gap-2 text-ash-900">
                            <div className="text-5xl font-black tracking-tighter">€ {financials.expectedSalaryGross.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</div>
                        </div>

                        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-emerald-200/50 pt-6">
                            <div>
                                <div className="text-xs font-semibold text-ash-500 uppercase">Base</div>
                                <div className="text-lg font-bold text-ash-700">€ {baseSalaryEur}</div>
                            </div>
                            <div>
                                <div className="text-xs font-semibold text-ash-500 uppercase">Bonus Mese Stimato</div>
                                <div className="text-lg font-bold text-emerald-700">+ € {financials.earnedMonthBonus}</div>
                            </div>
                            <div>
                                <div className="text-xs font-semibold text-ash-500 uppercase">Storico Passate Settimane</div>
                                <div className="text-lg font-bold text-ash-700">€ {financials.historicalBonus}</div>
                            </div>
                        </div>
                    </div>

                    {/* Widget settimanale incassato (Gamification Presenze) */}
                    <div className="animate-fade-in" style={{ animationDelay: '100ms', animationFillMode: 'backwards' }}>
                        <h3 className="text-sm font-bold text-ash-800 uppercase tracking-wider mb-3 ml-1 flex items-center gap-2">
                            <Target className="w-4 h-4 text-brand-orange-500" /> Obiettivo in Corso
                        </h3>
                        <WeeklyBonusWidget userId={profileData.id} />
                    </div>

                </div>

            </div>

            {/* ROADMAP / BATTLE PASS */}
            <div className="border border-ash-200/60 bg-white rounded-2xl shadow-card p-6 overflow-hidden animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'backwards' }}>
                <h3 className="text-lg font-bold text-ash-800 tracking-tight flex items-center gap-2 mb-6">
                    <div className="p-2 rounded-xl bg-gold-100 border border-gold-200">
                        <Trophy className="w-5 h-5 text-gold-500" />
                    </div>
                    Prossimi Traguardi
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {roadmap.map((r: any, i: number) => (
                        <div
                            key={i}
                            className="border border-gold-200/60 bg-gradient-to-br from-gold-50 to-brand-orange-50/30 rounded-xl p-4 flex items-center gap-4 hover:shadow-card hover:border-gold-300 transition-all duration-200 animate-fade-in"
                            style={{ animationDelay: `${(i + 1) * 80}ms`, animationFillMode: 'backwards' }}
                        >
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-gold-100 to-gold-200 flex items-center justify-center border-2 border-gold-300 shadow-glow-gold text-gold-700 font-black text-lg flex-shrink-0">
                                {r.level}
                            </div>
                            <div>
                                <div className="text-xs font-bold text-ash-500 uppercase tracking-widest">Al Livello {r.level}</div>
                                <div className="text-sm font-bold text-ash-800 flex items-center gap-1.5 mt-0.5">
                                    Sblocchi <Coins className="w-4 h-4 text-gold-500" /> <span className="text-gold-600">{r.rewardCoins} Coins</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {roadmap.length === 0 && (
                        <div className="col-span-3 text-center p-8 text-ash-400 font-medium">
                            <Crown className="h-8 w-8 text-gold-400 mx-auto mb-2" />
                            <div>Sei un Dio. Hai sbloccato tutte le roadmap disponibili.</div>
                        </div>
                    )}
                </div>
            </div>

            {/* BADGE & ACHIEVEMENT SHOWCASE */}
            {achievements.length > 0 && (
                <AchievementShowcase achievements={achievements} />
            )}

        </div>
    );
}
