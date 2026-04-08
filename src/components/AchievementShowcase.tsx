'use client';

import { useState } from 'react';
import {
    Phone, PhoneCall, CalendarCheck, Crown, Flame, Zap, Compass, Target,
    Shield, Sword, Star, Users, Globe, Coins, Gem, Trophy, Lock, ChevronDown, ChevronUp,
    type LucideIcon
} from 'lucide-react';
import { getAnimationsEnabled } from '@/lib/animationUtils';

// Map icon names from DB to Lucide components
const ICON_MAP: Record<string, LucideIcon> = {
    Phone, PhoneCall, CalendarCheck, Crown, Flame, Zap, Compass, Target,
    Shield, Sword, Star, Users, Globe, Coins, Gem, Trophy,
};

// Tier styling — dark gaming theme
const TIER_STYLES = {
    0: {
        border: 'border-[var(--color-gaming-border)]',
        bg: 'bg-[var(--color-gaming-bg-surface)]',
        iconBg: 'bg-[var(--color-gaming-bg-deep)]',
        iconColor: 'text-[var(--color-gaming-text-muted)]',
        label: 'Bloccato',
        labelColor: 'text-[var(--color-gaming-text-muted)]',
        glow: '',
        glowColor: '',
    },
    1: {
        border: 'border-amber-600/50',
        bg: 'bg-gradient-to-br from-amber-900/20 to-[var(--color-gaming-bg-card)]',
        iconBg: 'bg-amber-900/30',
        iconColor: 'text-amber-400',
        label: 'Bronzo',
        labelColor: 'text-amber-400',
        glow: 'badge-gaming-unlocked',
        glowColor: 'rgba(180,120,40,0.3)',
    },
    2: {
        border: 'border-gray-400/50',
        bg: 'bg-gradient-to-br from-gray-700/20 to-[var(--color-gaming-bg-card)]',
        iconBg: 'bg-gray-700/30',
        iconColor: 'text-gray-300',
        label: 'Argento',
        labelColor: 'text-gray-300',
        glow: 'badge-gaming-unlocked',
        glowColor: 'rgba(160,160,170,0.35)',
    },
    3: {
        border: 'border-[var(--color-gaming-gold)]/60',
        bg: 'bg-gradient-to-br from-[var(--color-gaming-gold)]/15 to-[var(--color-gaming-bg-card)]',
        iconBg: 'bg-[var(--color-gaming-gold)]/15',
        iconColor: 'text-[var(--color-gaming-gold)]',
        label: 'Oro',
        labelColor: 'text-[var(--color-gaming-gold)]',
        glow: 'badge-gaming-unlocked',
        glowColor: 'rgba(201,161,60,0.4)',
    },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
    calls: 'Chiamate',
    appointments: 'Appuntamenti',
    streak: 'Streak',
    quests: 'Quest',
    level: 'Livello',
    leads: 'Lead',
    coins: 'Coins',
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
    calls: Phone,
    appointments: CalendarCheck,
    streak: Flame,
    quests: Sword,
    level: Zap,
    leads: Users,
    coins: Coins,
};

type AchievementData = {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    metric: string;
    tier1Target: number;
    tier2Target: number;
    tier3Target: number;
    currentTier: number;
    currentValue: number;
};

export default function AchievementShowcase({ achievements }: { achievements: AchievementData[] }) {
    const [expanded, setExpanded] = useState(true);

    const unlockedCount = achievements.filter(a => a.currentTier > 0).length;
    const goldCount = achievements.filter(a => a.currentTier === 3).length;

    // Group by category
    const grouped = achievements.reduce<Record<string, AchievementData[]>>((acc, ach) => {
        if (!acc[ach.category]) acc[ach.category] = [];
        acc[ach.category].push(ach);
        return acc;
    }, {});

    return (
        <div className="border border-[var(--color-gaming-border)] bg-[var(--color-gaming-bg-card)] rounded-2xl shadow-gaming-card overflow-hidden animate-fade-in" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-6 hover:bg-[var(--color-gaming-bg-surface)] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-ember-500/15 to-fire-500/10 border border-ember-500/25">
                        <Trophy className="w-5 h-5 text-ember-400" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-[var(--color-gaming-text)] tracking-tight">Badge & Achievement</h3>
                        <div className="text-xs text-[var(--color-gaming-text-muted)] mt-0.5">
                            {unlockedCount}/{achievements.length} sbloccati
                            {goldCount > 0 && <span className="text-[var(--color-gaming-gold)] font-bold ml-2">{goldCount} Oro</span>}
                        </div>
                    </div>
                </div>
                <div className="text-[var(--color-gaming-text-muted)]">
                    {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
            </button>

            {expanded && (
                <div className="px-6 pb-6 space-y-6">
                    {Object.entries(grouped).map(([category, achs]) => {
                        const CatIcon = CATEGORY_ICONS[category] || Trophy;
                        return (
                            <div key={category}>
                                <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-gaming-text-muted)] uppercase tracking-widest mb-3">
                                    <CatIcon className="w-3.5 h-3.5 text-fire-400/60" />
                                    {CATEGORY_LABELS[category] || category}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {achs.map(ach => (
                                        <BadgeCard key={ach.id} achievement={ach} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function BadgeCard({ achievement }: { achievement: AchievementData }) {
    const { currentTier, currentValue, tier1Target, tier2Target, tier3Target, icon, name, description } = achievement;
    const style = TIER_STYLES[currentTier as keyof typeof TIER_STYLES] || TIER_STYLES[0];
    const IconComponent = ICON_MAP[icon] || Trophy;
    const animEnabled = typeof window !== 'undefined' ? getAnimationsEnabled() : true;

    const isLocked = currentTier === 0;
    const isMaxed = currentTier === 3;

    // Calculate progress to next tier
    let progressPerc = 0;
    let nextTarget = 0;
    if (!isMaxed) {
        const targets = [0, tier1Target, tier2Target, tier3Target];
        const prevTarget = targets[currentTier];
        nextTarget = targets[currentTier + 1];
        const range = nextTarget - prevTarget;
        const progress = currentValue - prevTarget;
        progressPerc = range > 0 ? Math.min((progress / range) * 100, 100) : 0;
    }

    // Tier indicator dots
    const tierDots = [1, 2, 3].map(t => {
        if (t <= currentTier) {
            const dotColor = t === 1 ? 'bg-amber-500 shadow-[0_0_4px_rgba(180,120,40,0.5)]' : t === 2 ? 'bg-gray-400 shadow-[0_0_4px_rgba(160,160,170,0.4)]' : 'bg-[var(--color-gaming-gold)] shadow-[0_0_4px_rgba(201,161,60,0.5)]';
            return <div key={t} className={`w-2 h-2 rounded-full ${dotColor}`} />;
        }
        return <div key={t} className="w-2 h-2 rounded-full bg-[var(--color-gaming-bg-deep)]" />;
    });

    return (
        <div
            className={`relative rounded-xl border-2 p-3 transition-all duration-300 ${style.border} ${isLocked ? 'badge-gaming-locked' : 'hover:scale-[1.03]'} ${!isLocked && animEnabled ? style.glow : ''}`}
            style={!isLocked && style.glowColor ? { ['--glow-color' as string]: style.glowColor } as React.CSSProperties : undefined}
        >
            {/* Background fill */}
            <div className={`absolute inset-0 rounded-xl ${style.bg}`} />

            <div className="relative z-10">
                {/* Icon */}
                <div className="flex items-center gap-2.5 mb-2">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isLocked ? 'bg-[var(--color-gaming-bg-deep)]' : style.iconBg}`}>
                        {isLocked ? (
                            <Lock className="w-5 h-5 text-[var(--color-gaming-text-muted)]" />
                        ) : (
                            <IconComponent className={`w-5 h-5 ${style.iconColor}`} />
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className={`text-sm font-bold truncate ${isLocked ? 'text-[var(--color-gaming-text-muted)]' : 'text-[var(--color-gaming-text)]'}`}>{name}</div>
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${style.labelColor}`}>
                            {isMaxed ? 'MAX' : style.label}
                        </div>
                    </div>
                </div>

                {/* Description */}
                <div className={`text-[11px] line-clamp-2 mb-2 leading-snug min-h-[28px] ${isLocked ? 'text-[var(--color-gaming-text-muted)]' : 'text-[var(--color-gaming-text-muted)]'}`}>
                    {description}
                </div>

                {/* Tier dots */}
                <div className="flex items-center gap-1 mb-2">
                    {tierDots}
                </div>

                {/* Progress bar to next tier */}
                {!isMaxed && (
                    <div>
                        <div className="flex justify-between text-[10px] font-semibold text-[var(--color-gaming-text-muted)] mb-0.5">
                            <div>{currentValue}</div>
                            <div>{nextTarget}</div>
                        </div>
                        <div className="w-full h-1.5 bg-[var(--color-gaming-bg-deep)] rounded-full overflow-hidden border border-[var(--color-gaming-border)]">
                            <div
                                className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                                    currentTier === 0 ? 'bg-[var(--color-gaming-text-muted)]' :
                                    currentTier === 1 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                                    'bg-gradient-to-r from-gray-500 to-gray-300'
                                }`}
                                style={{ width: `${progressPerc}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* MAX badge overlay */}
                {isMaxed && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-gaming-gold)]">
                        <Star className="w-3 h-3 fill-[var(--color-gaming-gold)]" />
                        Completato
                    </div>
                )}
            </div>
        </div>
    );
}
