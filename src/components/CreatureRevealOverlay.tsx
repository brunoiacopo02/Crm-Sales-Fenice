"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getAnimationsEnabled } from "@/lib/animationUtils";

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
type Phase = 'hidden' | 'glow' | 'creature' | 'info';

interface RevealData {
    creatureName: string;
    rarity: Rarity;
    element: string;
    imageUrl?: string | null;
}

const RARITY_CONFIG: Record<Rarity, {
    glowColor: string;
    textColor: string;
    label: string;
    borderColor: string;
    bgGlow: string;
}> = {
    common: {
        glowColor: '#94a3b8',
        textColor: 'text-slate-300',
        label: 'Comune',
        borderColor: 'border-slate-400',
        bgGlow: 'rgba(148,163,184,0.15)',
    },
    rare: {
        glowColor: '#3b82f6',
        textColor: 'text-blue-300',
        label: 'Raro',
        borderColor: 'border-blue-400',
        bgGlow: 'rgba(59,130,246,0.2)',
    },
    epic: {
        glowColor: '#a855f7',
        textColor: 'text-purple-300',
        label: 'Epico',
        borderColor: 'border-purple-400',
        bgGlow: 'rgba(168,85,247,0.25)',
    },
    legendary: {
        glowColor: '#fbbf24',
        textColor: 'text-yellow-300',
        label: 'Leggendario',
        borderColor: 'border-yellow-400',
        bgGlow: 'rgba(251,191,36,0.3)',
    },
};

const ELEMENT_ICONS: Record<string, string> = {
    fuoco: '🔥', terra: '🌍', acqua: '💧', aria: '💨', luce: '✨', ombra: '🌑',
};

function CreatureRevealInner() {
    const [phase, setPhase] = useState<Phase>('hidden');
    const [data, setData] = useState<RevealData | null>(null);
    const animEnabled = useRef(true);

    useEffect(() => {
        animEnabled.current = getAnimationsEnabled();
    }, []);

    const startReveal = useCallback((reveal: RevealData) => {
        setData(reveal);

        if (!animEnabled.current) {
            // Skip animation, go straight to info
            setPhase('info');
            return;
        }

        // Phase 1: Glow expanding (0.8s)
        setPhase('glow');

        // Phase 2: Creature appears (after 0.8s)
        setTimeout(() => setPhase('creature'), 800);

        // Phase 3: Info card (after 1.8s)
        setTimeout(() => setPhase('info'), 1800);
    }, []);

    const handleClose = useCallback(() => {
        setPhase('hidden');
        setData(null);
    }, []);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<RevealData>).detail;
            if (detail) startReveal(detail);
        };
        window.addEventListener('creature_reveal', handler);
        return () => window.removeEventListener('creature_reveal', handler);
    }, [startReveal]);

    if (phase === 'hidden' || !data) return null;

    const config = RARITY_CONFIG[data.rarity] || RARITY_CONFIG.common;
    const isLegendary = data.rarity === 'legendary';

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
        >
            {/* Glow phase */}
            {phase === 'glow' && (
                <div
                    className="creature-reveal-glow"
                    style={{
                        width: 120,
                        height: 120,
                        borderRadius: '50%',
                        background: `radial-gradient(circle, ${config.glowColor}, transparent)`,
                        animation: 'creature-glow-expand 0.8s ease-out forwards',
                    }}
                />
            )}

            {/* Creature phase */}
            {phase === 'creature' && (
                <div className="flex flex-col items-center creature-reveal-appear">
                    <div
                        className={`w-32 h-32 rounded-2xl border-2 ${config.borderColor} flex items-center justify-center text-5xl`}
                        style={{ boxShadow: `0 0 40px ${config.bgGlow}`, background: 'rgba(15,23,42,0.8)' }}
                    >
                        {ELEMENT_ICONS[data.element] || '🔮'}
                    </div>
                </div>
            )}

            {/* Info phase */}
            {phase === 'info' && (
                <div className={`flex flex-col items-center creature-reveal-info ${isLegendary ? 'creature-legendary-shake' : ''}`}>
                    <div
                        className={`w-36 h-36 rounded-2xl border-2 ${config.borderColor} flex items-center justify-center text-6xl mb-6`}
                        style={{ boxShadow: `0 0 60px ${config.bgGlow}`, background: 'rgba(15,23,42,0.8)' }}
                    >
                        {ELEMENT_ICONS[data.element] || '🔮'}
                    </div>

                    <div className="text-center">
                        <div className={`text-xs font-bold uppercase tracking-widest mb-2 ${config.textColor}`}>
                            {config.label}
                        </div>
                        <div className="text-2xl font-black text-white mb-1">
                            {data.creatureName}
                        </div>
                        <div className="text-sm text-slate-400 capitalize">
                            Elemento: {data.element}
                        </div>
                    </div>

                    {/* Legendary particles */}
                    {isLegendary && (
                        <div className="absolute inset-0 pointer-events-none overflow-hidden">
                            {Array.from({ length: 20 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="absolute w-1.5 h-1.5 rounded-full bg-yellow-400"
                                    style={{
                                        left: `${Math.random() * 100}%`,
                                        top: `${Math.random() * 100}%`,
                                        opacity: Math.random() * 0.8 + 0.2,
                                        animation: `creature-particle ${1.5 + Math.random() * 2}s ease-in-out infinite`,
                                        animationDelay: `${Math.random() * 2}s`,
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    <button
                        onClick={handleClose}
                        className="mt-8 bg-amber-500 hover:bg-amber-600 text-white font-bold px-8 py-3 rounded-xl text-sm transition-colors shadow-lg shadow-amber-500/30"
                    >
                        Fantastico!
                    </button>
                </div>
            )}

            <style jsx>{`
                @keyframes creature-glow-expand {
                    0% { transform: scale(0.2); opacity: 0; }
                    50% { opacity: 1; }
                    100% { transform: scale(4); opacity: 0; }
                }
                .creature-reveal-appear {
                    animation: creature-appear 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
                @keyframes creature-appear {
                    0% { transform: scale(0); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .creature-reveal-info {
                    animation: creature-info-in 0.5s ease-out forwards;
                }
                @keyframes creature-info-in {
                    0% { transform: translateY(20px); opacity: 0; }
                    100% { transform: translateY(0); opacity: 1; }
                }
                .creature-legendary-shake {
                    animation: creature-info-in 0.5s ease-out forwards, creature-shake 0.5s ease-in-out 0.5s;
                }
                @keyframes creature-shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
                    20%, 40%, 60%, 80% { transform: translateX(4px); }
                }
                @keyframes creature-particle {
                    0%, 100% { transform: translateY(0) scale(1); opacity: 0.3; }
                    50% { transform: translateY(-30px) scale(1.5); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

export function CreatureRevealOverlay() {
    return (
        <SafeWrapper>
            <CreatureRevealInner />
        </SafeWrapper>
    );
}
