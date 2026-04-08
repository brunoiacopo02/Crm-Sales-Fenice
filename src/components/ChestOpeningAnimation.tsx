'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Package, Sparkles } from 'lucide-react';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

// ─── Types ─────────────────────────────────────────────────────────────

export type ChestRarity = 'common' | 'rare' | 'epic' | 'legendary';

type AnimPhase = 'idle' | 'phase1' | 'phase2' | 'phase3' | 'burst' | 'done';

interface ChestOpeningAnimationProps {
    /** When true, starts the 3-phase opening animation */
    isOpening: boolean;
    /** Rarity determines visual style and sound on reveal */
    rarity: ChestRarity;
    /** Called when the full animation completes (burst finished) */
    onAnimationComplete: () => void;
    /** The reward reveal content to render after burst */
    children: React.ReactNode;
}

// ─── Rarity visual configs ─────────────────────────────────────────────

const RARITY_BURST_CONFIG: Record<ChestRarity, {
    burstColor: string;
    particleColors: string[];
    glowShadow: string;
    borderColor: string;
    bgGradient: string;
}> = {
    common: {
        burstColor: 'rgba(180, 170, 160, 0.6)',
        particleColors: ['#b4aaa0', '#9e9488', '#c7bfb5', '#8a8078'],
        glowShadow: '0 0 40px rgba(180,170,160,0.3)',
        borderColor: 'border-stone-400/50',
        bgGradient: 'from-stone-700/30 via-stone-600/20 to-stone-700/30',
    },
    rare: {
        burstColor: 'rgba(59, 130, 246, 0.7)',
        particleColors: ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb', '#1d4ed8'],
        glowShadow: '0 0 60px rgba(59,130,246,0.5)',
        borderColor: 'border-blue-400/60',
        bgGradient: 'from-blue-600/30 via-blue-500/20 to-blue-600/30',
    },
    epic: {
        burstColor: 'rgba(168, 85, 247, 0.8)',
        particleColors: ['#a855f7', '#c084fc', '#d8b4fe', '#9333ea', '#7c3aed'],
        glowShadow: '0 0 80px rgba(168,85,247,0.6)',
        borderColor: 'border-purple-400/60',
        bgGradient: 'from-purple-700/30 via-purple-500/25 to-purple-700/30',
    },
    legendary: {
        burstColor: 'rgba(234, 179, 8, 0.9)',
        particleColors: ['#eab308', '#fbbf24', '#fcd34d', '#f59e0b', '#d97706', '#FFD700'],
        glowShadow: '0 0 100px rgba(234,179,8,0.7)',
        borderColor: 'border-yellow-400/70',
        bgGradient: 'from-yellow-600/30 via-amber-500/25 to-yellow-600/30',
    },
};

// ─── Component ─────────────────────────────────────────────────────────

export function ChestOpeningAnimation({
    isOpening,
    rarity,
    onAnimationComplete,
    children,
}: ChestOpeningAnimationProps) {
    const [phase, setPhase] = useState<AnimPhase>('idle');
    const [particles, setParticles] = useState<Array<{
        id: number;
        x: number;
        y: number;
        color: string;
        size: number;
        angle: number;
        delay: number;
    }>>([]);
    const mountedRef = useRef(true);
    const animatingRef = useRef(false);
    const config = RARITY_BURST_CONFIG[rarity];

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Generate burst particles when entering phase3
    const generateBurstParticles = useCallback(() => {
        const count = rarity === 'legendary' ? 32 : rarity === 'epic' ? 24 : rarity === 'rare' ? 16 : 8;
        const newParticles = [];
        for (let i = 0; i < count; i++) {
            newParticles.push({
                id: i,
                x: 50 + (Math.random() - 0.5) * 10,
                y: 50 + (Math.random() - 0.5) * 10,
                color: config.particleColors[Math.floor(Math.random() * config.particleColors.length)],
                size: 3 + Math.random() * (rarity === 'legendary' ? 8 : 5),
                angle: (360 / count) * i + (Math.random() - 0.5) * 20,
                delay: Math.random() * 200,
            });
        }
        setParticles(newParticles);
    }, [rarity, config.particleColors]);

    // Run the 3-phase animation sequence
    useEffect(() => {
        if (!isOpening || animatingRef.current) return;

        const animationsEnabled = getAnimationsEnabled();
        if (!animationsEnabled) {
            // Skip animation, go straight to done
            setPhase('done');
            onAnimationComplete();
            return;
        }

        animatingRef.current = true;

        // Start drum roll sound
        playSound('chest_drum_roll');

        // Phase 1 (0-1s): Growing shake
        setPhase('phase1');

        const t1 = setTimeout(() => {
            if (!mountedRef.current) return;
            // Phase 2 (1-2s): Intense glow + particles escape
            setPhase('phase2');
        }, 1000);

        const t2 = setTimeout(() => {
            if (!mountedRef.current) return;
            // Phase 3 (2-2.8s): Burst of light
            setPhase('phase3');
            generateBurstParticles();

            // Play rarity-specific reveal sound
            const revealSound = `chest_reveal_${rarity}` as const;
            playSound(revealSound);
        }, 2000);

        const t3 = setTimeout(() => {
            if (!mountedRef.current) return;
            // Burst flash (2.8-3s)
            setPhase('burst');
        }, 2800);

        const t4 = setTimeout(() => {
            if (!mountedRef.current) return;
            // Done — reveal content
            setPhase('done');
            animatingRef.current = false;
            onAnimationComplete();
        }, 3200);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            clearTimeout(t4);
        };
    }, [isOpening, rarity, onAnimationComplete, generateBurstParticles]);

    // Reset when not opening
    useEffect(() => {
        if (!isOpening) {
            setPhase('idle');
            setParticles([]);
            animatingRef.current = false;
        }
    }, [isOpening]);

    if (phase === 'idle') return null;

    // After animation is done, render the children (reward reveal)
    if (phase === 'done') {
        return <>{children}</>;
    }

    // ─── Suspense Animation Overlay ────────────────────────────────────

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-fade-in">
            {/* Dark backdrop with rarity-tinted glow */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                style={{
                    background: phase === 'burst'
                        ? `radial-gradient(circle at center, ${config.burstColor} 0%, rgba(0,0,0,0.9) 60%)`
                        : 'rgba(0,0,0,0.8)',
                    transition: 'background 0.3s ease',
                }}
            />

            {/* Central chest container */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Chest icon with phase-based animation */}
                <div
                    className="relative w-32 h-32 flex items-center justify-center"
                    style={{
                        animation: phase === 'phase1'
                            ? 'co-shake-phase1 1s ease-in-out forwards'
                            : phase === 'phase2'
                                ? 'co-shake-phase2 1s ease-in-out forwards'
                                : phase === 'phase3' || phase === 'burst'
                                    ? 'co-burst-scale 0.5s ease-out forwards'
                                    : 'none',
                    }}
                >
                    {/* Glow ring — grows through phases */}
                    <div
                        className="absolute inset-0 rounded-full"
                        style={{
                            background: `radial-gradient(circle, ${config.burstColor} 0%, transparent 70%)`,
                            opacity: phase === 'phase1' ? 0.2 : phase === 'phase2' ? 0.5 : 0.8,
                            transform: phase === 'phase1' ? 'scale(1)' : phase === 'phase2' ? 'scale(1.5)' : 'scale(3)',
                            transition: 'all 0.8s ease-out',
                            animation: phase === 'phase2' ? 'co-glow-pulse 0.5s ease-in-out infinite' : 'none',
                        }}
                    />

                    {/* Secondary glow ring for phase2+ */}
                    {(phase === 'phase2' || phase === 'phase3') && (
                        <div
                            className="absolute inset-[-20px] rounded-full"
                            style={{
                                border: `2px solid ${config.burstColor}`,
                                opacity: phase === 'phase3' ? 0.8 : 0.4,
                                animation: 'co-ring-expand 1s ease-out forwards',
                            }}
                        />
                    )}

                    {/* The chest itself */}
                    {phase !== 'burst' && (
                        <div
                            className="relative w-24 h-24 rounded-2xl flex items-center justify-center border-2 border-amber-400/60"
                            style={{
                                background: 'linear-gradient(135deg, #f59e0b, #d97706, #b45309)',
                                boxShadow: phase === 'phase1'
                                    ? '0 0 20px rgba(245,158,11,0.3)'
                                    : phase === 'phase2'
                                        ? config.glowShadow
                                        : config.glowShadow,
                                transition: 'box-shadow 0.5s ease',
                            }}
                        >
                            <Package
                                className="w-12 h-12 text-amber-950"
                                style={{
                                    animation: phase === 'phase2' ? 'co-icon-wobble 0.3s ease-in-out infinite' : 'none',
                                }}
                            />

                            {/* Lock/latch accent */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-4 rounded border border-amber-300/40 bg-amber-600/30" />
                        </div>
                    )}

                    {/* Burst flash */}
                    {phase === 'burst' && (
                        <div
                            className="w-32 h-32 rounded-full"
                            style={{
                                background: `radial-gradient(circle, white 0%, ${config.burstColor} 40%, transparent 70%)`,
                                animation: 'co-flash 0.4s ease-out forwards',
                            }}
                        />
                    )}

                    {/* Escaping particles — phase2 */}
                    {phase === 'phase2' && (
                        <>
                            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                                <div
                                    key={`esc-${i}`}
                                    className="absolute"
                                    style={{
                                        top: '50%',
                                        left: '50%',
                                        animation: `co-particle-escape 1s ease-out ${i * 0.12}s infinite`,
                                        transform: `rotate(${i * 45}deg)`,
                                    }}
                                >
                                    <Sparkles
                                        className="w-3.5 h-3.5"
                                        style={{ color: config.particleColors[i % config.particleColors.length] }}
                                    />
                                </div>
                            ))}
                        </>
                    )}
                </div>

                {/* Burst particles — phase3 */}
                {(phase === 'phase3' || phase === 'burst') && particles.map(p => (
                    <div
                        key={`burst-${p.id}`}
                        className="absolute rounded-full"
                        style={{
                            width: p.size,
                            height: p.size,
                            backgroundColor: p.color,
                            left: '50%',
                            top: '50%',
                            opacity: 0,
                            animation: `co-particle-burst 0.8s ease-out ${p.delay}ms forwards`,
                            transform: `rotate(${p.angle}deg)`,
                            filter: rarity === 'legendary' ? 'blur(0.5px)' : 'none',
                        }}
                    />
                ))}

                {/* Legendary confetti extra — golden sparkle rain */}
                {rarity === 'legendary' && (phase === 'phase3' || phase === 'burst') && (
                    <>
                        {[...Array(12)].map((_, i) => (
                            <div
                                key={`confetti-${i}`}
                                className="absolute"
                                style={{
                                    left: `${10 + Math.random() * 80}%`,
                                    top: '-10%',
                                    width: 4 + Math.random() * 6,
                                    height: 4 + Math.random() * 6,
                                    backgroundColor: config.particleColors[i % config.particleColors.length],
                                    borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                                    opacity: 0,
                                    animation: `co-confetti-fall 1.5s ease-in ${i * 80}ms forwards`,
                                }}
                            />
                        ))}
                    </>
                )}

                {/* Phase text */}
                <div className="mt-8 text-center relative z-10">
                    {phase === 'phase1' && (
                        <div className="text-white/60 text-sm font-medium" style={{ animation: 'co-text-fade 0.5s ease-out' }}>
                            Apertura in corso...
                        </div>
                    )}
                    {phase === 'phase2' && (
                        <div className="text-white/80 text-base font-semibold" style={{ animation: 'co-text-fade 0.3s ease-out' }}>
                            Cosa ci sara dentro?
                        </div>
                    )}
                    {(phase === 'phase3' || phase === 'burst') && (
                        <div
                            className="text-xl font-black uppercase tracking-wider"
                            style={{
                                color: rarity === 'legendary' ? '#FFD700'
                                    : rarity === 'epic' ? '#c084fc'
                                    : rarity === 'rare' ? '#93c5fd'
                                    : '#d6d3d1',
                                animation: 'co-text-reveal 0.4s ease-out',
                                textShadow: `0 0 20px ${config.burstColor}`,
                            }}
                        >
                            {rarity === 'legendary' ? 'LEGGENDARIO!'
                                : rarity === 'epic' ? 'EPICO!'
                                : rarity === 'rare' ? 'RARO!'
                                : 'COMUNE'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
