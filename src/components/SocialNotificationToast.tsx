'use client';

import { useEffect, useState, useRef } from 'react';
import { TrendingDown, Award, Swords, Sparkles, ChevronRight } from 'lucide-react';
import type { SocialNotificationType } from '@/lib/animationUtils';

const NOTIFICATION_CONFIG: Record<SocialNotificationType, {
    icon: typeof TrendingDown;
    borderColor: string;
    iconColor: string;
    glowColor: string;
}> = {
    rank_overtaken: {
        icon: TrendingDown,
        borderColor: 'border-l-ember-400',
        iconColor: 'text-ember-400',
        glowColor: 'rgba(232, 82, 63, 0.3)',
    },
    rare_achievement: {
        icon: Award,
        borderColor: 'border-l-gold-400',
        iconColor: 'text-gold-400',
        glowColor: 'rgba(201, 161, 60, 0.3)',
    },
    boss_battle_ending: {
        icon: Swords,
        borderColor: 'border-l-ember-500',
        iconColor: 'text-ember-500',
        glowColor: 'rgba(212, 65, 47, 0.3)',
    },
    seasonal_event: {
        icon: Sparkles,
        borderColor: 'border-l-brand-orange',
        iconColor: 'text-brand-orange',
        glowColor: 'rgba(255, 190, 130, 0.3)',
    },
};

export interface SocialToastData {
    id: string;
    type: SocialNotificationType;
    title: string;
    message: string;
    ctaLabel?: string;
    ctaHref?: string;
    actorName?: string;
}

interface SocialNotificationToastProps {
    data: SocialToastData;
    onDismiss: (id: string) => void;
    index: number;
}

export function SocialNotificationToast({ data, onDismiss, index }: SocialNotificationToastProps) {
    const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const enterTimer = setTimeout(() => setPhase('visible'), 50);
        // Auto-dismiss after 5 seconds (longer than reward popups — these need reading)
        timerRef.current = setTimeout(() => setPhase('exit'), 5000);
        return () => {
            clearTimeout(enterTimer);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    useEffect(() => {
        if (phase === 'exit') {
            const exitTimer = setTimeout(() => onDismiss(data.id), 400);
            return () => clearTimeout(exitTimer);
        }
    }, [phase, data.id, onDismiss]);

    const config = NOTIFICATION_CONFIG[data.type];
    const Icon = config.icon;
    const topOffset = 16 + index * 96;

    return (
        <div
            className={`fixed right-4 z-[9997] pointer-events-auto transition-all duration-400 ease-out ${
                phase === 'enter' ? 'translate-x-[120%] opacity-0' :
                phase === 'exit' ? 'translate-x-[120%] opacity-0' :
                'translate-x-0 opacity-100'
            }`}
            style={{ top: topOffset }}
            onClick={() => setPhase('exit')}
        >
            <div
                className={`relative overflow-hidden rounded-xl border-l-4 ${config.borderColor} bg-ash-900/95 backdrop-blur-sm border border-ash-700/50 pl-3 pr-4 py-3 shadow-lg min-w-[280px] max-w-[360px] cursor-pointer social-toast-glow`}
                style={{ '--toast-glow-color': config.glowColor } as React.CSSProperties}
            >
                {/* Shimmer accent */}
                <div className="absolute top-0 left-0 w-full h-0.5 social-toast-shimmer" />

                {/* Content */}
                <div className="relative flex items-start gap-3">
                    <div className={`flex-shrink-0 mt-0.5 ${config.iconColor} social-toast-icon`}>
                        <Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-ash-200 leading-tight">{data.title}</div>
                        <div className="text-[11px] text-ash-400 mt-0.5 leading-snug">{data.message}</div>
                        {data.ctaLabel && (
                            <div className="flex items-center gap-0.5 mt-1.5">
                                <div className={`text-[10px] font-medium ${config.iconColor} hover:underline`}>
                                    {data.ctaLabel}
                                </div>
                                <ChevronRight size={10} className={config.iconColor} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
