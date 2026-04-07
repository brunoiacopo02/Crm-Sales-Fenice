'use client';

import { useEffect, useState } from 'react';
import Image from "next/image"
import {
    Zap, Coins, Trophy, CalendarDays, TrendingUp, HandCoins, Target, ArrowUpCircle, Flame, Crown, Star, Sparkles, Settings, Phone, Users, Award
} from 'lucide-react';
import { WeeklyBonusWidget } from "@/components/WeeklyBonusWidget"
import AchievementShowcase from "@/components/AchievementShowcase"
import TitleSelector from "@/components/TitleSelector"
import { AnimationToggle } from "@/components/AnimationToggle"
import { triggerCelebration, getAnimationsEnabled } from '@/lib/animationUtils';
import dynamic from "next/dynamic"
const CelebrationOverlay = dynamic(() => import("@/components/CelebrationOverlay").then(m => ({ default: m.CelebrationOverlay })), { ssr: false })
import type { UnlockedTitle } from "@/app/actions/titleActions"

type LifetimeStats = {
    totalCalls: number;
    totalAppointments: number;
    level: number;
    totalXp: number;
    currentStreak: number;
    totalCoins: number;
}

type StreakInfo = {
    streakCount: number;
    lastStreakDate: string | null;
    isActiveToday: boolean;
    multiplier: number;
    tierLabel: string;
}

type QuestItem = {
    progressId: string;
    title: string;
    description: string;
    type: string;
    currentValue: number;
    targetValue: number;
    completed: boolean;
    rewardXp: number;
    rewardCoins: number;
}

export default function ProfileClient({ profileData, achievements = [], titleData, lifetimeStats, streakInfo, activeQuests }: {
    profileData: any;
    achievements?: any[];
    titleData?: { titles: UnlockedTitle[]; activeTitle: string | null };
    lifetimeStats?: LifetimeStats;
    streakInfo?: StreakInfo;
    activeQuests?: { daily: QuestItem[]; weekly: QuestItem[] };
}) {

    const {
        displayName, gdoCode,
        baseSalaryEur, level, experience,
        stage, targetXpForNext, financials, roadmap
    } = profileData;

    const progressPerc = Math.min((experience / targetXpForNext) * 100, 100);

    // Fenice evolution transition: detect stage change and trigger pulse
    const [showEvolutionPulse, setShowEvolutionPulse] = useState(false);
    const [showEvolutionRing, setShowEvolutionRing] = useState(false);

    useEffect(() => {
        const lastStage = localStorage.getItem('crm-fenice-last-stage');
        if (lastStage && lastStage !== stage.name && getAnimationsEnabled()) {
            setShowEvolutionPulse(true);
            setShowEvolutionRing(true);
            triggerCelebration('fire');
            setTimeout(() => {
                setShowEvolutionPulse(false);
                setShowEvolutionRing(false);
            }, 2000);
        }
        localStorage.setItem('crm-fenice-last-stage', stage.name);
    }, [stage.name]);

    return (
        <div className="flex-1 space-y-8 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">
            <CelebrationOverlay />

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
                    <div className="text-ash-500 mt-1 flex items-center gap-2">
                        GDO {gdoCode} - {displayName}
                        {titleData?.activeTitle && (
                            <div className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-purple-200">
                                <Crown className="w-3 h-3" />
                                {titleData.activeTitle}
                            </div>
                        )}
                    </div>
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
                    <div className={`relative w-36 h-36 rounded-full border-4 border-ember-400/60 shadow-glow-ember bg-gradient-to-br from-ember-800 to-brand-charcoal flex items-center justify-center mb-6 mt-4 z-10 transition-transform duration-500 ${showEvolutionPulse ? 'animate-evolution-pulse' : ''}`}>
                        {stage.imageUrl ? (
                            <Image src={stage.imageUrl} alt={stage.name} width={144} height={144} className="w-full h-full rounded-full object-cover transition-opacity duration-700" />
                        ) : (
                            <ArrowUpCircle className="w-16 h-16 text-ember-400" />
                        )}
                        {/* Level Badge */}
                        <div className="absolute -bottom-3 bg-gradient-to-r from-brand-orange to-brand-orange-500 text-brand-charcoal font-bold text-sm px-4 py-1 rounded-full border-2 border-brand-orange-300 shadow-glow-orange">
                            Liv. {level}
                        </div>
                        {/* Glow ring */}
                        <div className="absolute inset-0 rounded-full animate-glow-pulse border-2 border-ember-400/30"></div>
                        {/* Evolution ring burst on stage change */}
                        {showEvolutionRing && (
                            <div
                                className="absolute inset-0 rounded-full border-4 border-brand-orange/60"
                                style={{ animation: 'evolution-ring 1.5s ease-out forwards' }}
                            />
                        )}
                    </div>

                    <h2 className="text-2xl font-bold text-white tracking-tight z-10">{stage.name}</h2>
                    <div className="text-sm font-medium text-ember-300/80 mb-4 z-10">Stadio Evolutivo</div>

                    {/* Streak Counter in Profile */}
                    {streakInfo && (
                        <div className="w-full bg-white/5 border border-white/10 rounded-xl p-3 mb-4 z-10">
                            <div className="flex items-center justify-center gap-2 mb-1">
                                <Flame className={`h-5 w-5 ${streakInfo.streakCount >= 7 ? 'text-ember-400 animate-glow-pulse' : streakInfo.streakCount > 0 ? 'text-brand-orange-400' : 'text-ash-500'}`} />
                                <span className="text-2xl font-black text-white">{streakInfo.streakCount}</span>
                                <span className="text-xs font-bold text-ash-400 uppercase">giorni streak</span>
                            </div>
                            {streakInfo.multiplier > 1 && (
                                <div className="text-center">
                                    <span className="text-[10px] font-bold bg-gradient-to-r from-ember-500 to-brand-orange px-2 py-0.5 rounded-full text-white">
                                        x{streakInfo.multiplier} MULTIPLIER
                                    </span>
                                </div>
                            )}
                            <div className="text-[10px] text-ash-500 text-center mt-1">{streakInfo.tierLabel}</div>
                        </div>
                    )}

                    {/* XP Bar */}
                    <div className="w-full space-y-2 z-10">
                        <div className="flex justify-between text-xs font-bold">
                            <div className="text-brand-orange-300">{experience} XP</div>
                            <div className="text-ash-400">{targetXpForNext} XP</div>
                        </div>
                        <div className="relative w-full h-3.5 bg-ash-800 rounded-full overflow-hidden shadow-inner border border-ash-700">
                            <div
                                className="absolute top-0 left-0 h-full bg-gradient-to-r from-ember-500 via-brand-orange to-gold-400 rounded-full transition-[width] duration-1000 ease-out shadow-[0_0_12px_rgba(255,190,130,0.4)]"
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

            {/* LIFETIME STATS */}
            {lifetimeStats && (
                <div className="border border-ash-200/60 bg-white rounded-2xl shadow-card p-6 animate-fade-in" style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}>
                    <h3 className="text-lg font-bold text-ash-800 tracking-tight flex items-center gap-2 mb-6">
                        <div className="p-2 rounded-xl bg-brand-orange-100 border border-brand-orange-200">
                            <TrendingUp className="w-5 h-5 text-brand-orange-500" />
                        </div>
                        Statistiche Lifetime
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <Phone className="h-5 w-5 text-blue-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.totalCalls.toLocaleString()}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">Chiamate</div>
                        </div>
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <CalendarDays className="h-5 w-5 text-emerald-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.totalAppointments.toLocaleString()}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">Appuntamenti</div>
                        </div>
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <Zap className="h-5 w-5 text-gold-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.totalXp.toLocaleString()}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">XP Totale</div>
                        </div>
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <Flame className="h-5 w-5 text-ember-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.level}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">Livello</div>
                        </div>
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <Flame className="h-5 w-5 text-brand-orange-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.currentStreak}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">Streak</div>
                        </div>
                        <div className="bg-gradient-to-br from-ash-50 to-white border border-ash-200/60 rounded-xl p-4 text-center">
                            <Coins className="h-5 w-5 text-gold-500 mx-auto mb-2" />
                            <div className="text-2xl font-black text-ash-800">{lifetimeStats.totalCoins.toLocaleString()}</div>
                            <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-1">Coins</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ACTIVE QUESTS SUMMARY */}
            {activeQuests && (activeQuests.daily.length > 0 || activeQuests.weekly.length > 0) && (
                <div className="border border-ash-200/60 bg-white rounded-2xl shadow-card p-6 animate-fade-in" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
                    <h3 className="text-lg font-bold text-ash-800 tracking-tight flex items-center gap-2 mb-6">
                        <div className="p-2 rounded-xl bg-ember-100 border border-ember-200">
                            <Award className="w-5 h-5 text-ember-500" />
                        </div>
                        Quest Attive
                        <span className="text-xs font-bold text-ash-400 ml-auto">
                            {activeQuests.daily.filter(q => q.completed).length}/{activeQuests.daily.length} giornaliere · {activeQuests.weekly.filter(q => q.completed).length}/{activeQuests.weekly.length} settimanali
                        </span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[...activeQuests.daily, ...activeQuests.weekly].map((quest) => {
                            const progress = quest.targetValue > 0 ? Math.min((quest.currentValue / quest.targetValue) * 100, 100) : 0;
                            return (
                                <div
                                    key={quest.progressId}
                                    className={`border rounded-xl p-3 flex items-center gap-3 ${quest.completed
                                        ? 'border-gold-200/60 bg-gold-50/50'
                                        : 'border-ash-200/60 bg-ash-50/30'
                                        }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className={`text-sm font-semibold truncate ${quest.completed ? 'text-gold-700' : 'text-ash-800'}`}>
                                                {quest.title}
                                            </div>
                                            <div className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${quest.type === 'daily'
                                                ? 'bg-blue-100 text-blue-600 border border-blue-200'
                                                : 'bg-purple-100 text-purple-600 border border-purple-200'
                                                }`}>
                                                {quest.type === 'daily' ? 'D' : 'S'}
                                            </div>
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-2">
                                            <div className="flex-1 h-1.5 bg-ash-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-700 ${quest.completed
                                                        ? 'bg-gradient-to-r from-gold-400 to-gold-500'
                                                        : 'bg-gradient-to-r from-ember-400 to-brand-orange'
                                                        }`}
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-bold text-ash-500 whitespace-nowrap">
                                                {quest.currentValue}/{quest.targetValue}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <div className="text-[10px] font-bold text-ember-500">{quest.rewardXp} XP</div>
                                        <div className="text-[10px] font-bold text-gold-500">{quest.rewardCoins} <Coins className="inline h-2.5 w-2.5" /></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

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

            {/* TITLE SELECTOR */}
            {titleData && (
                <TitleSelector
                    titles={titleData.titles}
                    activeTitle={titleData.activeTitle}
                    userId={profileData.id}
                />
            )}

            {/* BADGE & ACHIEVEMENT SHOWCASE */}
            {achievements.length > 0 && (
                <AchievementShowcase achievements={achievements} />
            )}

            {/* IMPOSTAZIONI ANIMAZIONI */}
            <div className="animate-fade-in" style={{ animationDelay: '300ms', animationFillMode: 'backwards' }}>
                <h3 className="text-sm font-bold text-ash-800 uppercase tracking-wider mb-3 ml-1 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-ash-500" /> Impostazioni
                </h3>
                <AnimationToggle />
            </div>

        </div>
    );
}
