'use client';

import { useEffect, useState, useCallback } from 'react';
import { Flame, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { getStreakInfo } from '@/app/actions/streakActions';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

type StreakState = 'safe' | 'at-risk' | 'critical' | 'hidden';

function getRomeHour(): number {
    const now = new Date();
    const rome = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        hour: 'numeric',
        hour12: false,
    }).format(now);
    return parseInt(rome, 10);
}

function getTimeUntilMidnightRome(): { hours: number; minutes: number; seconds: number } {
    const now = new Date();
    // Get current Rome time parts
    const romeParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
    }).formatToParts(now);

    const h = parseInt(romeParts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(romeParts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const s = parseInt(romeParts.find(p => p.type === 'second')?.value ?? '0', 10);

    const totalSecondsLeft = (23 - h) * 3600 + (59 - m) * 60 + (59 - s);
    return {
        hours: Math.floor(totalSecondsLeft / 3600),
        minutes: Math.floor((totalSecondsLeft % 3600) / 60),
        seconds: totalSecondsLeft % 60,
    };
}

function CountdownTimer() {
    const [time, setTime] = useState(getTimeUntilMidnightRome);

    useEffect(() => {
        const interval = setInterval(() => {
            setTime(getTimeUntilMidnightRome());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const pad = (n: number) => n.toString().padStart(2, '0');

    return (
        <div className="flex items-center gap-1 font-mono text-sm font-bold tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            <span>{pad(time.hours)}:{pad(time.minutes)}:{pad(time.seconds)}</span>
        </div>
    );
}

export function StreakAnxietyBanner({ userId }: { userId: string }) {
    const [streakCount, setStreakCount] = useState(0);
    const [isActiveToday, setIsActiveToday] = useState(false);
    const [streakState, setStreakState] = useState<StreakState>('hidden');
    const [loading, setLoading] = useState(true);
    const animationsEnabled = typeof window !== 'undefined' ? getAnimationsEnabled() : true;

    const loadStreak = useCallback(async () => {
        if (!userId) return;
        try {
            const data = await getStreakInfo(userId);
            setStreakCount(data.streakCount);
            setIsActiveToday(data.isActiveToday);
        } catch (err) {
            console.error('Error loading streak for anxiety banner:', err);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // Load streak data
    useEffect(() => {
        loadStreak();
    }, [loadStreak]);

    // Listen for quest completion events (reward_earned) to refresh
    useEffect(() => {
        const handler = () => { loadStreak(); };
        window.addEventListener('reward_earned', handler);
        return () => window.removeEventListener('reward_earned', handler);
    }, [loadStreak]);

    // Determine state based on time and streak
    useEffect(() => {
        function updateState() {
            if (loading) return;

            // If streak is active today = safe
            if (isActiveToday) {
                setStreakState(prev => {
                    // Play sound when transitioning from at-risk/critical to safe
                    if (prev === 'at-risk' || prev === 'critical') {
                        playSound('streak_maintained');
                    }
                    return 'safe';
                });
                return;
            }

            // No streak to lose
            if (streakCount === 0) {
                setStreakState('hidden');
                return;
            }

            // Check Rome time
            const hour = getRomeHour();
            if (hour >= 20) {
                setStreakState('critical');
            } else if (hour >= 18) {
                setStreakState('at-risk');
            } else {
                setStreakState('hidden');
            }
        }

        updateState();
        // Re-check every minute for time transitions
        const interval = setInterval(updateState, 60000);
        return () => clearInterval(interval);
    }, [loading, isActiveToday, streakCount]);

    if (loading || streakState === 'hidden') return null;

    // Safe state: green compact badge
    if (streakState === 'safe') {
        return (
            <div className="w-full rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/20 via-emerald-800/10 to-emerald-900/20 px-4 py-3 flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-emerald-500/15">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-emerald-300">
                        Streak sicura per oggi
                    </div>
                    <div className="text-xs text-emerald-400/70">
                        Hai completato almeno una quest — la tua streak di {streakCount} {streakCount === 1 ? 'giorno' : 'giorni'} e' al sicuro!
                    </div>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                    <Flame className="h-5 w-5" />
                    <span className="text-lg font-black tabular-nums">{streakCount}</span>
                </div>
            </div>
        );
    }

    // At-risk / Critical states: red pulsing banner
    const isCritical = streakState === 'critical';
    const pulseClass = animationsEnabled
        ? isCritical ? 'animate-streak-anxiety-critical' : 'animate-streak-anxiety-pulse'
        : '';
    const flameShakeClass = animationsEnabled
        ? isCritical ? 'animate-streak-flame-shake-intense' : 'animate-streak-flame-shake'
        : '';
    const borderColor = isCritical ? 'border-red-500/50' : 'border-red-500/30';
    const bgGradient = isCritical
        ? 'from-red-900/30 via-red-800/20 to-red-900/30'
        : 'from-red-900/20 via-red-800/10 to-red-900/20';

    return (
        <div className={`w-full rounded-xl border ${borderColor} bg-gradient-to-r ${bgGradient} px-4 py-3 relative overflow-hidden ${pulseClass}`}>
            {/* Urgent glow overlay for critical */}
            {isCritical && (
                <div className="absolute inset-0 bg-red-500/5 pointer-events-none" />
            )}

            <div className="relative z-10 flex items-center gap-3">
                <div className={`p-1.5 rounded-lg bg-red-500/15 ${flameShakeClass}`}>
                    <Flame className="h-5 w-5 text-red-400" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                        <span className="text-sm font-bold text-red-300">
                            La tua streak di {streakCount} {streakCount === 1 ? 'giorno' : 'giorni'} sta per rompersi!
                        </span>
                    </div>
                    <div className="text-xs text-red-400/70 mt-0.5">
                        {isCritical
                            ? 'Tempo quasi scaduto! Completa una quest prima di mezzanotte!'
                            : 'Completa almeno una quest oggi per mantenere la streak.'}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="text-red-300">
                        <CountdownTimer />
                    </div>
                    <div className="text-[10px] text-red-400/60 font-medium">
                        alla mezzanotte
                    </div>
                </div>
            </div>
        </div>
    );
}
