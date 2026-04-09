"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getAnimationsEnabled } from "@/lib/animationUtils";

type ToastType = 'creature_drop' | 'boss_defeated' | 'chest_ready';
type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
type Phase = 'enter' | 'visible' | 'exit';

interface UniverseToastData {
    type: ToastType;
    creatureName?: string;
    rarity?: Rarity;
    bossName?: string;
    rewardCoins?: number;
    chestType?: string;
}

interface ToastItem extends UniverseToastData {
    id: string;
    phase: Phase;
}

const MAX_TOASTS = 2;
const TOAST_DURATION = 4000;
const EXIT_DURATION = 350;

const RARITY_STYLES: Record<Rarity, { border: string; glow: string; bg: string; label: string }> = {
    common: { border: 'border-slate-400', glow: '0 0 12px rgba(148,163,184,0.3)', bg: 'bg-slate-800/95', label: 'Comune' },
    rare: { border: 'border-blue-400', glow: '0 0 16px rgba(59,130,246,0.5)', bg: 'bg-slate-800/95', label: 'Raro' },
    epic: { border: 'border-purple-400', glow: '0 0 20px rgba(168,85,247,0.6)', bg: 'bg-slate-800/95', label: 'Epico' },
    legendary: { border: 'border-yellow-400', glow: '0 0 24px rgba(251,191,36,0.7)', bg: 'bg-slate-800/95', label: 'Leggendario' },
};

function ToastIcon({ type }: { type: ToastType }) {
    if (type === 'creature_drop') return <span className="text-2xl">🥚</span>;
    if (type === 'boss_defeated') return <span className="text-2xl">⚔️</span>;
    return <span className="text-2xl">📦</span>;
}

function UniverseToastInner() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const animEnabled = useRef(true);

    useEffect(() => {
        animEnabled.current = getAnimationsEnabled();
    }, []);

    const addToast = useCallback((data: UniverseToastData) => {
        const id = crypto.randomUUID();
        const newToast: ToastItem = { ...data, id, phase: animEnabled.current ? 'enter' : 'visible' };

        setToasts(prev => {
            const updated = [...prev, newToast];
            // Keep max toasts: remove oldest if exceeded
            if (updated.length > MAX_TOASTS) {
                return updated.slice(updated.length - MAX_TOASTS);
            }
            return updated;
        });

        // Transition to visible
        if (animEnabled.current) {
            setTimeout(() => {
                setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'visible' } : t));
            }, 50);
        }

        // Start exit
        setTimeout(() => {
            setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'exit' } : t));
        }, TOAST_DURATION);

        // Remove from DOM
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, TOAST_DURATION + EXIT_DURATION);
    }, []);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<UniverseToastData>).detail;
            if (detail) addToast(detail);
        };
        window.addEventListener('universe_toast', handler);
        return () => window.removeEventListener('universe_toast', handler);
    }, [addToast]);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9997] flex flex-col gap-3 pointer-events-none">
            {toasts.map(toast => {
                const rarity = toast.rarity || 'common';
                const style = RARITY_STYLES[rarity];
                const isLegendary = rarity === 'legendary';

                const phaseStyle = toast.phase === 'enter'
                    ? 'translate-x-[120%] opacity-0'
                    : toast.phase === 'exit'
                        ? 'translate-x-[120%] opacity-0'
                        : 'translate-x-0 opacity-100';

                return (
                    <div
                        key={toast.id}
                        className={`
                            pointer-events-auto min-w-[320px] max-w-[400px] rounded-xl border-2
                            ${style.border} ${style.bg} backdrop-blur-sm p-4
                            transition-all duration-300 ease-out ${phaseStyle}
                            ${isLegendary ? 'universe-toast-legendary' : ''}
                        `}
                        style={{ boxShadow: style.glow }}
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0">
                                <ToastIcon type={toast.type} />
                            </div>
                            <div className="flex-1 min-w-0">
                                {toast.type === 'creature_drop' && (
                                    <>
                                        <div className="text-sm font-bold text-white">Nuova Creatura!</div>
                                        <div className="text-sm text-slate-300 truncate">
                                            {toast.creatureName || 'Creatura misteriosa'}
                                        </div>
                                        <div className={`text-xs font-semibold mt-1 ${
                                            rarity === 'legendary' ? 'text-yellow-400' :
                                            rarity === 'epic' ? 'text-purple-400' :
                                            rarity === 'rare' ? 'text-blue-400' :
                                            'text-slate-400'
                                        }`}>
                                            {style.label}
                                        </div>
                                    </>
                                )}
                                {toast.type === 'boss_defeated' && (
                                    <>
                                        <div className="text-sm font-bold text-amber-400">Boss Sconfitto!</div>
                                        <div className="text-sm text-slate-300 truncate">
                                            {toast.bossName || 'Boss'}
                                        </div>
                                        {toast.rewardCoins && (
                                            <div className="text-xs text-yellow-400 mt-1">
                                                +{toast.rewardCoins} Fenice Coins
                                            </div>
                                        )}
                                    </>
                                )}
                                {toast.type === 'chest_ready' && (
                                    <>
                                        <div className="text-sm font-bold text-emerald-400">Baule Pronto!</div>
                                        <div className="text-sm text-slate-300">
                                            Baule {toast.chestType || ''} pronto per l&apos;apertura
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Top shimmer for rare+ */}
                        {rarity !== 'common' && (
                            <div
                                className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
                                style={{
                                    background: rarity === 'legendary'
                                        ? 'linear-gradient(90deg, transparent, #fbbf24, transparent)'
                                        : rarity === 'epic'
                                            ? 'linear-gradient(90deg, transparent, #a855f7, transparent)'
                                            : 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
                                    animation: animEnabled.current ? 'universe-shimmer 2s ease-in-out infinite' : 'none',
                                }}
                            />
                        )}
                    </div>
                );
            })}

            <style jsx>{`
                @keyframes universe-shimmer {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 1; }
                }
                @keyframes universe-shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
                    20%, 40%, 60%, 80% { transform: translateX(2px); }
                }
                .universe-toast-legendary {
                    animation: universe-shake 0.5s ease-in-out;
                }
            `}</style>
        </div>
    );
}

export function UniverseToast() {
    return (
        <SafeWrapper>
            <UniverseToastInner />
        </SafeWrapper>
    );
}
