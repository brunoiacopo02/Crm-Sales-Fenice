'use client';

import { useEffect, useState } from 'react';
import { getActiveEvent } from '@/app/actions/seasonalEventActions';
import { Flower2, Sun, Ghost, Gift, Sparkles, Timer, TrendingUp, Coins } from 'lucide-react';

interface SeasonalEventData {
    id: string;
    title: string;
    description: string;
    theme: string;
    startDate: Date;
    endDate: Date;
    xpMultiplier: number;
    coinsMultiplier: number;
}

const ICON_MAP: Record<string, React.ElementType> = {
    Flower2, Sun, Ghost, Gift, Sparkles,
};

const THEME_COLORS: Record<string, { border: string; iconBg: string; glow: string; badge: string; bar: string }> = {
    spring: {
        border: 'border-emerald-400/30',
        iconBg: 'from-emerald-500 to-emerald-700',
        glow: 'bg-emerald-400',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        bar: 'from-emerald-400 to-emerald-600',
    },
    summer: {
        border: 'border-amber-400/30',
        iconBg: 'from-amber-500 to-amber-700',
        glow: 'bg-amber-400',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        bar: 'from-amber-400 to-amber-600',
    },
    halloween: {
        border: 'border-purple-400/30',
        iconBg: 'from-purple-500 to-purple-700',
        glow: 'bg-purple-400',
        badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
        bar: 'from-purple-400 to-purple-600',
    },
    christmas: {
        border: 'border-red-400/30',
        iconBg: 'from-red-500 to-red-700',
        glow: 'bg-red-400',
        badge: 'bg-red-500/20 text-red-300 border-red-500/30',
        bar: 'from-red-400 to-red-600',
    },
    custom: {
        border: 'border-brand-orange/30',
        iconBg: 'from-brand-orange to-ember-600',
        glow: 'bg-brand-orange',
        badge: 'bg-brand-orange/20 text-brand-orange border-brand-orange/30',
        bar: 'from-brand-orange to-ember-500',
    },
};

function formatCountdown(endDate: Date): string {
    const now = new Date();
    const diff = new Date(endDate).getTime() - now.getTime();
    if (diff <= 0) return 'Terminato';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}g ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function SeasonalEventBanner() {
    const [event, setEvent] = useState<SeasonalEventData | null>(null);
    const [countdown, setCountdown] = useState('');

    useEffect(() => {
        async function fetchEvent() {
            const data = await getActiveEvent();
            if (data) {
                setEvent(data as SeasonalEventData);
                setCountdown(formatCountdown(data.endDate));
            } else {
                setEvent(null);
            }
        }
        fetchEvent();
    }, []);

    // Update countdown every minute
    useEffect(() => {
        if (!event) return;
        const tick = () => setCountdown(formatCountdown(event.endDate));
        const interval = setInterval(tick, 60000);
        return () => clearInterval(interval);
    }, [event]);

    if (!event) return null;

    const themeKey = event.theme in THEME_COLORS ? event.theme : 'custom';
    const colors = THEME_COLORS[themeKey];
    const THEME_LABELS: Record<string, { icon: string; label: string }> = {
        spring: { icon: 'Flower2', label: 'Primavera' },
        summer: { icon: 'Sun', label: 'Estate' },
        halloween: { icon: 'Ghost', label: 'Halloween' },
        christmas: { icon: 'Gift', label: 'Natale' },
        custom: { icon: 'Sparkles', label: 'Evento Speciale' },
    };
    const themeConfig = THEME_LABELS[themeKey] || THEME_LABELS.custom;
    const IconComponent = ICON_MAP[themeConfig.icon] || Sparkles;

    // Calculate progress (how far through the event we are)
    const totalDuration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
    const elapsed = Date.now() - new Date(event.startDate).getTime();
    const progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

    return (
        <div className={`rounded-xl border ${colors.border} bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900 p-4 shadow-lg animate-fade-in overflow-hidden`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors.iconBg} flex items-center justify-center shadow-md`}>
                            <IconComponent className="w-5 h-5 text-white" />
                        </div>
                        <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${colors.glow} animate-glow-pulse`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-white">{event.title}</div>
                            <div className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${colors.badge}`}>
                                {themeConfig.label}
                            </div>
                        </div>
                        <div className="text-xs text-ash-400 line-clamp-1">{event.description}</div>
                    </div>
                </div>

                {/* Countdown */}
                <div className="flex items-center gap-1.5 text-ash-300">
                    <Timer className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{countdown}</span>
                </div>
            </div>

            {/* Progress bar (event timeline) */}
            <div className="mt-3 h-1.5 rounded-full bg-ash-800 overflow-hidden">
                <div
                    className={`h-full rounded-full bg-gradient-to-r ${colors.bar} transition-[width] duration-500`}
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            {/* Multipliers */}
            <div className="mt-3 flex items-center gap-3">
                {event.xpMultiplier > 1 && (
                    <div className="flex items-center gap-1.5 bg-ash-800/50 rounded-lg px-2.5 py-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-bold text-emerald-400">x{event.xpMultiplier} XP</span>
                    </div>
                )}
                {event.coinsMultiplier > 1 && (
                    <div className="flex items-center gap-1.5 bg-ash-800/50 rounded-lg px-2.5 py-1.5">
                        <Coins className="w-3.5 h-3.5 text-brand-orange" />
                        <span className="text-xs font-bold text-brand-orange">x{event.coinsMultiplier} Coins</span>
                    </div>
                )}
            </div>
        </div>
    );
}
