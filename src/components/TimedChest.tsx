'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Package, Sparkles, Coins, Crown, X, Timer } from 'lucide-react';
import { claimTimedChestReward } from '@/app/actions/timedChestActions';
import { triggerCelebration } from '@/lib/animationUtils';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import { useRouter } from 'next/navigation';
import type { ChestRarity } from '@/components/ChestOpeningAnimation';
import { SafeWrapper } from '@/components/SafeWrapper';
import dynamic from 'next/dynamic';

const ChestOpeningAnimation = dynamic(() => import('@/components/ChestOpeningAnimation').then(m => ({ default: m.ChestOpeningAnimation })), { ssr: false });

// ─── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'crm-fenice-timed-chest';
const MIN_ACTIONS_THRESHOLD = 5;
const MAX_ACTIONS_THRESHOLD = 15;
const MIN_COUNTDOWN_MINUTES = 15;
const MAX_COUNTDOWN_MINUTES = 30;

// ─── Types ─────────────────────────────────────────────────────────────

interface ChestState {
    /** Actions counted today */
    actionCount: number;
    /** Random threshold for this cycle (5-15) */
    threshold: number;
    /** Timestamp when chest was spawned (ISO) */
    spawnedAt: string | null;
    /** Timestamp when chest becomes ready (ISO) */
    readyAt: string | null;
    /** Current phase */
    phase: 'hidden' | 'spawned' | 'ready' | 'claimed';
    /** Date string (YYYY-MM-DD) for daily reset */
    date: string;
    /** How many chests claimed today (for multiple cycles) */
    claimedToday: number;
}

type UIPhase = 'hidden' | 'spawned' | 'ready' | 'opening' | 'revealed';

interface ChestReward {
    rarity: string;
    coins: number;
    bonusTitle: string | null;
}

const RARITY_CONFIG: Record<string, {
    label: string;
    gradient: string;
    border: string;
    glow: string;
    icon: string;
    textColor: string;
    bgColor: string;
}> = {
    common: {
        label: 'Comune',
        gradient: 'from-amber-800 via-amber-600 to-amber-800',
        border: 'border-amber-500/50',
        glow: '',
        icon: '📦',
        textColor: 'text-amber-300',
        bgColor: 'bg-gradient-to-b from-[#1a1620] to-[#12100e]',
    },
    rare: {
        label: 'Raro',
        gradient: 'from-blue-700 via-blue-500 to-blue-700',
        border: 'border-blue-400/60',
        glow: 'shadow-[0_0_30px_rgba(59,130,246,0.4)]',
        icon: '💎',
        textColor: 'text-blue-300',
        bgColor: 'bg-gradient-to-b from-[#0f1628] to-[#0a0e1a]',
    },
    epic: {
        label: 'Epico',
        gradient: 'from-purple-800 via-purple-500 to-purple-800',
        border: 'border-purple-400/60',
        glow: 'shadow-[0_0_40px_rgba(168,85,247,0.5)]',
        icon: '🔮',
        textColor: 'text-purple-300',
        bgColor: 'bg-gradient-to-b from-[#1a0f28] to-[#100a1a]',
    },
    legendary: {
        label: 'Leggendario',
        gradient: 'from-yellow-600 via-yellow-400 to-yellow-600',
        border: 'border-yellow-400/70',
        glow: 'shadow-[0_0_50px_rgba(234,179,8,0.6)]',
        icon: '👑',
        textColor: 'text-yellow-300',
        bgColor: 'bg-gradient-to-b from-[#1a1608] to-[#14100a]',
    },
};

// ─── Helpers ───────────────────────────────────────────────────────────

function getTodayString(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); // YYYY-MM-DD
}

function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getInitialChestState(): ChestState {
    return {
        actionCount: 0,
        threshold: randomBetween(MIN_ACTIONS_THRESHOLD, MAX_ACTIONS_THRESHOLD),
        spawnedAt: null,
        readyAt: null,
        phase: 'hidden',
        date: getTodayString(),
        claimedToday: 0,
    };
}

function loadChestState(): ChestState {
    if (typeof window === 'undefined') return getInitialChestState();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return getInitialChestState();
        const state = JSON.parse(raw) as ChestState;
        // Daily reset
        if (state.date !== getTodayString()) {
            return getInitialChestState();
        }
        return state;
    } catch {
        return getInitialChestState();
    }
}

function saveChestState(state: ChestState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* quota exceeded — silent fail */ }
}

function formatCountdown(ms: number): string {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ─── Component ─────────────────────────────────────────────────────────

export function TimedChest({ userId }: { userId: string }) {
    const router = useRouter();
    const [chestState, setChestState] = useState<ChestState>(getInitialChestState);
    const [uiPhase, setUiPhase] = useState<UIPhase>('hidden');
    const [countdown, setCountdown] = useState('');
    const [reward, setReward] = useState<ChestReward | null>(null);
    const [loading, setLoading] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const mountedRef = useRef(true);

    // Load state from localStorage on mount
    useEffect(() => {
        mountedRef.current = true;
        const loaded = loadChestState();
        setChestState(loaded);

        // Determine UI phase from persisted state
        if (loaded.phase === 'spawned' && loaded.readyAt) {
            const readyTime = new Date(loaded.readyAt).getTime();
            if (Date.now() >= readyTime) {
                setUiPhase('ready');
                const updated = { ...loaded, phase: 'ready' as const };
                setChestState(updated);
                saveChestState(updated);
            } else {
                setUiPhase('spawned');
            }
        } else if (loaded.phase === 'ready') {
            setUiPhase('ready');
        } else if (loaded.phase === 'claimed') {
            setUiPhase('hidden');
        } else {
            setUiPhase('hidden');
        }

        return () => { mountedRef.current = false; };
    }, []);

    // Listen for reward_earned events to count actions
    useEffect(() => {
        function handleRewardEarned() {
            setChestState(prev => {
                // Don't count if chest already spawned/ready for this cycle
                if (prev.phase !== 'hidden') return prev;

                const updated = { ...prev, actionCount: prev.actionCount + 1 };

                // Check if threshold reached → spawn chest
                if (updated.actionCount >= updated.threshold) {
                    const countdownMs = randomBetween(MIN_COUNTDOWN_MINUTES, MAX_COUNTDOWN_MINUTES) * 60 * 1000;
                    const now = new Date();
                    const readyAt = new Date(now.getTime() + countdownMs);

                    updated.phase = 'spawned';
                    updated.spawnedAt = now.toISOString();
                    updated.readyAt = readyAt.toISOString();

                    // Trigger spawned UI
                    setUiPhase('spawned');
                }

                saveChestState(updated);
                return updated;
            });
        }

        window.addEventListener('reward_earned', handleRewardEarned);
        return () => window.removeEventListener('reward_earned', handleRewardEarned);
    }, []);

    // Countdown timer for spawned phase
    useEffect(() => {
        if (uiPhase !== 'spawned' || !chestState.readyAt) {
            if (timerRef.current) clearInterval(timerRef.current);
            return;
        }

        const readyTime = new Date(chestState.readyAt).getTime();

        function tick() {
            if (!mountedRef.current) return;
            const remaining = readyTime - Date.now();
            if (remaining <= 0) {
                setCountdown('00:00');
                setUiPhase('ready');
                setChestState(prev => {
                    const updated = { ...prev, phase: 'ready' as const };
                    saveChestState(updated);
                    return updated;
                });
                if (timerRef.current) clearInterval(timerRef.current);
            } else {
                setCountdown(formatCountdown(remaining));
            }
        }

        tick(); // immediate
        timerRef.current = setInterval(tick, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [uiPhase, chestState.readyAt]);

    // Open the chest — fetch reward first, then animate with correct rarity
    const handleOpen = useCallback(async () => {
        if (uiPhase !== 'ready' || loading) return;
        setLoading(true);
        setMinimized(false);

        // Call server first to get rarity for animation visuals
        const result = await claimTimedChestReward(userId);

        if (!mountedRef.current) return;

        if (result.success && result.reward) {
            setReward(result.reward);
            // Now start the opening animation with known rarity
            setUiPhase('opening');
        } else {
            // Server rejected (cooldown or error) — reset to hidden and clear localStorage
            const resetState: ChestState = {
                actionCount: 0,
                threshold: randomBetween(MIN_ACTIONS_THRESHOLD, MAX_ACTIONS_THRESHOLD),
                spawnedAt: null,
                readyAt: null,
                phase: 'hidden',
                date: getTodayString(),
                claimedToday: chestState.claimedToday,
            };
            setChestState(resetState);
            saveChestState(resetState);
            setUiPhase('hidden');
            setLoading(false);
        }
    }, [uiPhase, loading, userId]);

    // Called when ChestOpeningAnimation finishes its 3-phase sequence
    const handleAnimationComplete = useCallback(() => {
        if (!mountedRef.current) return;
        setUiPhase('revealed');
        setLoading(false);

        // Celebration effects for high-rarity chests
        if (reward) {
            if (reward.rarity === 'legendary') {
                triggerCelebration('loot_reveal', { type: 'loot_reveal', lootRarity: 'legendary' });
            } else if (reward.rarity === 'epic') {
                triggerCelebration('loot_reveal', { type: 'loot_reveal', lootRarity: 'epic' });
            } else if (reward.rarity === 'rare') {
                triggerCelebration('confetti');
            }
        }
    }, [reward]);

    // Close and reset for next cycle
    const handleClose = useCallback(() => {
        setReward(null);
        setUiPhase('hidden');

        // Reset state for next cycle with new random threshold
        const newState: ChestState = {
            actionCount: 0,
            threshold: randomBetween(MIN_ACTIONS_THRESHOLD, MAX_ACTIONS_THRESHOLD),
            spawnedAt: null,
            readyAt: null,
            phase: 'hidden',
            date: getTodayString(),
            claimedToday: (chestState.claimedToday || 0) + 1,
        };
        setChestState(newState);
        saveChestState(newState);

        router.refresh();
    }, [chestState.claimedToday, router]);

    // ─── Render ────────────────────────────────────────────────────────

    // Hidden phase — no UI
    if (uiPhase === 'hidden') return null;

    // Spawned phase (minimized) — small floating chest icon
    if ((uiPhase === 'spawned' || uiPhase === 'ready') && minimized) {
        return (
            <SafeWrapper fallback={null}>
            <div className="fixed bottom-6 right-6 z-50">
                <button
                    onClick={() => setMinimized(false)}
                    className={`relative flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-300
                        ${uiPhase === 'ready'
                            ? 'bg-gradient-to-r from-[#1a1620] to-[#2a1f30] border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.3)] animate-chest-ready-pulse'
                            : 'bg-gradient-to-r from-[#1a1620] to-[#201828] border-[var(--color-fire-400)]/30 shadow-[0_0_12px_rgba(255,140,66,0.2)]'
                        }
                        hover:scale-105`}
                >
                    <div className={uiPhase === 'ready' ? 'animate-chest-shake-subtle' : 'animate-chest-glow-pulse'}>
                        <Package className={`w-6 h-6 ${uiPhase === 'ready' ? 'text-yellow-400' : 'text-[var(--color-fire-400)]'}`} />
                    </div>
                    {uiPhase === 'spawned' && (
                        <span className="text-xs font-mono text-[var(--color-fire-300)]">{countdown}</span>
                    )}
                    {uiPhase === 'ready' && (
                        <span className="text-xs font-bold text-yellow-400">APRI!</span>
                    )}
                </button>
            </div>
            </SafeWrapper>
        );
    }

    // Spawned phase — chest with countdown
    if (uiPhase === 'spawned') {
        return (
            <SafeWrapper fallback={null}>
            <div className="fixed bottom-6 right-6 z-50 animate-chest-entrance">
                <div className="relative w-72 rounded-2xl border border-[var(--color-fire-400)]/30 bg-gradient-to-b from-[#1a1620] to-[#12100e] shadow-[0_0_30px_rgba(255,140,66,0.15)] overflow-hidden">
                    {/* Minimize button */}
                    <button
                        onClick={() => setMinimized(true)}
                        className="absolute top-2 right-2 text-white/30 hover:text-white/70 transition-colors z-10"
                    >
                        <X className="w-4 h-4" />
                    </button>

                    <div className="p-5 text-center">
                        {/* Chest icon with glow pulse */}
                        <div className="relative mx-auto mb-3 w-16 h-16 flex items-center justify-center animate-chest-glow-pulse">
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--color-fire-400)] via-amber-500 to-yellow-600 flex items-center justify-center border border-amber-400/40 shadow-[0_0_20px_rgba(255,140,66,0.3)]">
                                <Package className="w-8 h-8 text-[#1a1620]" />
                            </div>
                            {/* Sparkle particles */}
                            <div className="absolute -top-1 -right-1 animate-chest-sparkle-1"><Sparkles className="w-3.5 h-3.5 text-amber-400/70" /></div>
                            <div className="absolute -bottom-1 -left-1 animate-chest-sparkle-2"><Sparkles className="w-3 h-3 text-[var(--color-fire-400)]/60" /></div>
                        </div>

                        <h3 className="text-sm font-bold text-white/90 mb-1">Scrigno a Tempo</h3>
                        <p className="text-[11px] text-white/40 mb-3">Si sblocca tra...</p>

                        {/* Countdown */}
                        <div className="flex items-center justify-center gap-2 mb-3">
                            <Timer className="w-4 h-4 text-[var(--color-fire-400)]" />
                            <span className="text-2xl font-mono font-bold text-[var(--color-fire-400)] tracking-wider">
                                {countdown}
                            </span>
                        </div>

                        {/* Progress bar to ready */}
                        {chestState.spawnedAt && chestState.readyAt && (
                            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-fire-500)] to-amber-400 transition-all duration-1000"
                                    style={{
                                        width: `${Math.min(100, Math.max(0,
                                            ((Date.now() - new Date(chestState.spawnedAt).getTime()) /
                                            (new Date(chestState.readyAt).getTime() - new Date(chestState.spawnedAt).getTime())) * 100
                                        ))}%`
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </SafeWrapper>
        );
    }

    // Ready phase — chest ready to open
    if (uiPhase === 'ready') {
        return (
            <SafeWrapper fallback={null}>
            <div className="fixed bottom-6 right-6 z-50 animate-chest-entrance">
                <div className="relative w-72 rounded-2xl border border-yellow-500/40 bg-gradient-to-b from-[#1a1620] to-[#14100e] shadow-[0_0_30px_rgba(234,179,8,0.25)] overflow-hidden animate-chest-ready-pulse">
                    {/* Minimize button */}
                    <button
                        onClick={() => setMinimized(true)}
                        className="absolute top-2 right-2 text-white/30 hover:text-white/70 transition-colors z-10"
                    >
                        <X className="w-4 h-4" />
                    </button>

                    <div className="p-5 text-center">
                        {/* Chest icon with intense shake */}
                        <div className="relative mx-auto mb-3 w-16 h-16 flex items-center justify-center animate-chest-shake-subtle">
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-yellow-500 via-amber-400 to-yellow-600 flex items-center justify-center border border-yellow-400/60 shadow-[0_0_25px_rgba(234,179,8,0.4)]">
                                <Package className="w-8 h-8 text-[#1a1620]" />
                            </div>
                            {/* Intense sparkle particles */}
                            <div className="absolute -top-2 -right-2 animate-chest-sparkle-1"><Sparkles className="w-4 h-4 text-yellow-400" /></div>
                            <div className="absolute -bottom-2 -left-2 animate-chest-sparkle-2"><Sparkles className="w-3.5 h-3.5 text-amber-400" /></div>
                            <div className="absolute top-0 left-0 animate-chest-sparkle-3"><Sparkles className="w-3 h-3 text-yellow-300/70" /></div>
                        </div>

                        <h3 className="text-sm font-bold text-yellow-300 mb-1">Scrigno Pronto!</h3>
                        <p className="text-[11px] text-white/50 mb-4">Tocca per aprire e scoprire il tuo premio</p>

                        <button
                            onClick={handleOpen}
                            className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-500 text-[#1a1620] hover:shadow-[0_0_20px_rgba(234,179,8,0.5)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                        >
                            Apri lo Scrigno
                        </button>
                    </div>
                </div>
            </div>
            </SafeWrapper>
        );
    }

    // Opening + Revealed phases — handled by ChestOpeningAnimation
    if ((uiPhase === 'opening' || uiPhase === 'revealed') && reward) {
        const config = RARITY_CONFIG[reward.rarity] || RARITY_CONFIG.common;

        return (
            <SafeWrapper fallback={null}>
            <ChestOpeningAnimation
                isOpening={uiPhase === 'opening'}
                rarity={(reward.rarity as ChestRarity) || 'common'}
                onAnimationComplete={handleAnimationComplete}
            >
                {/* Revealed reward content — rendered after animation completes */}
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
                    onClick={handleClose}
                >
                    <div
                        className="relative max-w-sm w-full mx-4 animate-chest-reveal-entrance"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className={`rounded-2xl border-2 ${config.border} ${config.bgColor} ${config.glow} p-8 text-center overflow-hidden`}>
                            {/* Close button */}
                            <button
                                onClick={handleClose}
                                className="absolute top-3 right-3 text-white/30 hover:text-white/70 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            {/* Rarity badge */}
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4 ${config.textColor} bg-white/10 border border-white/20`}>
                                <span>{config.icon}</span>
                                <span>{config.label}</span>
                            </div>

                            {/* Reward icon orb */}
                            <div className={`mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center bg-gradient-to-br ${config.gradient} animate-chest-reward-pulse`}>
                                {reward.bonusTitle ? (
                                    <Crown className="w-10 h-10 text-white" />
                                ) : (
                                    <Coins className="w-10 h-10 text-white" />
                                )}
                            </div>

                            {/* Coins reward */}
                            <div className="flex items-center justify-center gap-2 mb-2">
                                <Coins className="w-6 h-6 text-yellow-400" />
                                <span className="text-3xl font-bold text-white">+{reward.coins}</span>
                                <span className="text-yellow-300/80 text-lg font-medium">coins</span>
                            </div>

                            {/* Bonus title for legendary */}
                            {reward.bonusTitle && (
                                <div className="mt-3 p-3 rounded-xl bg-white/10 border border-yellow-400/30">
                                    <div className="text-xs text-yellow-400/70 uppercase tracking-wider mb-1">Titolo Sbloccato</div>
                                    <div className="text-lg font-bold text-yellow-300">{reward.bonusTitle}</div>
                                </div>
                            )}

                            <button
                                onClick={handleClose}
                                className="mt-6 w-full py-3 px-6 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/20 transition-all"
                            >
                                Fantastico!
                            </button>
                        </div>
                    </div>
                </div>
            </ChestOpeningAnimation>
            </SafeWrapper>
        );
    }

    return null;
}
