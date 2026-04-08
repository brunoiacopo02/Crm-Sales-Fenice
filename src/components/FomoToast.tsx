'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getGdoAndConfermeUsers } from '@/app/actions/manualAdjustmentActions';
import { Phone, Trophy, Flame, CheckCircle } from 'lucide-react';

type FomoToastType = 'appointment' | 'confirmation' | 'achievement' | 'hotstreak';

interface FomoToastItem {
    id: string;
    type: FomoToastType;
    userName: string;
    message: string;
    phase: 'enter' | 'visible' | 'exit';
}

const FOMO_EVENT_MAP: Record<string, { type: FomoToastType; message: string } | undefined> = {
    'appointment_set': { type: 'appointment', message: 'ha fissato un appuntamento!' },
    'conferme_outcome_set': { type: 'confirmation', message: 'ha confermato un appuntamento!' },
    'confirmed': { type: 'confirmation', message: 'ha confermato un appuntamento!' },
    'conferme_recall_scheduled': { type: 'appointment', message: 'ha fissato un richiamo!' },
};

const TOAST_ICONS: Record<FomoToastType, typeof Phone> = {
    appointment: Phone,
    confirmation: CheckCircle,
    achievement: Trophy,
    hotstreak: Flame,
};

const TOAST_COLORS: Record<FomoToastType, { border: string; icon: string; glow: string }> = {
    appointment: {
        border: 'border-l-brand-orange',
        icon: 'text-brand-orange',
        glow: 'rgba(255,190,130,0.25)',
    },
    confirmation: {
        border: 'border-l-emerald-400',
        icon: 'text-emerald-400',
        glow: 'rgba(52,211,153,0.25)',
    },
    achievement: {
        border: 'border-l-[var(--color-gaming-gold)]',
        icon: 'text-[var(--color-gaming-gold)]',
        glow: 'rgba(255,215,0,0.25)',
    },
    hotstreak: {
        border: 'border-l-[var(--color-fire-500)]',
        icon: 'text-[var(--color-fire-500)]',
        glow: 'rgba(255,107,26,0.3)',
    },
};

const MAX_TOASTS = 2;
const TOAST_DURATION = 4000;
const EXIT_DURATION = 350;

export function FomoToast() {
    const { user, isLoading } = useAuth();
    const [toasts, setToasts] = useState<FomoToastItem[]>([]);
    const userCacheRef = useRef<Map<string, { name: string; displayName: string | null; role: string }>>(new Map());
    const cacheLoadedRef = useRef(false);

    // Load GDO/CONFERME user cache once on mount
    useEffect(() => {
        if (cacheLoadedRef.current || isLoading) return;
        cacheLoadedRef.current = true;
        getGdoAndConfermeUsers()
            .then(users => {
                const map = new Map<string, { name: string; displayName: string | null; role: string }>();
                for (const u of users) {
                    map.set(u.id, { name: u.name ?? 'Utente', displayName: u.displayName, role: u.role ?? '' });
                }
                userCacheRef.current = map;
            })
            .catch(() => { /* silent fail — toasts just won't show */ });
    }, [isLoading]);

    const addToast = useCallback((type: FomoToastType, userName: string, message: string) => {
        const id = crypto.randomUUID();

        setToasts(prev => {
            const active = prev.filter(t => t.phase !== 'exit');
            const updated = [...prev];
            // If at capacity, exit the oldest active toast
            if (active.length >= MAX_TOASTS) {
                const oldest = active[0];
                const idx = updated.findIndex(t => t.id === oldest.id);
                if (idx >= 0) updated[idx] = { ...updated[idx], phase: 'exit' };
            }
            return [...updated, { id, type, userName, message, phase: 'enter' as const }];
        });

        // Transition enter → visible
        setTimeout(() => {
            setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'visible' as const } : t));
        }, 50);

        // Auto-dismiss
        setTimeout(() => {
            setToasts(prev => prev.map(t => t.id === id && t.phase !== 'exit' ? { ...t, phase: 'exit' as const } : t));
        }, TOAST_DURATION);

        // Remove from DOM after exit animation
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, TOAST_DURATION + EXIT_DURATION);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'exit' as const } : t));
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, EXIT_DURATION);
    }, []);

    // Listen for lead events (appointments, confirmations)
    useEffect(() => {
        const handler = (e: Event) => {
            try {
                const detail = (e as CustomEvent).detail;
                if (!detail?.userId || detail.userId === user?.id) return;

                const userInfo = userCacheRef.current.get(detail.userId);
                if (!userInfo) return;
                if (userInfo.role !== 'GDO' && userInfo.role !== 'CONFERME') return;

                const mapped = FOMO_EVENT_MAP[detail.eventType];
                if (!mapped) return;

                const displayName = userInfo.displayName || userInfo.name;
                addToast(mapped.type, displayName, mapped.message);
            } catch { /* silent fail */ }
        };

        window.addEventListener('fomo_lead_event', handler);
        return () => window.removeEventListener('fomo_lead_event', handler);
    }, [user?.id, addToast]);

    // Listen for achievement events (badge unlocked)
    useEffect(() => {
        const handler = (e: Event) => {
            try {
                const detail = (e as CustomEvent).detail;
                if (!detail?.userId || detail.userId === user?.id) return;

                const userInfo = userCacheRef.current.get(detail.userId);
                if (!userInfo) return;
                if (userInfo.role !== 'GDO' && userInfo.role !== 'CONFERME') return;

                const displayName = userInfo.displayName || userInfo.name;
                addToast('achievement', displayName, 'ha sbloccato un badge!');
            } catch { /* silent fail */ }
        };

        window.addEventListener('fomo_achievement_event', handler);
        return () => window.removeEventListener('fomo_achievement_event', handler);
    }, [user?.id, addToast]);

    // Listen for hot streak broadcast events
    useEffect(() => {
        const handler = (e: Event) => {
            try {
                const detail = (e as CustomEvent).detail;
                if (!detail?.userId || detail.userId === user?.id) return;

                const displayName = detail.displayName || detail.name || 'Un collega';
                addToast('hotstreak', displayName, 'è in hot streak!');
            } catch { /* silent fail */ }
        };

        window.addEventListener('fomo_hotstreak_event', handler);
        return () => window.removeEventListener('fomo_hotstreak_event', handler);
    }, [user?.id, addToast]);

    // Only render for GDO/CONFERME
    const userRole = user?.user_metadata?.role;
    if (!userRole || (userRole !== 'GDO' && userRole !== 'CONFERME')) return null;
    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-16 right-4 z-[9998] pointer-events-none flex flex-col gap-2">
            {toasts.map((toast) => {
                const colors = TOAST_COLORS[toast.type];
                const Icon = TOAST_ICONS[toast.type];

                return (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto transition-all duration-300 ease-out ${
                            toast.phase === 'enter' ? 'translate-x-[120%] opacity-0' :
                            toast.phase === 'exit' ? 'translate-x-[120%] opacity-0' :
                            'translate-x-0 opacity-100'
                        }`}
                    >
                        <div
                            className={`relative overflow-hidden rounded-xl border-l-4 ${colors.border} bg-[var(--color-gaming-bg-card)]/95 backdrop-blur-sm border border-[var(--color-gaming-border)] pl-3 pr-4 py-3 min-w-[260px] max-w-[340px] cursor-pointer`}
                            style={{ boxShadow: `0 4px 20px ${colors.glow}, 0 0 40px ${colors.glow}` }}
                            onClick={() => dismissToast(toast.id)}
                        >
                            {/* Shimmer accent line */}
                            <div
                                className="absolute top-0 left-0 w-full h-[2px] opacity-60"
                                style={{ animation: 'fomo-shimmer 2s ease-in-out infinite', background: 'linear-gradient(90deg, transparent, var(--color-fire-400), transparent)' }}
                            />

                            <div className="relative flex items-center gap-3">
                                <div className={`flex-shrink-0 ${colors.icon}`}>
                                    <Icon size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-[var(--color-gaming-text)]">
                                        <span className="font-bold text-[var(--color-gaming-text-bright)]">{toast.userName}</span>{' '}
                                        {toast.message}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
