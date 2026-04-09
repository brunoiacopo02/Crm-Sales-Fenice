'use client';

import { useEffect, useState } from 'react';
import Image from "next/image"
import {
    Zap, Coins, Trophy, CalendarDays, TrendingUp, HandCoins, Target, ArrowUpCircle, Flame, Crown, Star, Sparkles, Settings, Phone, Users, Award, Gift, Shield, Sword, Gem, Shirt, ChevronDown, ChevronUp
} from 'lucide-react';
import { WeeklyBonusWidget } from "@/components/WeeklyBonusWidget"
import AchievementShowcase from "@/components/AchievementShowcase"
import TitleSelector from "@/components/TitleSelector"
import { AnimationToggle } from "@/components/AnimationToggle"
import { SoundToggle } from "@/components/SoundToggle"
import { SocialComparisonBadge } from "@/components/SocialComparisonBadge"
import { SafeWrapper } from "@/components/SafeWrapper"
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

type EquippedItemInfo = {
    id: string;
    name: string;
    description: string;
    cssValue: string;
}

export default function ProfileClient({ profileData, achievements = [], titleData, lifetimeStats, streakInfo, activeQuests, equippedItems = [], equippedItemInfo }: {
    profileData: any;
    achievements?: any[];
    titleData?: { titles: UnlockedTitle[]; activeTitle: string | null };
    lifetimeStats?: LifetimeStats;
    streakInfo?: StreakInfo;
    activeQuests?: { daily: QuestItem[]; weekly: QuestItem[] };
    equippedItems?: Array<{ id: string; name: string; description: string; cssValue: string }>;
    equippedItemInfo?: EquippedItemInfo | null;
}) {

    const {
        displayName, gdoCode, role,
        baseSalaryEur, level, experience,
        stage, targetXpForNext, financials, roadmap,
        xpMilestones, totalThreeLevelXp, upcomingRewards,
    } = profileData;

    // Enhanced XP bar: spans 3 levels
    const extendedProgressPerc = totalThreeLevelXp > 0 ? Math.min((experience / totalThreeLevelXp) * 100, 100) : 0;
    const milestoneMarkers = (xpMilestones || []).map((m: any) => ({
        ...m,
        position: totalThreeLevelXp > 0 ? (m.xpCumulative / totalThreeLevelXp) * 100 : 0,
        isPassed: experience >= m.xpCumulative,
    }));

    const [hoveredMilestone, setHoveredMilestone] = useState<number | null>(null);
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

    const animEnabled = getAnimationsEnabled();

    // Compute how many evolution stages exist vs current
    const allStages = [
        { name: 'Uovo', minLevel: 1 },
        { name: 'Pulcino', minLevel: 8 },
        { name: 'Fenice Giovane', minLevel: 18 },
        { name: 'Fenice di Fuoco', minLevel: 26 },
        { name: 'Divinità Fenice', minLevel: 35 },
    ];
    const currentStageIdx = allStages.findIndex(s => s.name === stage.name);

    return (
        <SafeWrapper>
        <div className="flex-1 pb-20 max-w-7xl mx-auto w-full">
            <CelebrationOverlay />

            {/* ═══════════════════════════════════════════════════════
                HERO BANNER — Full-width dark RPG character banner
            ═══════════════════════════════════════════════════════ */}
            <div className="relative overflow-hidden rounded-b-3xl lg:rounded-3xl lg:mx-4 lg:mt-4 bg-gradient-to-b from-[var(--color-gaming-bg-deep)] via-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-surface)] min-h-[340px] lg:min-h-[380px]">
                {/* Decorative ambient glow */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute top-0 left-1/4 w-64 h-64 bg-fire-500/8 rounded-full blur-3xl" style={animEnabled ? { animation: 'rpg-float 6s ease-in-out infinite' } : undefined} />
                    <div className="absolute bottom-0 right-1/4 w-80 h-48 bg-brand-orange/8 rounded-full blur-3xl" style={animEnabled ? { animation: 'rpg-float 8s ease-in-out infinite reverse' } : undefined} />
                    <div className="absolute top-1/3 right-10 w-40 h-40 bg-[var(--color-gaming-gold)]/6 rounded-full blur-3xl" style={animEnabled ? { animation: 'rpg-float 7s ease-in-out infinite 2s' } : undefined} />
                    {/* Subtle grid pattern overlay */}
                    <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
                </div>

                {/* CSS Fire Particles — rising embers effect */}
                {animEnabled && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        {[...Array(12)].map((_, i) => (
                            <div
                                key={`fire-${i}`}
                                className="rpg-fire-particle"
                                style={{
                                    left: `${8 + (i * 7.5)}%`,
                                    animationDelay: `${i * 0.4}s`,
                                    animationDuration: `${2 + (i % 3) * 0.8}s`,
                                    ['--drift' as string]: `${(i % 2 === 0 ? 1 : -1) * (5 + i * 2)}px`,
                                    opacity: 0,
                                }}
                            />
                        ))}
                        {[...Array(8)].map((_, i) => (
                            <div
                                key={`ember-${i}`}
                                className="rpg-ember"
                                style={{
                                    left: `${12 + (i * 10)}%`,
                                    animationDelay: `${0.3 + i * 0.5}s`,
                                    animationDuration: `${2.5 + (i % 2) * 1}s`,
                                    ['--drift' as string]: `${(i % 2 === 0 ? -1 : 1) * (3 + i * 3)}px`,
                                    opacity: 0,
                                }}
                            />
                        ))}
                    </div>
                )}

                <div className="relative z-10 flex flex-col items-center pt-8 pb-6 px-4">
                    {/* Evolution Stage Trail */}
                    <div className="flex items-center gap-1.5 mb-6">
                        {allStages.map((s, idx) => (
                            <div key={s.name} className="flex items-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full transition-all ${idx <= currentStageIdx ? 'bg-fire-400 shadow-[0_0_6px_var(--color-fire-glow)]' : 'bg-[var(--color-gaming-border)]'}`} />
                                {idx < allStages.length - 1 && (
                                    <div className={`w-6 h-0.5 ${idx < currentStageIdx ? 'bg-fire-400/60' : 'bg-[var(--color-gaming-border)]'}`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Avatar with fire ring */}
                    <div className={`relative w-32 h-32 lg:w-40 lg:h-40 rounded-full transition-transform duration-500 ${showEvolutionPulse ? 'animate-evolution-pulse' : ''}`}>
                        {/* Outer glow ring */}
                        <div className="absolute -inset-3 rounded-full" style={animEnabled ? {
                            background: 'conic-gradient(from 0deg, rgba(232,82,63,0.3), rgba(255,190,130,0.4), rgba(201,161,60,0.3), rgba(232,82,63,0.3))',
                            animation: 'rpg-ring-spin 4s linear infinite',
                        } : {
                            background: 'conic-gradient(from 0deg, rgba(232,82,63,0.3), rgba(255,190,130,0.4), rgba(201,161,60,0.3), rgba(232,82,63,0.3))',
                        }} />
                        <div className="absolute -inset-2 rounded-full bg-[var(--color-gaming-bg-deep)]" />

                        {/* Avatar image */}
                        <div className="relative w-full h-full rounded-full border-3 border-fire-400/60 bg-gradient-to-br from-[var(--color-gaming-bg-surface)] to-[var(--color-gaming-bg-deep)] flex items-center justify-center overflow-hidden">
                            {stage.imageUrl ? (
                                <Image src={stage.imageUrl} alt={stage.name} width={160} height={160} className="w-full h-full rounded-full object-cover" />
                            ) : (
                                <ArrowUpCircle className="w-16 h-16 text-ember-400" />
                            )}
                        </div>

                        {/* Level badge */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-fire-500 to-brand-orange text-white font-black text-sm px-5 py-1 rounded-full border-2 border-fire-400/60 shadow-gaming-glow-fire whitespace-nowrap">
                            LV. {level}
                        </div>

                        {/* Evolution ring burst on stage change */}
                        {showEvolutionRing && (
                            <div className="absolute inset-0 rounded-full border-4 border-brand-orange/60" style={{ animation: 'evolution-ring 1.5s ease-out forwards' }} />
                        )}
                    </div>

                    {/* Character Name & Title */}
                    <div className="mt-6 text-center">
                        <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
                            {displayName}
                        </h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <div className={`text-xs px-3 py-1 rounded-full border uppercase tracking-wider font-bold ${stage.badgeClass}`}>
                                {stage.name}
                            </div>
                            {titleData?.activeTitle && (
                                <div className="inline-flex items-center gap-1 bg-purple-500/20 text-purple-300 text-xs font-bold px-2.5 py-1 rounded-full border border-purple-500/30">
                                    <Crown className="w-3 h-3" />
                                    {titleData.activeTitle}
                                </div>
                            )}
                        </div>
                        <div className="text-[var(--color-gaming-text-muted)] text-xs mt-1.5 font-medium">GDO {gdoCode} · {role}</div>
                    </div>

                    {/* Quick Stats Bar — RPG HUD style */}
                    <div className="mt-6 flex items-center gap-4 lg:gap-6 bg-[var(--color-gaming-bg-card)]/60 backdrop-blur-sm border border-[var(--color-gaming-border)] rounded-2xl px-5 py-3">
                        <div className="flex items-center gap-1.5">
                            <Flame className={`h-4 w-4 ${streakInfo && streakInfo.streakCount >= 7 ? 'text-ember-400' : 'text-brand-orange-400'}`} />
                            <span className="text-lg font-black text-white">{streakInfo?.streakCount ?? 0}</span>
                            <span className="text-[10px] text-ash-500 uppercase font-bold hidden sm:inline">Streak</span>
                        </div>
                        <div className="w-px h-6 bg-white/10" />
                        <div className="flex items-center gap-1.5">
                            <Zap className="h-4 w-4 text-gold-400" />
                            <span className="text-lg font-black text-white">{experience}</span>
                            <span className="text-[10px] text-ash-500 uppercase font-bold hidden sm:inline">XP</span>
                        </div>
                        <div className="w-px h-6 bg-white/10" />
                        <div className="flex items-center gap-1.5">
                            <Coins className="h-4 w-4 text-gold-400" />
                            <span className="text-lg font-black text-white">{profileData.walletCoins ?? 0}</span>
                            <span className="text-[10px] text-ash-500 uppercase font-bold hidden sm:inline">Coins</span>
                        </div>
                        {streakInfo && streakInfo.multiplier > 1 && (
                            <>
                                <div className="w-px h-6 bg-white/10" />
                                <div className="text-[10px] font-bold bg-gradient-to-r from-ember-500 to-brand-orange px-2.5 py-1 rounded-full text-white">
                                    x{streakInfo.multiplier} MULT
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════
                XP PROGRESS BAR — Below hero, full width
            ═══════════════════════════════════════════════════════ */}
            <div className="mx-4 lg:mx-8 -mt-1 relative z-20">
                <div className="bg-gradient-to-r from-[var(--color-gaming-bg-deep)] via-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-deep)] rounded-2xl border border-[var(--color-gaming-border)] p-4 shadow-gaming-elevated">
                    <div className="flex justify-between text-xs font-bold mb-2">
                        <div className="text-brand-orange-300 flex items-center gap-1">
                            <Zap className="w-3 h-3" /> {experience} / {targetXpForNext} XP
                        </div>
                        <div className="text-ash-400">Prossimi 3 livelli → Liv. {level + 3}</div>
                    </div>
                    <div className="relative w-full h-5 bg-[var(--color-gaming-bg-deep)] rounded-full overflow-hidden shadow-inner border border-[var(--color-gaming-border)]">
                        {/* Shimmer */}
                        <div className="absolute top-0 h-full w-full rounded-full" style={{
                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,190,130,0.06) 40%, rgba(255,190,130,0.12) 50%, rgba(255,190,130,0.06) 60%, transparent 100%)',
                            backgroundSize: '200% 100%',
                            animation: animEnabled ? 'xp-shimmer 3s ease-in-out infinite' : 'none',
                        }} />
                        {/* Fill */}
                        <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-fire-500 via-brand-orange to-[var(--color-gaming-gold)] rounded-full transition-[width] duration-1000 ease-out shadow-[0_0_12px_var(--color-fire-glow)]"
                            style={{ width: `${extendedProgressPerc}%` }}
                        />
                        {/* Milestone markers */}
                        {milestoneMarkers.map((marker: any, idx: number) => (
                            <div
                                key={idx}
                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20"
                                style={{ left: `${marker.position}%` }}
                                onMouseEnter={() => setHoveredMilestone(idx)}
                                onMouseLeave={() => setHoveredMilestone(null)}
                            >
                                <div className={`w-3.5 h-3.5 rotate-45 border-2 cursor-pointer transition-all duration-300 ${
                                    marker.isPassed
                                        ? 'bg-gold-400 border-gold-300 shadow-[0_0_8px_rgba(201,161,60,0.6)]'
                                        : marker.hasReward
                                            ? 'bg-ember-500 border-ember-400 shadow-[0_0_6px_rgba(234,88,12,0.4)]'
                                            : 'bg-ash-600 border-ash-500'
                                }`} style={marker.isPassed && animEnabled ? { animation: 'xp-marker-burst 0.6s ease-out forwards', animationDelay: `${0.8 + idx * 0.3}s` } : undefined} />
                                {marker.hasReward && (
                                    <div className={`absolute -top-5 left-1/2 -translate-x-1/2 ${marker.isPassed ? 'text-gold-400' : 'text-ash-400'}`}>
                                        {marker.rewardType === 'coins' ? <Coins className="w-3 h-3" /> : marker.rewardType === 'evolution' ? <Flame className="w-3 h-3" /> : marker.rewardType === 'title' ? <Crown className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                                    </div>
                                )}
                                {hoveredMilestone === idx && (
                                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-ash-900 border border-ash-700 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap z-30 pointer-events-none">
                                        Liv. {marker.level}{marker.rewards.length > 0 ? `: ${marker.rewards[0]}` : ''}
                                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-ash-900" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {/* Level labels */}
                    <div className="relative w-full h-4 mt-1">
                        {milestoneMarkers.map((marker: any, idx: number) => (
                            <div key={idx} className={`absolute text-[9px] font-bold -translate-x-1/2 ${marker.isPassed ? 'text-gold-400' : 'text-ash-500'}`} style={{ left: `${marker.position}%` }}>
                                {marker.level}
                            </div>
                        ))}
                    </div>
                    <div className="text-[11px] text-ash-500 font-medium text-right mt-1">Mancano <span className="text-brand-orange-300 font-bold">{targetXpForNext - experience} XP</span> al Liv. {level + 1}</div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════
                MAIN CONTENT — Two-column RPG layout
            ═══════════════════════════════════════════════════════ */}
            <div className="px-4 lg:px-8 mt-6 space-y-6">

                {/* STAT CARDS — RPG Character Sheet */}
                {lifetimeStats && (
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 animate-fade-in">
                        {[
                            { icon: Phone, label: 'Chiamate', value: lifetimeStats.totalCalls.toLocaleString(), color: 'text-blue-400', bg: 'from-blue-500/10 to-blue-600/5', border: 'border-blue-500/20' },
                            { icon: CalendarDays, label: 'Appuntamenti', value: lifetimeStats.totalAppointments.toLocaleString(), color: 'text-emerald-400', bg: 'from-emerald-500/10 to-emerald-600/5', border: 'border-emerald-500/20' },
                            { icon: Flame, label: 'Livello', value: lifetimeStats.level.toString(), color: 'text-ember-400', bg: 'from-ember-500/10 to-ember-600/5', border: 'border-ember-500/20' },
                            { icon: Zap, label: 'XP Totale', value: lifetimeStats.totalXp.toLocaleString(), color: 'text-gold-400', bg: 'from-gold-500/10 to-gold-600/5', border: 'border-gold-500/20' },
                            { icon: Flame, label: 'Streak', value: lifetimeStats.currentStreak.toString(), color: 'text-brand-orange-400', bg: 'from-brand-orange-500/10 to-brand-orange-600/5', border: 'border-brand-orange-500/20' },
                            { icon: Coins, label: 'Coins', value: lifetimeStats.totalCoins.toLocaleString(), color: 'text-gold-400', bg: 'from-gold-500/10 to-gold-600/5', border: 'border-gold-500/20' },
                        ].map((stat, idx) => (
                            <div
                                key={stat.label}
                                className={`relative overflow-hidden bg-gradient-to-br ${stat.bg} border ${stat.border} rounded-xl p-3 text-center group hover:scale-[1.03] transition-transform duration-200 animate-fade-in`}
                                style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
                            >
                                <stat.icon className={`h-4 w-4 ${stat.color} mx-auto mb-1.5 opacity-80`} />
                                <div className="text-xl font-black text-[var(--color-gaming-text)]">{stat.value}</div>
                                <div className="text-[9px] uppercase font-bold tracking-wider text-[var(--color-gaming-text-muted)] mt-0.5">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Social Comparison Badge */}
                <SafeWrapper>
                    <SocialComparisonBadge userId={profileData.id} role={role} />
                </SafeWrapper>

                {/* TWO-COLUMN: Upcoming Rewards + Streak | Financials + Weekly */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* LEFT: Upcoming Rewards + Streak + Equipped Items */}
                    <div className="space-y-5">
                        {/* Upcoming Rewards */}
                        {upcomingRewards && upcomingRewards.length > 0 && (
                            <div className="border border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card p-5 animate-fade-in">
                                <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-[var(--color-gaming-gold)]/10 border border-[var(--color-gaming-gold)]/20">
                                        <Gift className="w-4 h-4 text-[var(--color-gaming-gold)]" />
                                    </div>
                                    Prossimi Premi
                                </h3>
                                <div className="space-y-2">
                                    {(upcomingRewards as any[]).map((reward: any, idx: number) => {
                                        const typeStyles = reward.type === 'coins'
                                            ? 'border-[var(--color-gaming-gold)]/25 bg-gradient-to-r from-[var(--color-gaming-gold)]/8 to-transparent'
                                            : reward.type === 'evolution'
                                                ? 'border-fire-400/25 bg-gradient-to-r from-fire-500/8 to-transparent'
                                                : 'border-purple-500/25 bg-gradient-to-r from-purple-500/8 to-transparent';
                                        const iconColor = reward.type === 'coins' ? 'text-[var(--color-gaming-gold)]' : reward.type === 'evolution' ? 'text-fire-400' : 'text-purple-400';
                                        return (
                                            <div key={idx} className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${typeStyles} hover:scale-[1.01] transition-transform duration-200`}>
                                                <div className={`flex-shrink-0 ${iconColor}`}>
                                                    {reward.type === 'coins' ? <Coins className="w-5 h-5" /> : reward.type === 'evolution' ? <Flame className="w-5 h-5" /> : <Crown className="w-5 h-5" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-bold text-[var(--color-gaming-text)] truncate">{reward.label}</div>
                                                    <div className="text-[10px] text-[var(--color-gaming-text-muted)]">{reward.detail}</div>
                                                </div>
                                                <div className="text-xs font-bold text-[var(--color-gaming-text-muted)] bg-[var(--color-gaming-bg-surface)] px-2 py-1 rounded-lg flex-shrink-0 border border-[var(--color-gaming-border)]">Liv. {reward.level}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Streak & Multiplier Card — Enhanced with animated flame */}
                        {streakInfo && (
                            <div className="relative overflow-hidden border border-[var(--color-gaming-border)] bg-gradient-to-br from-[var(--color-gaming-bg)] via-[var(--color-gaming-bg-card)] to-[var(--color-gaming-bg-surface)] rounded-2xl shadow-gaming-card p-5 animate-fade-in">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-fire-500/8 rounded-full blur-3xl pointer-events-none" />
                                {/* Warm glow behind streak count when active */}
                                {streakInfo.streakCount >= 3 && (
                                    <div className="absolute top-1/2 left-6 -translate-y-1/2 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{
                                        background: streakInfo.streakCount >= 14 ? 'rgba(168,85,247,0.12)' : streakInfo.streakCount >= 7 ? 'rgba(234,88,12,0.12)' : 'rgba(255,190,130,0.1)',
                                    }} />
                                )}
                                <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 flex items-center gap-2 relative z-10">
                                    <div className="p-1.5 rounded-lg bg-ember-500/15 border border-ember-500/25">
                                        <Flame className="w-4 h-4 text-ember-400" />
                                    </div>
                                    Streak & Multiplier
                                </h3>
                                <div className="flex items-center gap-5 relative z-10">
                                    {/* Animated flame + counter */}
                                    <div className="text-center relative">
                                        {/* Animated flame icon behind counter */}
                                        <div className="relative inline-flex items-center justify-center">
                                            <Flame
                                                className={`absolute -top-3 w-10 h-10 ${
                                                    streakInfo.streakCount >= 14 ? 'text-purple-400' :
                                                    streakInfo.streakCount >= 7 ? 'text-ember-400' :
                                                    streakInfo.streakCount >= 3 ? 'text-brand-orange' :
                                                    'text-[var(--color-gaming-text-muted)]'
                                                }`}
                                                style={animEnabled && streakInfo.streakCount >= 3 ? {
                                                    animation: 'rpg-flame-flicker 1.5s ease-in-out infinite',
                                                    filter: streakInfo.streakCount >= 7 ? 'drop-shadow(0 0 6px rgba(234,88,12,0.5))' : 'drop-shadow(0 0 4px rgba(255,190,130,0.4))',
                                                } : undefined}
                                            />
                                            <div className={`text-4xl font-black relative z-10 mt-3 ${
                                                streakInfo.streakCount >= 14 ? 'text-purple-400' :
                                                streakInfo.streakCount >= 7 ? 'text-ember-400' :
                                                streakInfo.streakCount > 0 ? 'text-brand-orange-300' : 'text-[var(--color-gaming-text-muted)]'
                                            }`}>
                                                {streakInfo.streakCount}
                                            </div>
                                        </div>
                                        <div className="text-[10px] text-[var(--color-gaming-text-muted)] uppercase font-bold mt-1">Giorni</div>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white">{streakInfo.tierLabel}</span>
                                            {streakInfo.multiplier > 1 && (
                                                <div className="text-xs font-bold bg-gradient-to-r from-ember-500 to-brand-orange px-3 py-1 rounded-full text-white shadow-[0_0_8px_rgba(255,107,26,0.3)]">
                                                    x{streakInfo.multiplier}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`text-[11px] ${streakInfo.isActiveToday ? 'text-emerald-400' : 'text-[var(--color-gaming-text-muted)]'}`}>
                                            {streakInfo.isActiveToday ? '✓ Streak attiva oggi' : 'Completa una quest per mantenere la streak'}
                                        </div>
                                        {/* Mini streak day indicators */}
                                        {streakInfo.streakCount > 0 && (
                                            <div className="flex items-center gap-1 mt-1">
                                                {[3, 7, 14].map(milestone => (
                                                    <div key={milestone} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                                        streakInfo.streakCount >= milestone
                                                            ? milestone >= 14 ? 'border-purple-500/40 bg-purple-500/15 text-purple-400'
                                                            : milestone >= 7 ? 'border-ember-500/40 bg-ember-500/15 text-ember-400'
                                                            : 'border-brand-orange/40 bg-brand-orange/15 text-brand-orange-300'
                                                            : 'border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-deep)] text-[var(--color-gaming-text-muted)]'
                                                    }`}>
                                                        {milestone}g
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Equipped Cosmetics */}
                        {equippedItems.length > 0 && (
                            <div className="border border-purple-500/20 bg-gradient-to-br from-purple-500/8 to-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card p-5 animate-fade-in">
                                <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-purple-500/15 border border-purple-500/25">
                                        <Gem className="w-4 h-4 text-purple-400" />
                                    </div>
                                    Cosmetici Equipaggiati
                                </h3>
                                <div className="space-y-2">
                                    {equippedItems.map((item) => {
                                        const isEquipped = equippedItemInfo?.id === item.id;
                                        const cssType = item.cssValue.startsWith('skin-avatar-') ? 'Avatar' : item.cssValue.startsWith('skin-theme-') ? 'Tema' : item.cssValue.startsWith('skin-effect-') ? 'Effetto' : 'Cosmetico';
                                        return (
                                            <div key={item.id} className={`flex items-center gap-3 border rounded-xl px-4 py-3 transition-all duration-200 ${isEquipped ? 'border-purple-500/40 bg-purple-500/10 shadow-gaming-card' : 'border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-surface)] hover:border-purple-500/30'}`}>
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isEquipped ? 'bg-purple-500/20 text-purple-400' : 'bg-[var(--color-gaming-bg-card)] text-[var(--color-gaming-text-muted)]'}`}>
                                                    <Sparkles className="w-4 h-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-bold text-[var(--color-gaming-text)] truncate">{item.name}</div>
                                                    <div className="text-[10px] text-[var(--color-gaming-text-muted)]">{cssType} · {item.description}</div>
                                                </div>
                                                {isEquipped && (
                                                    <div className="text-[9px] font-bold text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-full border border-purple-500/25">ATTIVO</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Financials + Weekly Bonus */}
                    <div className="space-y-5">
                        {/* Finanze */}
                        <div className="border border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-emerald-100/30 rounded-2xl shadow-card p-5 relative overflow-hidden animate-fade-in">
                            <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-200/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                            <div className="flex items-center gap-2 text-emerald-800 mb-4">
                                <div className="p-1.5 rounded-lg bg-emerald-100 border border-emerald-200">
                                    <HandCoins className="w-4 h-4" />
                                </div>
                                <h3 className="font-bold text-sm tracking-tight">{financials.showSalary ? 'Proiezione Stipendio Lordo' : 'Bonus Settimanale'}</h3>
                            </div>
                            {financials.showSalary ? (
                                <>
                                    <div className="text-4xl font-black tracking-tighter text-ash-900">
                                        € {financials.expectedSalaryGross.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                                    </div>
                                    <div className="mt-4 grid grid-cols-3 gap-3 border-t border-emerald-200/50 pt-4">
                                        <div>
                                            <div className="text-[10px] font-semibold text-ash-500 uppercase">Base</div>
                                            <div className="text-base font-bold text-ash-700">€ {baseSalaryEur}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-semibold text-ash-500 uppercase">Bonus Mese</div>
                                            <div className="text-base font-bold text-emerald-700">+ € {financials.earnedMonthBonus}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-semibold text-ash-500 uppercase">Storico</div>
                                            <div className="text-base font-bold text-ash-700">€ {financials.historicalBonus}</div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-baseline gap-2 text-ash-900">
                                    <div className="text-4xl font-black tracking-tighter">+ € {financials.earnedMonthBonus}</div>
                                    <div className="text-sm text-ash-500 ml-2">bonus stimato</div>
                                </div>
                            )}
                        </div>

                        {/* Weekly Bonus Widget */}
                        <div className="animate-fade-in" style={{ animationDelay: '100ms', animationFillMode: 'backwards' }}>
                            <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 ml-1 flex items-center gap-2">
                                <Target className="w-4 h-4 text-brand-orange" /> Obiettivo in Corso
                            </h3>
                            <SafeWrapper><WeeklyBonusWidget userId={profileData.id} role={role} /></SafeWrapper>
                        </div>

                        {/* Roadmap / Prossimi Traguardi — gaming dark */}
                        <div className="border border-[var(--color-gaming-gold)]/20 bg-gradient-to-br from-[var(--color-gaming-gold)]/8 to-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card p-5 animate-fade-in" style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}>
                            <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-[var(--color-gaming-gold)]/10 border border-[var(--color-gaming-gold)]/20">
                                    <Trophy className="w-4 h-4 text-[var(--color-gaming-gold)]" />
                                </div>
                                Prossimi Traguardi
                            </h3>
                            <div className="space-y-2.5">
                                {roadmap.map((r: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 border border-[var(--color-gaming-gold)]/15 bg-gradient-to-r from-[var(--color-gaming-gold)]/6 to-[var(--color-gaming-bg-surface)] rounded-xl p-3 hover:border-[var(--color-gaming-gold)]/30 transition-all duration-200">
                                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--color-gaming-gold)]/20 to-[var(--color-gaming-gold)]/10 flex items-center justify-center border-2 border-[var(--color-gaming-gold)]/30 shadow-[0_0_8px_rgba(201,161,60,0.2)] text-[var(--color-gaming-gold)] font-black text-sm flex-shrink-0">
                                            {r.level}
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-[10px] font-bold text-[var(--color-gaming-text-muted)] uppercase tracking-widest">Al Livello {r.level}</div>
                                            <div className="text-sm font-bold text-[var(--color-gaming-text)] flex items-center gap-1.5">
                                                Sblocchi <Coins className="w-3.5 h-3.5 text-[var(--color-gaming-gold)]" /> <span className="text-[var(--color-gaming-gold)]">{r.rewardCoins} Coins</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {roadmap.length === 0 && (
                                    <div className="text-center p-6 text-[var(--color-gaming-text-muted)] font-medium">
                                        <Crown className="h-7 w-7 text-[var(--color-gaming-gold)] mx-auto mb-2" />
                                        <div className="text-sm">Hai sbloccato tutti i traguardi.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    QUEST LOG — Active quests in RPG quest journal style
                ═══════════════════════════════════════════════════════ */}
                {activeQuests && (activeQuests.daily.length > 0 || activeQuests.weekly.length > 0) && (
                    <div className="border border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card p-5 animate-fade-in relative overflow-hidden" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
                        <div className="absolute top-0 right-0 w-40 h-40 bg-ember-500/5 rounded-full blur-3xl pointer-events-none" />
                        <div className="flex items-center justify-between mb-4 relative z-10">
                            <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-ember-500/15 border border-ember-500/25">
                                    <Sword className="w-4 h-4 text-ember-400" />
                                </div>
                                Quest Log
                            </h3>
                            <span className="text-[11px] font-bold text-[var(--color-gaming-text-muted)]">
                                {activeQuests.daily.filter(q => q.completed).length}/{activeQuests.daily.length} giornaliere · {activeQuests.weekly.filter(q => q.completed).length}/{activeQuests.weekly.length} settimanali
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 relative z-10">
                            {[...activeQuests.daily, ...activeQuests.weekly].map((quest) => {
                                const progress = quest.targetValue > 0 ? Math.min((quest.currentValue / quest.targetValue) * 100, 100) : 0;
                                return (
                                    <div
                                        key={quest.progressId}
                                        className={`border rounded-xl p-3 flex items-center gap-3 transition-all duration-200 ${quest.completed
                                            ? 'border-[var(--color-gaming-gold)]/30 bg-gradient-to-r from-[var(--color-gaming-gold)]/10 to-[var(--color-gaming-bg-surface)]'
                                            : 'border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-surface)] hover:border-ember-500/30'
                                        }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <div className={`text-sm font-semibold truncate ${quest.completed ? 'text-[var(--color-gaming-gold)]' : 'text-[var(--color-gaming-text)]'}`}>
                                                    {quest.title}
                                                </div>
                                                <div className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${quest.type === 'daily'
                                                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                                                    : 'bg-purple-500/15 text-purple-400 border border-purple-500/25'
                                                }`}>
                                                    {quest.type === 'daily' ? 'D' : 'S'}
                                                </div>
                                            </div>
                                            <div className="mt-1.5 flex items-center gap-2">
                                                <div className="flex-1 h-1.5 bg-[var(--color-gaming-bg-deep)] rounded-full overflow-hidden border border-[var(--color-gaming-border)]">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-700 ${quest.completed
                                                            ? 'bg-gradient-to-r from-[var(--color-gaming-gold)] to-[var(--color-gaming-amber)]'
                                                            : 'bg-gradient-to-r from-fire-500 to-brand-orange'
                                                        }`}
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                                <span className="text-[10px] font-bold text-[var(--color-gaming-text-muted)] whitespace-nowrap">
                                                    {quest.currentValue}/{quest.targetValue}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-[10px] font-bold text-ember-400">{quest.rewardXp} XP</div>
                                            <div className="text-[10px] font-bold text-[var(--color-gaming-gold)]">{quest.rewardCoins} <Coins className="inline h-2.5 w-2.5" /></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    TITLE SELECTOR
                ═══════════════════════════════════════════════════════ */}
                {titleData && (
                    <SafeWrapper>
                        <TitleSelector
                            titles={titleData.titles}
                            activeTitle={titleData.activeTitle}
                            userId={profileData.id}
                        />
                    </SafeWrapper>
                )}

                {/* ═══════════════════════════════════════════════════════
                    BADGE WALL — Achievement showcase
                ═══════════════════════════════════════════════════════ */}
                {achievements.length > 0 && (
                    <SafeWrapper>
                        <AchievementShowcase achievements={achievements} />
                    </SafeWrapper>
                )}

                {/* ═══════════════════════════════════════════════════════
                    SETTINGS — Gaming dark theme
                ═══════════════════════════════════════════════════════ */}
                <div className="border border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card p-5 animate-fade-in" style={{ animationDelay: '300ms', animationFillMode: 'backwards' }}>
                    <h3 className="text-sm font-bold text-[var(--color-gaming-text)] uppercase tracking-wider mb-3 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-[var(--color-gaming-bg-surface)] border border-[var(--color-gaming-border)]">
                            <Settings className="w-4 h-4 text-[var(--color-gaming-text-muted)]" />
                        </div>
                        Impostazioni
                    </h3>
                    <AnimationToggle />
                    <SoundToggle />
                </div>

            </div>
        </div>
        </SafeWrapper>
    );
}
