'use client';

import { useEffect, useState, useCallback } from 'react';
import { Coins, Zap, Crown, X } from 'lucide-react';
import { getUserPendingLootDrops, openLootDrop } from '@/app/actions/lootDropActions';
import { useRouter } from 'next/navigation';
import { triggerCelebration } from '@/lib/animationUtils';
import { ChestOpeningAnimation, type ChestRarity } from '@/components/ChestOpeningAnimation';
import { SafeWrapper } from '@/components/SafeWrapper';

interface PendingDrop {
    id: string;
    rarity: string;
    droppedAt: Date;
}

interface RevealedReward {
    rarity: string;
    coins: number;
    bonusXp: number;
    bonusTitle: string | null;
    rewardType: string;
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
        gradient: 'from-ash-600 via-ash-500 to-ash-600',
        border: 'border-ash-400',
        glow: '',
        icon: '📦',
        textColor: 'text-ash-300',
        bgColor: 'bg-ash-700',
    },
    rare: {
        label: 'Raro',
        gradient: 'from-blue-700 via-blue-500 to-blue-700',
        border: 'border-blue-400',
        glow: 'shadow-[0_0_30px_rgba(59,130,246,0.5)]',
        icon: '💎',
        textColor: 'text-blue-300',
        bgColor: 'bg-blue-900',
    },
    epic: {
        label: 'Epico',
        gradient: 'from-purple-800 via-purple-500 to-purple-800',
        border: 'border-purple-400',
        glow: 'animate-loot-glow-purple',
        icon: '🔮',
        textColor: 'text-purple-300',
        bgColor: 'bg-purple-900',
    },
    legendary: {
        label: 'Leggendario',
        gradient: 'from-gold-700 via-gold-400 to-gold-700',
        border: 'border-gold-400',
        glow: 'animate-loot-glow-gold',
        icon: '👑',
        textColor: 'text-gold-300',
        bgColor: 'bg-gold-900',
    },
};

export function LootDropModal({ userId }: { userId: string }) {
    const router = useRouter();
    const [pendingDrops, setPendingDrops] = useState<PendingDrop[]>([]);
    const [currentDrop, setCurrentDrop] = useState<PendingDrop | null>(null);
    const [phase, setPhase] = useState<'idle' | 'opening' | 'revealed'>('idle');
    const [reward, setReward] = useState<RevealedReward | null>(null);
    const [loading, setLoading] = useState(false);

    // Check for pending loot drops on mount
    useEffect(() => {
        async function check() {
            const { drops } = await getUserPendingLootDrops(userId);
            if (drops.length > 0) {
                setPendingDrops(drops);
                setCurrentDrop(drops[0]);
            }
        }
        check();
    }, [userId]);

    const handleOpen = useCallback(async () => {
        if (!currentDrop || loading) return;
        setLoading(true);

        // Call server first to get reward and actual rarity
        const result = await openLootDrop(userId, currentDrop.id);

        if (result.success && result.reward) {
            setReward(result.reward);
            // Start the 3-phase suspense animation with known rarity
            setPhase('opening');
        } else {
            setPhase('idle');
            setLoading(false);
        }
    }, [currentDrop, userId, loading]);

    const handleAnimationComplete = useCallback(() => {
        setPhase('revealed');
        setLoading(false);

        // Trigger celebration effects for high-rarity drops
        if (reward) {
            if (reward.rarity === 'epic' || reward.rarity === 'legendary') {
                triggerCelebration('loot_reveal', { type: 'loot_reveal', lootRarity: reward.rarity });
            } else if (reward.rarity === 'rare') {
                triggerCelebration('confetti');
            }
        }
    }, [reward]);

    const handleClose = useCallback(() => {
        setPhase('idle');
        setReward(null);
        setCurrentDrop(null);

        // Remove this drop from pending and show next if any
        const remaining = pendingDrops.filter(d => d.id !== currentDrop?.id);
        setPendingDrops(remaining);
        if (remaining.length > 0) {
            setCurrentDrop(remaining[0]);
        }

        router.refresh();
    }, [pendingDrops, currentDrop, router]);

    // Nothing to show
    if (!currentDrop) return null;

    const config = RARITY_CONFIG[reward?.rarity || 'common'];

    // Opening phase — ChestOpeningAnimation handles the suspense
    if (phase === 'opening' && reward) {
        return (
            <SafeWrapper fallback={null}>
            <ChestOpeningAnimation
                isOpening={true}
                rarity={(reward.rarity as ChestRarity) || 'common'}
                onAnimationComplete={handleAnimationComplete}
            >
                {/* This renders after animation completes — but we'll transition to 'revealed' phase instead */}
                <div />
            </ChestOpeningAnimation>
            </SafeWrapper>
        );
    }

    // Idle phase — show loot crate with open button
    if (phase === 'idle') {
        return (
            <SafeWrapper fallback={null}>
            <div className="modal-backdrop" style={{ zIndex: 60 }}>
                <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 61 }}>
                    <div className="relative max-w-sm w-full mx-2 sm:mx-4" onClick={e => e.stopPropagation()}>
                        <div className="modal-content p-8 text-center bg-gradient-to-b from-brand-charcoal via-ash-800 to-ash-900">
                            <div className="relative mx-auto mb-6 w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center">
                                <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-brand-orange-600 via-brand-orange to-gold-400 flex items-center justify-center border-2 border-brand-orange-300 shadow-glow-orange">
                                    <svg className="w-14 h-14 text-brand-charcoal" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                                </div>
                            </div>

                            <h2 className="text-xl font-bold text-white mb-2">Loot Drop!</h2>
                            <p className="text-ash-400 text-sm mb-6">
                                Hai sbloccato un bottino per i tuoi appuntamenti!
                            </p>

                            <button
                                onClick={handleOpen}
                                disabled={loading}
                                className={`w-full py-3 px-6 rounded-xl font-bold text-lg transition-all duration-300 ${
                                    loading
                                        ? 'bg-ash-600 text-ash-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-brand-orange via-gold-400 to-brand-orange text-brand-charcoal hover:shadow-glow-gold hover:-translate-y-0.5 active:translate-y-0'
                                }`}
                            >
                                {loading ? 'Apertura...' : 'Apri il Bottino'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            </SafeWrapper>
        );
    }

    // Revealed phase — show reward
    if (phase === 'revealed' && reward) {
        return (
            <SafeWrapper fallback={null}>
            <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={handleClose}>
                <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 61 }}>
                    <div className="relative max-w-sm w-full mx-2 sm:mx-4" onClick={e => e.stopPropagation()}>
                        <div className={`modal-content p-8 text-center bg-gradient-to-b ${config.bgColor} border-2 ${config.border} ${config.glow} animate-loot-reveal`}>
                            {/* Close button */}
                            <button
                                onClick={handleClose}
                                className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            {/* Rarity badge */}
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4 ${config.textColor} bg-white/10 border border-white/20`}>
                                <span>{config.icon}</span>
                                <span>{config.label}</span>
                            </div>

                            {/* Reward icon */}
                            <div className={`mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center bg-gradient-to-br ${config.gradient} animate-loot-glow`}>
                                {reward.rewardType === 'coins_title' ? (
                                    <Crown className="w-10 h-10 text-white" />
                                ) : reward.rewardType === 'coins_xp' ? (
                                    <Zap className="w-10 h-10 text-white" />
                                ) : (
                                    <Coins className="w-10 h-10 text-white" />
                                )}
                            </div>

                            {/* Coins reward */}
                            <div className="flex items-center justify-center gap-2 mb-2">
                                <Coins className="w-6 h-6 text-gold-400" />
                                <span className="text-3xl font-bold text-white">+{reward.coins}</span>
                                <span className="text-gold-300 text-lg font-medium">coins</span>
                            </div>

                            {/* Bonus XP for epic */}
                            {reward.bonusXp > 0 && (
                                <div className="flex items-center justify-center gap-2 mb-2">
                                    <Zap className="w-5 h-5 text-purple-400" />
                                    <span className="text-xl font-bold text-purple-300">+{reward.bonusXp} XP</span>
                                </div>
                            )}

                            {/* Bonus title for legendary */}
                            {reward.bonusTitle && (
                                <div className="mt-3 p-3 rounded-xl bg-white/10 border border-gold-400/30">
                                    <div className="text-xs text-gold-400/70 uppercase tracking-wider mb-1">Titolo Sbloccato</div>
                                    <div className="text-lg font-bold text-gold-300">{reward.bonusTitle}</div>
                                </div>
                            )}

                            <button
                                onClick={handleClose}
                                className="mt-6 w-full py-3 px-6 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/20 transition-all"
                            >
                                {pendingDrops.length > 1 ? `Continua (${pendingDrops.length - 1} rimanenti)` : 'Fantastico!'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            </SafeWrapper>
        );
    }

    return null;
}
