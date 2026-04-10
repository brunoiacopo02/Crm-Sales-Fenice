'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, Lock, Coins, Sparkles } from 'lucide-react';
import { getOrCreateActiveChests, openChest } from '@/app/actions/chestActions';
import type { ChestRarity } from '@/components/ChestOpeningAnimation';
import { SafeWrapper } from '@/components/SafeWrapper';
import dynamic from 'next/dynamic';

const ChestOpeningAnimation = dynamic(() => import('@/components/ChestOpeningAnimation').then(m => ({ default: m.ChestOpeningAnimation })), { ssr: false });

// ─── Types ─────────────────────────────────────────────────────────────

interface ChestData {
    id: string;
    userId: string;
    chestType: string;
    requiredMetric: string;
    requiredValue: number;
    currentValue: number;
    isReady: boolean;
    openedAt: Date | null;
    rewardCreatureId: string | null;
    rewardCoins: number | null;
}

interface ChestWidgetProps {
    userId: string;
    isTeam?: boolean;
}

// ─── Config ────────────────────────────────────────────────────────────

const CHEST_CONFIG: Record<string, {
    label: string;
    gradient: string;
    borderColor: string;
    glowColor: string;
    iconBg: string;
    barColor: string;
}> = {
    bronze: {
        label: 'Bronzo',
        gradient: 'from-amber-800/40 to-amber-900/30',
        borderColor: 'border-amber-600/40',
        glowColor: 'rgba(217,119,6,0.6)',
        iconBg: 'bg-amber-700/50',
        barColor: 'bg-amber-500',
    },
    silver: {
        label: 'Argento',
        gradient: 'from-slate-400/30 to-slate-500/20',
        borderColor: 'border-slate-400/40',
        glowColor: 'rgba(148,163,184,0.6)',
        iconBg: 'bg-slate-500/50',
        barColor: 'bg-slate-400',
    },
    gold: {
        label: 'Oro',
        gradient: 'from-yellow-600/40 to-yellow-700/30',
        borderColor: 'border-yellow-500/50',
        glowColor: 'rgba(234,179,8,0.7)',
        iconBg: 'bg-yellow-600/50',
        barColor: 'bg-yellow-400',
    },
    platinum: {
        label: 'Platino',
        gradient: 'from-purple-600/30 to-purple-700/20',
        borderColor: 'border-purple-400/40',
        glowColor: 'rgba(168,85,247,0.6)',
        iconBg: 'bg-purple-600/50',
        barColor: 'bg-purple-400',
    },
};

const METRIC_LABELS: Record<string, string> = {
    chiamate: 'Chiamate',
    fissaggi: 'Fissaggi',
    presenze: 'Presenze',
    chiusure: 'Chiusure',
    conferme: 'Conferme',
};

// ─── Sub-components ────────────────────────────────────────────────────

function ChestProgressBar({ current, required, barColor }: { current: number; required: number; barColor: string }) {
    const pct = Math.min((current / required) * 100, 100);
    return (
        <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
            <div
                className={`${barColor} h-2.5 rounded-full transition-[width] duration-700 ease-out`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

function RewardReveal({ coins, creature, onClose }: {
    coins: number | null;
    creature: { name: string; rarity: string; element: string } | null;
    onClose: () => void;
}) {
    const rarityColors: Record<string, string> = {
        common: 'text-stone-300',
        rare: 'text-blue-400',
        epic: 'text-purple-400',
        legendary: 'text-yellow-400',
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl p-8 border border-white/10 shadow-2xl max-w-sm w-full mx-4 text-center">
                <div className="text-lg font-bold text-white mb-4">Ricompense Ottenute!</div>

                {coins != null && coins > 0 && (
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Coins className="w-6 h-6 text-yellow-400" />
                        <div className="text-2xl font-black text-yellow-400">+{coins}</div>
                        <div className="text-sm text-gray-400">Fenice Coins</div>
                    </div>
                )}

                {creature && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/10 mb-4">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <Sparkles className={`w-5 h-5 ${rarityColors[creature.rarity] || 'text-white'}`} />
                            <div className={`text-lg font-bold ${rarityColors[creature.rarity] || 'text-white'}`}>
                                {creature.name}
                            </div>
                        </div>
                        <div className="text-xs text-gray-400 uppercase tracking-wider">
                            {creature.rarity} &bull; {creature.element}
                        </div>
                    </div>
                )}

                {!creature && (
                    <div className="text-sm text-gray-400 mb-4">Nessuna creatura questa volta...</div>
                )}

                <button
                    onClick={onClose}
                    className="w-full py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orange/80 text-white font-semibold transition-colors"
                >
                    Continua
                </button>
            </div>
        </div>
    );
}

// ─── Main Component ────────────────────────────────────────────────────

function ChestWidgetInner({ userId, isTeam = false }: ChestWidgetProps) {
    const [chests, setChests] = useState<ChestData[]>([]);
    const [loading, setLoading] = useState(true);
    const [openingChestId, setOpeningChestId] = useState<string | null>(null);
    const [animatingRarity, setAnimatingRarity] = useState<ChestRarity | null>(null);
    const [reward, setReward] = useState<{ coins: number | null; creature: any } | null>(null);

    const loadChests = useCallback(async () => {
        try {
            const data = await getOrCreateActiveChests(userId, isTeam);
            // Only show active (unopened) chests
            const active = data.filter((c: ChestData) => !c.openedAt);
            setChests(active);
        } catch (err) {
            console.error('Error loading chests:', err);
        } finally {
            setLoading(false);
        }
    }, [userId, isTeam]);

    useEffect(() => {
        loadChests();

        // Listen for realtime updates (actions increment chest progress)
        const handler = () => loadChests();
        window.addEventListener('realtime_update', handler);
        return () => window.removeEventListener('realtime_update', handler);
    }, [loadChests]);

    const handleOpenChest = useCallback(async (chest: ChestData) => {
        if (!chest.isReady || openingChestId) return;

        // Map chest type to animation rarity
        const rarityMap: Record<string, ChestRarity> = {
            bronze: 'common',
            silver: 'rare',
            gold: 'epic',
            platinum: 'legendary',
        };

        setOpeningChestId(chest.id);
        setAnimatingRarity(rarityMap[chest.chestType] || 'common');
    }, [openingChestId]);

    const handleAnimationComplete = useCallback(async () => {
        if (!openingChestId) return;

        const result = await openChest(userId, openingChestId);

        if (result.success) {
            setReward({ coins: result.rewardCoins ?? null, creature: result.creature });
        }

        setAnimatingRarity(null);
        setOpeningChestId(null);
    }, [openingChestId, userId]);

    const handleRewardClose = useCallback(() => {
        setReward(null);
        loadChests();
    }, [loadChests]);

    // Loading skeleton
    if (loading) {
        return (
            <div className="bg-gradient-to-r from-brand-charcoal to-gray-800 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-gray-600 rounded w-32 mb-3" />
                <div className="grid grid-cols-2 gap-3">
                    <div className="h-24 bg-gray-700 rounded-lg" />
                    <div className="h-24 bg-gray-700 rounded-lg" />
                </div>
            </div>
        );
    }

    if (chests.length === 0) return null;

    // Sort: ready first, then by progress percentage desc
    const sorted = [...chests].sort((a, b) => {
        if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
        const pctA = a.requiredValue > 0 ? a.currentValue / a.requiredValue : 0;
        const pctB = b.requiredValue > 0 ? b.currentValue / b.requiredValue : 0;
        return pctB - pctA;
    });

    return (
        <div className="bg-gradient-to-r from-brand-charcoal to-gray-800 rounded-xl p-4 shadow-lg">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <Package className="w-4 h-4 text-amber-400" />
                <div className="text-sm font-semibold text-amber-400">
                    {isTeam ? 'Bauli Team' : 'Bauli Azione'}
                </div>
            </div>

            {/* Chest grid */}
            <div className="grid grid-cols-2 gap-3">
                {sorted.map((chest) => {
                    const config = CHEST_CONFIG[chest.chestType] || CHEST_CONFIG.bronze;
                    const metricLabel = METRIC_LABELS[chest.requiredMetric] || chest.requiredMetric;
                    const pct = chest.requiredValue > 0
                        ? Math.min(Math.round((chest.currentValue / chest.requiredValue) * 100), 100)
                        : 0;
                    const isOpening = openingChestId === chest.id;

                    return (
                        <div
                            key={chest.id}
                            className={`
                                relative rounded-lg p-3 border transition-all duration-300
                                bg-gradient-to-br ${config.gradient} ${config.borderColor}
                                ${chest.isReady ? 'ring-1 ring-amber-400/50' : ''}
                                ${isOpening ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            style={chest.isReady ? {
                                boxShadow: `0 0 20px ${config.glowColor}, inset 0 0 15px ${config.glowColor}`,
                                animation: 'chest-glow-pulse 2s ease-in-out infinite',
                            } : undefined}
                        >
                            {/* Chest icon + type */}
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center`}>
                                    {chest.isReady
                                        ? <Sparkles className="w-4 h-4 text-amber-300" />
                                        : <Lock className="w-3.5 h-3.5 text-gray-400" />
                                    }
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-white">Baule {config.label}</div>
                                    <div className="text-[10px] text-gray-400">{metricLabel}</div>
                                </div>
                            </div>

                            {/* Progress */}
                            <div className="mb-2">
                                <div className="flex items-baseline justify-between mb-1">
                                    <div className="text-xs text-gray-300 font-medium">
                                        {chest.currentValue}/{chest.requiredValue}
                                    </div>
                                    <div className="text-[10px] text-gray-500">{pct}%</div>
                                </div>
                                <ChestProgressBar
                                    current={chest.currentValue}
                                    required={chest.requiredValue}
                                    barColor={chest.isReady ? 'bg-amber-400' : config.barColor}
                                />
                            </div>

                            {/* Ready state: APRI button */}
                            {chest.isReady && (
                                <button
                                    onClick={() => handleOpenChest(chest)}
                                    disabled={isOpening}
                                    className="w-full py-1.5 rounded-md bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20"
                                >
                                    Apri Baule
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Chest opening animation overlay */}
            {animatingRarity && (
                <ChestOpeningAnimation
                    isOpening={true}
                    rarity={animatingRarity}
                    onAnimationComplete={handleAnimationComplete}
                >
                    <div />
                </ChestOpeningAnimation>
            )}

            {/* Reward reveal modal */}
            {reward && (
                <RewardReveal
                    coins={reward.coins}
                    creature={reward.creature}
                    onClose={handleRewardClose}
                />
            )}

            {/* Keyframe animations */}
            <style jsx>{`
                @keyframes chest-glow-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
            `}</style>
        </div>
    );
}

// ─── Export with SafeWrapper ───────────────────────────────────────────

export function ChestWidget(props: ChestWidgetProps) {
    return (
        <SafeWrapper>
            <ChestWidgetInner {...props} />
        </SafeWrapper>
    );
}
