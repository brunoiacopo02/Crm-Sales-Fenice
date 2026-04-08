'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import type { CelebrationDetail } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

type CelebrationMode = 'fire' | 'confetti' | 'level_up' | 'achievement' | 'loot_reveal';

interface Particle {
    id: number;
    x: number;
    color: string;
    delay: number;
    duration: number;
    size: number;
}

const CONFETTI_COLORS = ['#FFBE82', '#E8523F', '#C9A13C', '#a78bfa', '#34d399', '#60a5fa', '#fbbf24'];
const FIRE_COLORS = ['#FFBE82', '#E8523F', '#F69080', '#C9A13C', '#ff6b35'];
const GOLD_COLORS = ['#C9A13C', '#fbbf24', '#FFBE82', '#f59e0b', '#d97706'];

export function CelebrationOverlay() {
    const [particles, setParticles] = useState<Particle[]>([]);
    const [mode, setMode] = useState<CelebrationMode | null>(null);
    const [detail, setDetail] = useState<CelebrationDetail | null>(null);
    const [phase, setPhase] = useState<'idle' | 'active' | 'fadeout'>('idle');
    const counterRef = useRef(0);
    const activeRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Typewriter state for level_up
    const [typewriterText, setTypewriterText] = useState('');
    const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const cleanup = useCallback(() => {
        setParticles([]);
        setMode(null);
        setDetail(null);
        setPhase('idle');
        setTypewriterText('');
        activeRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        if (typewriterRef.current) clearInterval(typewriterRef.current);
    }, []);

    const dismiss = useCallback(() => {
        if (phase === 'active') {
            setPhase('fadeout');
            timerRef.current = setTimeout(cleanup, 500);
        }
    }, [phase, cleanup]);

    const runParticleEffect = useCallback((celebType: 'confetti' | 'fire' | 'gold_burst') => {
        const configs = {
            confetti: { count: 40, colors: CONFETTI_COLORS },
            fire: { count: 25, colors: FIRE_COLORS },
            gold_burst: { count: 30, colors: GOLD_COLORS },
        };
        const cfg = configs[celebType];
        const newParticles: Particle[] = [];

        for (let i = 0; i < cfg.count; i++) {
            counterRef.current++;
            newParticles.push({
                id: counterRef.current,
                x: celebType === 'fire' ? 30 + Math.random() * 40 : Math.random() * 100,
                color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
                delay: Math.random() * (celebType === 'fire' ? 600 : 800),
                duration: celebType === 'fire'
                    ? 1200 + Math.random() * 800
                    : 2500 + Math.random() * 1500,
                size: celebType === 'gold_burst'
                    ? 4 + Math.random() * 6
                    : celebType === 'confetti'
                        ? 6 + Math.random() * 8
                        : 4 + Math.random() * 10,
            });
        }

        setParticles(prev => [...prev, ...newParticles]);
    }, []);

    const runCelebration = useCallback((celebMode: CelebrationMode, celebDetail?: CelebrationDetail) => {
        if (activeRef.current) return;
        if (!getAnimationsEnabled()) return;

        activeRef.current = true;
        setMode(celebMode);
        setDetail(celebDetail || null);
        setPhase('active');

        if (celebMode === 'fire' || celebMode === 'confetti') {
            // Legacy particle-only mode
            runParticleEffect(celebMode);
            timerRef.current = setTimeout(cleanup, 4500);

        } else if (celebMode === 'level_up') {
            // Full-screen level-up: flames + confetti + typewriter text
            runParticleEffect('confetti');
            runParticleEffect('fire');

            // Typewriter for "LIVELLO X!"
            const fullText = `LIVELLO ${celebDetail?.level || '?'}!`;
            let idx = 0;
            setTypewriterText('');
            typewriterRef.current = setInterval(() => {
                idx++;
                setTypewriterText(fullText.slice(0, idx));
                if (idx >= fullText.length) {
                    if (typewriterRef.current) clearInterval(typewriterRef.current);
                }
            }, 80);

            // Auto-dismiss after 5s (or click)
            timerRef.current = setTimeout(() => {
                setPhase('fadeout');
                timerRef.current = setTimeout(cleanup, 500);
            }, 5000);

        } else if (celebMode === 'achievement') {
            // Badge materializing with golden particles
            playSound('achievement');
            runParticleEffect('gold_burst');

            timerRef.current = setTimeout(() => {
                setPhase('fadeout');
                timerRef.current = setTimeout(cleanup, 500);
            }, 4000);

        } else if (celebMode === 'loot_reveal') {
            // Chest burst celebration (triggered after loot reveal)
            playSound('achievement');
            runParticleEffect('confetti');
            runParticleEffect('gold_burst');

            timerRef.current = setTimeout(() => {
                setPhase('fadeout');
                timerRef.current = setTimeout(cleanup, 500);
            }, 4000);
        }
    }, [runParticleEffect, cleanup]);

    useEffect(() => {
        const handleCelebration = (e: Event) => {
            const d = (e as CustomEvent).detail;
            const celebType = d?.type as CelebrationMode;
            if (['fire', 'confetti', 'level_up', 'achievement', 'loot_reveal'].includes(celebType)) {
                runCelebration(celebType, d as CelebrationDetail);
            }
        };

        const handleRealtimeUpdate = (e: Event) => {
            const d = (e as CustomEvent).detail;
            if (d?.type === 'achievement_unlocked') {
                runCelebration('achievement', {
                    type: 'achievement',
                    achievementName: d?.achievementName || d?.title || 'Badge Sbloccato!',
                    achievementIcon: d?.icon || '🏆',
                });
            }
        };

        window.addEventListener('celebration', handleCelebration);
        window.addEventListener('realtime_update', handleRealtimeUpdate);

        return () => {
            window.removeEventListener('celebration', handleCelebration);
            window.removeEventListener('realtime_update', handleRealtimeUpdate);
            if (timerRef.current) clearTimeout(timerRef.current);
            if (typewriterRef.current) clearInterval(typewriterRef.current);
        };
    }, [runCelebration]);

    // Nothing visible
    if (phase === 'idle') return null;

    const isEnhanced = mode === 'level_up' || mode === 'achievement' || mode === 'loot_reveal';
    const fadeClass = phase === 'fadeout' ? 'opacity-0 transition-opacity duration-500' : 'opacity-100';

    return (
        <div
            className={`fixed inset-0 ${isEnhanced ? 'cursor-pointer' : 'pointer-events-none'} ${fadeClass}`}
            style={{ zIndex: 9999 }}
            onClick={isEnhanced ? dismiss : undefined}
        >
            {/* Backdrop for enhanced celebrations */}
            {isEnhanced && (
                <div className="absolute inset-0 bg-black/70" style={{
                    animation: 'celeb-backdrop-in 0.3s ease-out forwards',
                }} />
            )}

            {/* === LEVEL UP OVERLAY === */}
            {mode === 'level_up' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {/* Fenice flame ring */}
                    <div className="relative mb-6" style={{ animation: 'celeb-fenice-flames 2s ease-in-out infinite' }}>
                        <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center"
                            style={{
                                background: 'radial-gradient(circle, rgba(255,190,130,0.3) 0%, rgba(232,82,63,0.2) 50%, transparent 70%)',
                                boxShadow: '0 0 60px rgba(255,190,130,0.5), 0 0 120px rgba(232,82,63,0.3), inset 0 0 40px rgba(255,190,130,0.2)',
                                animation: 'celeb-fenice-glow 1.5s ease-in-out infinite alternate',
                            }}>
                            <span className="text-6xl sm:text-7xl" style={{ animation: 'celeb-fenice-icon 2s ease-in-out infinite' }}>🔥</span>
                        </div>
                        {/* Orbiting flame particles */}
                        {[0, 1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="absolute w-3 h-3 rounded-full" style={{
                                background: FIRE_COLORS[i % FIRE_COLORS.length],
                                top: '50%', left: '50%',
                                animation: `celeb-orbit ${2 + i * 0.3}s linear infinite`,
                                animationDelay: `${i * 0.4}s`,
                                transformOrigin: `0 ${70 + i * 5}px`,
                                filter: 'blur(1px)',
                            }} />
                        ))}
                    </div>

                    {/* Typewriter text */}
                    <div className="text-center">
                        <div className="text-4xl sm:text-6xl font-black tracking-wider"
                            style={{
                                background: 'linear-gradient(135deg, #FFBE82, #E8523F, #C9A13C)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                textShadow: 'none',
                                filter: 'drop-shadow(0 0 20px rgba(255,190,130,0.6))',
                            }}>
                            {typewriterText}
                            <span style={{ animation: 'celeb-cursor-blink 0.6s step-end infinite' }}>|</span>
                        </div>
                        <div className="mt-3 text-lg text-white/70 font-medium" style={{
                            animation: 'celeb-subtitle-in 0.5s ease-out 1.5s both',
                        }}>
                            La Fenice si evolve! 🦅
                        </div>
                    </div>

                    {/* Dismiss hint */}
                    <div className="mt-8 text-xs text-white/40" style={{
                        animation: 'celeb-subtitle-in 0.5s ease-out 3s both',
                    }}>
                        Tocca per continuare
                    </div>
                </div>
            )}

            {/* === ACHIEVEMENT OVERLAY === */}
            {mode === 'achievement' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {/* Badge materializing */}
                    <div className="relative" style={{ animation: 'celeb-badge-materialize 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
                        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl flex items-center justify-center border-2 border-gold-400/50"
                            style={{
                                background: 'linear-gradient(135deg, rgba(201,161,60,0.3), rgba(255,190,130,0.2))',
                                boxShadow: '0 0 40px rgba(201,161,60,0.4), 0 0 80px rgba(201,161,60,0.2)',
                                animation: 'celeb-badge-glow 1.5s ease-in-out infinite alternate',
                            }}>
                            <span className="text-5xl sm:text-6xl">{detail?.achievementIcon || '🏆'}</span>
                        </div>
                        {/* Golden particle ring */}
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="absolute w-2 h-2 rounded-full" style={{
                                background: GOLD_COLORS[i % GOLD_COLORS.length],
                                top: '50%', left: '50%',
                                animation: `celeb-badge-particle 1.5s ease-out ${i * 0.15}s forwards`,
                                transformOrigin: '0 0',
                                transform: `rotate(${i * 45}deg) translateY(-60px)`,
                                opacity: 0,
                            }} />
                        ))}
                    </div>

                    {/* Achievement text */}
                    <div className="mt-6 text-center" style={{ animation: 'celeb-subtitle-in 0.5s ease-out 0.5s both' }}>
                        <div className="text-xs uppercase tracking-widest text-gold-400/80 font-bold mb-2">Achievement Sbloccato</div>
                        <div className="text-2xl sm:text-3xl font-bold text-white">
                            {detail?.achievementName || 'Badge Sbloccato!'}
                        </div>
                    </div>

                    <div className="mt-8 text-xs text-white/40" style={{
                        animation: 'celeb-subtitle-in 0.5s ease-out 2s both',
                    }}>
                        Tocca per continuare
                    </div>
                </div>
            )}

            {/* === LOOT REVEAL OVERLAY === */}
            {mode === 'loot_reveal' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {/* Chest burst effect */}
                    <div style={{ animation: 'celeb-chest-burst 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
                        <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full flex items-center justify-center"
                            style={{
                                background: detail?.lootRarity === 'legendary'
                                    ? 'radial-gradient(circle, rgba(201,161,60,0.5) 0%, rgba(255,190,130,0.3) 50%, transparent 70%)'
                                    : detail?.lootRarity === 'epic'
                                        ? 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(139,92,246,0.3) 50%, transparent 70%)'
                                        : 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, rgba(96,165,250,0.2) 50%, transparent 70%)',
                                boxShadow: detail?.lootRarity === 'legendary'
                                    ? '0 0 80px rgba(201,161,60,0.6), 0 0 160px rgba(255,190,130,0.3)'
                                    : detail?.lootRarity === 'epic'
                                        ? '0 0 60px rgba(168,85,247,0.5), 0 0 120px rgba(139,92,246,0.2)'
                                        : '0 0 40px rgba(59,130,246,0.4)',
                            }}>
                            <span className="text-5xl sm:text-6xl" style={{ animation: 'celeb-fenice-icon 1.5s ease-in-out infinite' }}>
                                {detail?.lootRarity === 'legendary' ? '👑' : detail?.lootRarity === 'epic' ? '🔮' : '💎'}
                            </span>
                        </div>
                    </div>

                    {/* Rarity text */}
                    <div className="mt-4 text-center" style={{ animation: 'celeb-subtitle-in 0.4s ease-out 0.3s both' }}>
                        <div className={`text-2xl sm:text-3xl font-black uppercase tracking-wider ${
                            detail?.lootRarity === 'legendary' ? 'text-gold-400' :
                            detail?.lootRarity === 'epic' ? 'text-purple-400' : 'text-blue-400'
                        }`}>
                            {detail?.lootRarity === 'legendary' ? 'Leggendario!' :
                             detail?.lootRarity === 'epic' ? 'Epico!' : 'Raro!'}
                        </div>
                    </div>
                </div>
            )}

            {/* Particles layer (shared across all modes) */}
            {particles.map(p => {
                const isFire = mode === 'fire' || (mode === 'level_up' && p.duration < 2000);
                return (
                    <div
                        key={p.id}
                        style={{
                            position: 'absolute',
                            left: `${p.x}%`,
                            ...(isFire ? { bottom: '0%' } : { top: '-2%' }),
                            width: p.size,
                            height: p.size,
                            backgroundColor: p.color,
                            borderRadius: isFire ? '50%' : '2px',
                            opacity: 0,
                            animation: `${isFire ? 'fire-rise' : 'confetti-fall'} ${p.duration}ms ease-${isFire ? 'out' : 'in'} ${p.delay}ms forwards`,
                            pointerEvents: 'none' as const,
                        }}
                    />
                );
            })}
        </div>
    );
}
