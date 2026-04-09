'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { Flame } from 'lucide-react';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';
import { useRealtimeBroadcast } from '@/components/providers/RealtimeProvider';
import { useAuth } from '@/components/AuthProvider';
import { SafeWrapper } from '@/components/SafeWrapper';

type HotStreakMode = 'inactive' | 'active' | 'intense';

const ACTION_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const DECAY_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes inactivity → deactivate
const ACTIVE_THRESHOLD = 3;
const INTENSE_THRESHOLD = 5;

/**
 * HotStreak — purely visual fire effect around the pipeline when the user
 * performs 3+ productive actions within 10 minutes. Intensifies at 5+.
 * Deactivates after 5 minutes of inactivity.
 *
 * Listens to the global `reward_earned` CustomEvent (same as TimedChest).
 * Respects getAnimationsEnabled() toggle.
 */
export function HotStreak({ children }: { children: ReactNode }) {
    const [mode, setMode] = useState<HotStreakMode>('inactive');
    const actionTimestampsRef = useRef<number[]>([]);
    const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const broadcastedRef = useRef(false);
    const { broadcastFomo } = useRealtimeBroadcast();
    const { user } = useAuth();

    const clearDecayTimer = useCallback(() => {
        if (decayTimerRef.current) {
            clearTimeout(decayTimerRef.current);
            decayTimerRef.current = null;
        }
    }, []);

    const startDecayTimer = useCallback(() => {
        clearDecayTimer();
        decayTimerRef.current = setTimeout(() => {
            setMode('inactive');
            actionTimestampsRef.current = [];
            broadcastedRef.current = false;
        }, DECAY_TIMEOUT_MS);
    }, [clearDecayTimer]);

    const recalcMode = useCallback(() => {
        const now = Date.now();
        // Keep only actions within the window
        actionTimestampsRef.current = actionTimestampsRef.current.filter(
            t => now - t < ACTION_WINDOW_MS
        );
        const count = actionTimestampsRef.current.length;

        if (count >= INTENSE_THRESHOLD) {
            setMode(prev => {
                if (prev === 'inactive') playSound('hot_streak_activate');
                return 'intense';
            });
            startDecayTimer();
        } else if (count >= ACTIVE_THRESHOLD) {
            setMode(prev => {
                if (prev === 'inactive') playSound('hot_streak_activate');
                return 'active';
            });
            startDecayTimer();
        }
        // Don't deactivate here — let the decay timer handle that

        // Broadcast hot streak to colleagues (once per activation)
        if (count >= ACTIVE_THRESHOLD && !broadcastedRef.current && user) {
            broadcastedRef.current = true;
            try {
                broadcastFomo('fomo_hotstreak', {
                    userId: user.id,
                    name: user.user_metadata?.name || 'Un collega',
                    displayName: user.user_metadata?.displayName || user.user_metadata?.name || 'Un collega',
                });
            } catch { /* silent fail */ }
        }
    }, [startDecayTimer, broadcastFomo, user]);

    useEffect(() => {
        const handleReward = () => {
            if (!getAnimationsEnabled()) return;
            actionTimestampsRef.current.push(Date.now());
            recalcMode();
        };

        window.addEventListener('reward_earned', handleReward);
        return () => {
            window.removeEventListener('reward_earned', handleReward);
            clearDecayTimer();
        };
    }, [recalcMode, clearDecayTimer]);

    if (mode === 'inactive') {
        return <>{children}</>;
    }

    const isIntense = mode === 'intense';

    return (
        <SafeWrapper fallback={null}>
        <div className="relative">
            {/* Fire border overlay — top */}
            <div
                className={`absolute -top-[3px] left-0 right-0 h-[3px] rounded-t-xl z-10 pointer-events-none ${
                    isIntense
                        ? 'animate-hot-streak-intense bg-gradient-to-r from-amber-500 via-red-500 to-amber-500'
                        : 'animate-hot-streak-pulse bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400'
                }`}
                style={{ backgroundSize: '200% 100%' }}
            />

            {/* Glow effect behind pipeline */}
            <div
                className={`absolute -inset-[2px] rounded-xl pointer-events-none z-0 transition-opacity duration-500 ${
                    isIntense
                        ? 'opacity-100 shadow-[0_0_24px_rgba(239,68,68,0.35),0_0_48px_rgba(245,158,11,0.2)]'
                        : 'opacity-100 shadow-[0_0_16px_rgba(245,158,11,0.25),0_0_32px_rgba(251,191,36,0.1)]'
                }`}
            />

            {/* Side borders — subtle fire glow on left and right */}
            <div
                className={`absolute top-0 -left-[2px] bottom-0 w-[2px] pointer-events-none z-10 ${
                    isIntense
                        ? 'animate-hot-streak-intense bg-gradient-to-b from-red-500 via-amber-500 to-red-500'
                        : 'animate-hot-streak-pulse bg-gradient-to-b from-amber-400 via-orange-400 to-amber-400'
                }`}
                style={{ backgroundSize: '100% 200%' }}
            />
            <div
                className={`absolute top-0 -right-[2px] bottom-0 w-[2px] pointer-events-none z-10 ${
                    isIntense
                        ? 'animate-hot-streak-intense bg-gradient-to-b from-red-500 via-amber-500 to-red-500'
                        : 'animate-hot-streak-pulse bg-gradient-to-b from-amber-400 via-orange-400 to-amber-400'
                }`}
                style={{ backgroundSize: '100% 200%' }}
            />

            {/* Flame badge — top right corner */}
            <div
                className={`absolute -top-3 -right-3 z-20 flex items-center gap-1 px-2 py-1 rounded-full border pointer-events-none ${
                    isIntense
                        ? 'bg-red-600 border-red-400 animate-hot-streak-badge-intense shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                        : 'bg-amber-500 border-amber-400 animate-hot-streak-badge shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                }`}
            >
                <Flame className={`text-white ${isIntense ? 'w-5 h-5' : 'w-4 h-4'}`} />
                {isIntense && (
                    <span className="text-white text-[10px] font-bold uppercase tracking-wider">
                        ON FIRE
                    </span>
                )}
            </div>

            {/* Pipeline content */}
            <div className="relative z-[1]">
                {children}
            </div>
        </div>
        </SafeWrapper>
    );
}
