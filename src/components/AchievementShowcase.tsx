'use client';

import { useState } from 'react';
import {
    Phone, PhoneCall, CalendarCheck, Crown, Flame, Zap, Compass, Target,
    Shield, Sword, Star, Users, Globe, Coins, Gem, Trophy, Lock, ChevronDown, ChevronUp,
    type LucideIcon
} from 'lucide-react';

// Map icon names from DB to Lucide components
const ICON_MAP: Record<string, LucideIcon> = {
    Phone, PhoneCall, CalendarCheck, Crown, Flame, Zap, Compass, Target,
    Shield, Sword, Star, Users, Globe, Coins, Gem, Trophy,
};

// Tier styling
const TIER_STYLES = {
    0: {
        border: 'border-ash-300/40',
        bg: 'bg-ash-100/60',
        iconColor: 'text-ash-400',
        label: 'Bloccato',
        labelColor: 'text-ash-400',
        glow: '',
    },
    1: {
        border: 'border-amber-600/60',
        bg: 'bg-gradient-to-br from-amber-50 to-amber-100/80',
        iconColor: 'text-amber-700',
        label: 'Bronzo',
        labelColor: 'text-amber-700',
        glow: 'shadow-[0_0_10px_-2px_rgba(180,120,40,0.25)]',
    },
    2: {
        border: 'bg-gradient-to-br from-gray-100 to-gray-200 border-gray-400/60',
        bg: 'bg-gradient-to-br from-gray-50 to-gray-100',
        iconColor: 'text-gray-600',
        label: 'Argento',
        labelColor: 'text-gray-600',
        glow: 'shadow-[0_0_12px_-2px_rgba(160,160,170,0.35)]',
    },
    3: {
        border: 'border-gold-400/80',
        bg: 'bg-gradient-to-br from-gold-50 to-gold-100',
        iconColor: 'text-gold-600',
        label: 'Oro',
        labelColor: 'text-gold-600',
        glow: 'shadow-[0_0_16px_-2px_rgba(201,161,60,0.4)]',
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
        <div className="border border-ember-200/60 bg-white rounded-2xl shadow-card overflow-hidden animate-fade-in" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-6 hover:bg-ash-50/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-ember-100 to-brand-orange-100 border border-ember-200">
                        <Trophy className="w-5 h-5 text-ember-500" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-ash-800 tracking-tight">Badge & Achievement</h3>
                        <div className="text-xs text-ash-500 mt-0.5">
                            {unlockedCount}/{achievements.length} sbloccati
                            {goldCount > 0 && <span className="text-gold-600 font-bold ml-2">{goldCount} Oro</span>}
                        </div>
                    </div>
                </div>
                <div className="text-ash-400">
                    {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
            </button>

            {expanded && (
                <div className="px-6 pb-6 space-y-6">
                    {Object.entries(grouped).map(([category, achs]) => (
                        <div key={category}>
                            <div className="text-xs font-bold text-ash-500 uppercase tracking-widest mb-3">
                                {CATEGORY_LABELS[category] || category}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {achs.map(ach => (
                                    <BadgeCard key={ach.id} achievement={ach} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function BadgeCard({ achievement }: { achievement: AchievementData }) {
    const { currentTier, currentValue, tier1Target, tier2Target, tier3Target, icon, name, description } = achievement;
    const style = TIER_STYLES[currentTier as keyof typeof TIER_STYLES] || TIER_STYLES[0];
    const IconComponent = ICON_MAP[icon] || Trophy;

    const isLocked = currentTier === 0;
    const isMaxed = currentTier === 3;

    // Calculate progress to next tier
    let progressPerc = 0;
    let nextTarget = 0;
    let prevTarget = 0;
    if (!isMaxed) {
        const targets = [0, tier1Target, tier2Target, tier3Target];
        prevTarget = targets[currentTier];
        nextTarget = targets[currentTier + 1];
        const range = nextTarget - prevTarget;
        const progress = currentValue - prevTarget;
        progressPerc = range > 0 ? Math.min((progress / range) * 100, 100) : 0;
    }

    // Tier indicator dots
    const tierDots = [1, 2, 3].map(t => {
        if (t <= currentTier) {
            const dotColor = t === 1 ? 'bg-amber-500' : t === 2 ? 'bg-gray-400' : 'bg-gold-500';
            return <div key={t} className={`w-2 h-2 rounded-full ${dotColor}`} />;
        }
        return <div key={t} className="w-2 h-2 rounded-full bg-ash-200" />;
    });

    return (
        <div
            className={`relative rounded-xl border-2 p-3 transition-all duration-300 ${style.border} ${style.glow} ${isLocked ? 'opacity-60 grayscale-[30%]' : 'hover:scale-[1.02]'}`}
        >
            {/* Icon */}
            <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isLocked ? 'bg-ash-100' : style.bg}`}>
                    {isLocked ? (
                        <Lock className="w-5 h-5 text-ash-400" />
                    ) : (
                        <IconComponent className={`w-5 h-5 ${style.iconColor}`} />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="text-sm font-bold text-ash-800 truncate">{name}</div>
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${style.labelColor}`}>
                        {isMaxed ? 'MAX' : style.label}
                    </div>
                </div>
            </div>

            {/* Description */}
            <div className="text-[11px] text-ash-500 line-clamp-2 mb-2 leading-snug min-h-[28px]">
                {description}
            </div>

            {/* Tier dots */}
            <div className="flex items-center gap-1 mb-2">
                {tierDots}
            </div>

            {/* Progress bar to next tier */}
            {!isMaxed && (
                <div>
                    <div className="flex justify-between text-[10px] font-semibold text-ash-400 mb-0.5">
                        <div>{currentValue}</div>
                        <div>{nextTarget}</div>
                    </div>
                    <div className="w-full h-1.5 bg-ash-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                                currentTier === 0 ? 'bg-ash-300' :
                                currentTier === 1 ? 'bg-amber-500' :
                                'bg-gray-400'
                            }`}
                            style={{ width: `${progressPerc}%` }}
                        />
                    </div>
                </div>
            )}

            {/* MAX badge overlay */}
            {isMaxed && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-gold-600">
                    <Star className="w-3 h-3 fill-gold-400" />
                    Completato
                </div>
            )}
        </div>
    );
}
