'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getAnimationsEnabled } from '@/lib/animationUtils';
import type { CelebrationDetail } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

type CelebrationMode = 'fire' | 'confetti' | 'level_up' | 'achievement' | 'loot_reveal';

// Client-side mirror of EVOLUTION_STAGES for evolution detection
const EVOLUTION_STAGE_BOUNDARIES = [
    { minLevel: 1, maxLevel: 7, name: 'Uovo', emoji: '🥚' },
    { minLevel: 8, maxLevel: 17, name: 'Pulcino', emoji: '🐣' },
    { minLevel: 18, maxLevel: 25, name: 'Fenice Giovane', emoji: '🦅' },
    { minLevel: 26, maxLevel: 34, name: 'Fenice di Fuoco', emoji: '🔥' },
    { minLevel: 35, maxLevel: 999, name: 'Divinita Fenice', emoji: '✨' },
];

function getStageForLevel(level: number) {
    return EVOLUTION_STAGE_BOUNDARIES.find(s => level >= s.minLevel && level <= s.maxLevel) || EVOLUTION_STAGE_BOUNDARIES[EVOLUTION_STAGE_BOUNDARIES.length - 1];
}

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

// Evolution phases for level-up with Fenice stage change
type LevelUpPhase = 'fire_intro' | 'level_text' | 'evolution_old' | 'evolution_flash' | 'evolution_new' | 'confetti_finale';

export function CelebrationOverlay() {
    const [particles, setParticles] = useState<Particle[]>([]);
    const [mode, setMode] = useState<CelebrationMode | null>(null);
    const [detail, setDetail] = useState<CelebrationDetail | null>(null);
    const [phase, setPhase] = useState<'idle' | 'active' | 'fadeout'>('idle');
    const counterRef = useRef(0);
    const activeRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // Typewriter state for level_up
    const [typewriterText, setTypewriterText] = useState('');
    const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Level-up sub-phase for epic sequencing
    const [levelUpPhase, setLevelUpPhase] = useState<LevelUpPhase>('fire_intro');
    const [canDismiss, setCanDismiss] = useState(false);

    const clearAllTimers = useCallback(() => {
        timersRef.current.forEach(t => clearTimeout(t));
        timersRef.current = [];
        if (timerRef.current) clearTimeout(timerRef.current);
        if (typewriterRef.current) clearInterval(typewriterRef.current);
    }, []);

    const addTimer = useCallback((fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms);
        timersRef.current.push(t);
        return t;
    }, []);

    const cleanup = useCallback(() => {
        setParticles([]);
        setMode(null);
        setDetail(null);
        setPhase('idle');
        setTypewriterText('');
        setLevelUpPhase('fire_intro');
        setCanDismiss(false);
        activeRef.current = false;
        clearAllTimers();
    }, [clearAllTimers]);

    const dismiss = useCallback(() => {
        if (phase === 'active' && canDismiss) {
            setPhase('fadeout');
            timerRef.current = setTimeout(cleanup, 500);
        }
    }, [phase, canDismiss, cleanup]);

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
            const isEvolution = celebDetail?.isEvolution || false;

            // Phase 1: Fire intro (0-1.2s) — CSS fire particles rise from bottom
            setLevelUpPhase('fire_intro');

            // Phase 2: Level text (1.2s) — typewriter "LIVELLO X!"
            addTimer(() => {
                setLevelUpPhase('level_text');
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
            }, 1200);

            if (isEvolution) {
                // Phase 3: Show old stage dissolving (2.5s)
                addTimer(() => {
                    setLevelUpPhase('evolution_old');
                }, 2500);

                // Phase 4: Flash burst (3.5s)
                addTimer(() => {
                    setLevelUpPhase('evolution_flash');
                }, 3500);

                // Phase 5: New stage materializes (4.0s)
                addTimer(() => {
                    setLevelUpPhase('evolution_new');
                    runParticleEffect('gold_burst');
                    runParticleEffect('confetti');
                }, 4000);

                // Phase 6: Confetti finale + allow dismiss (5.5s)
                addTimer(() => {
                    setLevelUpPhase('confetti_finale');
                    setCanDismiss(true);
                    runParticleEffect('confetti');
                }, 5500);

                // Auto-dismiss after 8s
                addTimer(() => {
                    setPhase('fadeout');
                    addTimer(cleanup, 500);
                }, 8000);

            } else {
                // Non-evolution level-up: simpler but still epic
                // Add confetti after typewriter (2.8s)
                addTimer(() => {
                    setLevelUpPhase('confetti_finale');
                    runParticleEffect('confetti');
                    runParticleEffect('fire');
                    setCanDismiss(true);
                }, 2800);

                // Auto-dismiss after 5s
                addTimer(() => {
                    setPhase('fadeout');
                    addTimer(cleanup, 500);
                }, 5000);
            }

        } else if (celebMode === 'achievement') {
            setCanDismiss(true);
            playSound('achievement');
            runParticleEffect('gold_burst');

            timerRef.current = setTimeout(() => {
                setPhase('fadeout');
                timerRef.current = setTimeout(cleanup, 500);
            }, 4000);

        } else if (celebMode === 'loot_reveal') {
            setCanDismiss(true);
            playSound('achievement');
            runParticleEffect('confetti');
            runParticleEffect('gold_burst');

            timerRef.current = setTimeout(() => {
                setPhase('fadeout');
                timerRef.current = setTimeout(cleanup, 500);
            }, 4000);
        }
    }, [runParticleEffect, cleanup, addTimer]);

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

        // Direct listener for reward_earned — triggers level-up celebration with evolution detection
        const handleRewardEarned = (e: Event) => {
            const d = (e as CustomEvent).detail;
            if (d?.didLevelUp && d?.newLevel) {
                const newLevel = d.newLevel as number;
                const previousLevel = newLevel - 1;
                const oldStage = getStageForLevel(previousLevel);
                const newStage = getStageForLevel(newLevel);
                const isEvolution = oldStage.name !== newStage.name;

                setTimeout(() => {
                    runCelebration('level_up', {
                        type: 'level_up',
                        level: newLevel,
                        isEvolution,
                        previousStageName: isEvolution ? oldStage.name : undefined,
                        newStageName: isEvolution ? newStage.name : undefined,
                        previousStageEmoji: isEvolution ? oldStage.emoji : undefined,
                        newStageEmoji: isEvolution ? newStage.emoji : undefined,
                    });
                    playSound(isEvolution ? 'evolution_fanfare' : 'level_up');
                }, 500);
            }
        };

        window.addEventListener('celebration', handleCelebration);
        window.addEventListener('realtime_update', handleRealtimeUpdate);
        window.addEventListener('reward_earned', handleRewardEarned);

        return () => {
            window.removeEventListener('celebration', handleCelebration);
            window.removeEventListener('realtime_update', handleRealtimeUpdate);
            window.removeEventListener('reward_earned', handleRewardEarned);
            clearAllTimers();
        };
    }, [runCelebration, clearAllTimers]);

    // Nothing visible
    if (phase === 'idle') return null;

    const isEnhanced = mode === 'level_up' || mode === 'achievement' || mode === 'loot_reveal';
    const fadeClass = phase === 'fadeout' ? 'opacity-0 transition-opacity duration-500' : 'opacity-100';
    const isEvolution = detail?.isEvolution || false;

    return (
        <div
            className={`fixed inset-0 ${isEnhanced ? 'cursor-pointer' : 'pointer-events-none'} ${fadeClass}`}
            style={{ zIndex: 9999 }}
            onClick={isEnhanced ? dismiss : undefined}
        >
            {/* Backdrop for enhanced celebrations */}
            {isEnhanced && (
                <div className="absolute inset-0 bg-black/80" style={{
                    animation: 'celeb-backdrop-in 0.3s ease-out forwards',
                }} />
            )}

            {/* === LEVEL UP OVERLAY (EPIC REDESIGN) === */}
            {mode === 'level_up' && (
                <>
                    {/* CSS Fire Particles rising from bottom — always visible during level-up */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        {Array.from({ length: 20 }).map((_, i) => (
                            <div
                                key={`fire-${i}`}
                                className="absolute rounded-full"
                                style={{
                                    bottom: 0,
                                    left: `${5 + Math.random() * 90}%`,
                                    width: 6 + Math.random() * 12,
                                    height: 6 + Math.random() * 12,
                                    background: `radial-gradient(circle, ${FIRE_COLORS[i % FIRE_COLORS.length]}, transparent)`,
                                    animation: `celeb-fire-rise ${2 + Math.random() * 2}s ease-out ${Math.random() * 1.5}s infinite`,
                                    filter: 'blur(1px)',
                                }}
                            />
                        ))}
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={`ember-${i}`}
                                className="absolute rounded-full"
                                style={{
                                    bottom: 0,
                                    left: `${10 + Math.random() * 80}%`,
                                    width: 3 + Math.random() * 5,
                                    height: 3 + Math.random() * 5,
                                    background: GOLD_COLORS[i % GOLD_COLORS.length],
                                    animation: `celeb-ember-drift ${3 + Math.random() * 2}s ease-out ${Math.random() * 2}s infinite`,
                                    filter: 'blur(0.5px)',
                                }}
                            />
                        ))}
                    </div>

                    {/* Radial burst behind central content */}
                    {(levelUpPhase === 'level_text' || levelUpPhase === 'evolution_flash' || levelUpPhase === 'confetti_finale') && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div
                                className="w-64 h-64 rounded-full"
                                style={{
                                    background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, rgba(255,165,0,0.15) 40%, transparent 70%)',
                                    animation: 'celeb-radial-burst 1.5s ease-out forwards',
                                }}
                            />
                        </div>
                    )}

                    {/* Central content area */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">

                        {/* Fenice flame ring — enhanced with more dramatic glow */}
                        {(levelUpPhase === 'fire_intro' || levelUpPhase === 'level_text' || levelUpPhase === 'confetti_finale') && !isEvolution && (
                            <div className="relative mb-8" style={{
                                animation: levelUpPhase === 'fire_intro'
                                    ? 'celeb-level-entrance 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                                    : 'celeb-fenice-flames 2s ease-in-out infinite',
                            }}>
                                <div className="w-36 h-36 rounded-full flex items-center justify-center"
                                    style={{
                                        background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, rgba(232,82,63,0.2) 50%, transparent 70%)',
                                        boxShadow: '0 0 60px rgba(255,215,0,0.5), 0 0 120px rgba(232,82,63,0.3), inset 0 0 40px rgba(255,190,130,0.2)',
                                        animation: 'celeb-fenice-glow 1.5s ease-in-out infinite alternate',
                                    }}>
                                    <span className="text-7xl" style={{ animation: 'celeb-fenice-icon 2s ease-in-out infinite' }}>🔥</span>
                                </div>
                                {/* Orbiting flame particles */}
                                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                                    <div key={i} className="absolute w-3 h-3 rounded-full" style={{
                                        background: FIRE_COLORS[i % FIRE_COLORS.length],
                                        top: '50%', left: '50%',
                                        animation: `celeb-orbit ${1.8 + i * 0.25}s linear infinite`,
                                        animationDelay: `${i * 0.3}s`,
                                        transformOrigin: `0 ${75 + i * 4}px`,
                                        filter: 'blur(1px)',
                                    }} />
                                ))}
                            </div>
                        )}

                        {/* === EVOLUTION SEQUENCE === */}
                        {isEvolution && (
                            <div className="relative mb-8">
                                {/* Old stage dissolving */}
                                {(levelUpPhase === 'evolution_old' || levelUpPhase === 'fire_intro' || levelUpPhase === 'level_text') && (
                                    <div className="relative flex items-center justify-center">
                                        <div className="w-40 h-40 rounded-full flex items-center justify-center"
                                            style={{
                                                background: 'radial-gradient(circle, rgba(150,150,150,0.2) 0%, transparent 70%)',
                                                boxShadow: '0 0 40px rgba(150,150,150,0.3)',
                                                animation: levelUpPhase === 'evolution_old'
                                                    ? 'celeb-evo-old-stage 1s ease-in forwards'
                                                    : 'celeb-level-entrance 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                                            }}>
                                            <span className="text-7xl">{detail?.previousStageEmoji || '🥚'}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Flash burst between stages */}
                                {levelUpPhase === 'evolution_flash' && (
                                    <div className="relative flex items-center justify-center">
                                        <div className="w-40 h-40 rounded-full flex items-center justify-center"
                                            style={{
                                                background: 'radial-gradient(circle, rgba(255,215,0,0.8) 0%, rgba(255,165,0,0.4) 40%, transparent 70%)',
                                                animation: 'celeb-evo-flash 0.5s ease-out forwards',
                                            }}
                                        />
                                        {/* Expanding rings */}
                                        {[0, 1, 2].map(i => (
                                            <div key={i} className="absolute w-40 h-40 rounded-full border-amber-400"
                                                style={{
                                                    borderStyle: 'solid',
                                                    animation: `celeb-evo-ring 0.8s ease-out ${i * 0.15}s forwards`,
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* New stage materializing */}
                                {(levelUpPhase === 'evolution_new' || levelUpPhase === 'confetti_finale') && (
                                    <div className="relative flex items-center justify-center">
                                        <div className="w-44 h-44 rounded-full flex items-center justify-center"
                                            style={{
                                                background: 'radial-gradient(circle, rgba(255,215,0,0.35) 0%, rgba(255,165,0,0.2) 50%, transparent 70%)',
                                                boxShadow: '0 0 80px rgba(255,215,0,0.6), 0 0 160px rgba(255,165,0,0.3)',
                                                animation: levelUpPhase === 'evolution_new'
                                                    ? 'celeb-evo-new-stage 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                                                    : 'celeb-fenice-glow 1.5s ease-in-out infinite alternate',
                                            }}>
                                            <span className="text-8xl" style={{
                                                animation: levelUpPhase === 'confetti_finale' ? 'celeb-fenice-icon 2s ease-in-out infinite' : undefined,
                                                filter: 'drop-shadow(0 0 20px rgba(255,215,0,0.8))',
                                            }}>
                                                {detail?.newStageEmoji || '🐣'}
                                            </span>
                                        </div>
                                        {/* Golden orbiting particles for new stage */}
                                        {levelUpPhase === 'confetti_finale' && [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                                            <div key={i} className="absolute w-2.5 h-2.5 rounded-full" style={{
                                                background: GOLD_COLORS[i % GOLD_COLORS.length],
                                                top: '50%', left: '50%',
                                                animation: `celeb-orbit ${1.5 + i * 0.2}s linear infinite`,
                                                animationDelay: `${i * 0.25}s`,
                                                transformOrigin: `0 ${80 + i * 5}px`,
                                                filter: 'blur(0.5px)',
                                            }} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Typewriter level text — shows from phase 'level_text' onward */}
                        {levelUpPhase !== 'fire_intro' && (
                            <div className="text-center">
                                <div className="text-5xl font-black tracking-wider"
                                    style={{
                                        background: 'linear-gradient(135deg, #FFD700, #FFBE82, #E8523F, #FFD700)',
                                        backgroundSize: '200% 200%',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        filter: 'drop-shadow(0 0 20px rgba(255,215,0,0.6))',
                                        animation: 'celeb-level-glow 2s ease-in-out infinite, celeb-level-entrance 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                                    }}>
                                    {typewriterText}
                                    {typewriterText.length < `LIVELLO ${detail?.level || '?'}!`.length && (
                                        <span style={{ animation: 'celeb-cursor-blink 0.6s step-end infinite' }}>|</span>
                                    )}
                                </div>

                                {/* Subtitle — different based on evolution or not */}
                                {(levelUpPhase === 'confetti_finale' || levelUpPhase === 'evolution_new') && (
                                    <div className="mt-4">
                                        {isEvolution ? (
                                            <div style={{ animation: 'celeb-evo-name-reveal 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
                                                <div className="text-xs uppercase tracking-[0.25em] text-amber-400/80 font-bold mb-2">
                                                    Evoluzione Fenice
                                                </div>
                                                <div className="text-3xl font-black"
                                                    style={{
                                                        background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                                                        WebkitBackgroundClip: 'text',
                                                        WebkitTextFillColor: 'transparent',
                                                        filter: 'drop-shadow(0 0 15px rgba(255,215,0,0.5))',
                                                    }}>
                                                    {detail?.previousStageName} → {detail?.newStageName}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-lg text-white/70 font-medium" style={{
                                                animation: 'celeb-subtitle-in 0.5s ease-out 0.3s both',
                                            }}>
                                                La Fenice cresce! Continua così!
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Dismiss hint */}
                        {canDismiss && (
                            <div className="mt-10 text-xs text-white/40" style={{
                                animation: 'celeb-dismiss-hint 0.5s ease-out forwards',
                            }}>
                                Clicca per continuare
                            </div>
                        )}
                    </div>

                    {/* Confetti cascade from top */}
                    {levelUpPhase === 'confetti_finale' && (
                        <div className="absolute inset-0 overflow-hidden pointer-events-none">
                            {Array.from({ length: 30 }).map((_, i) => (
                                <div
                                    key={`confetti-${i}`}
                                    className="absolute"
                                    style={{
                                        top: 0,
                                        left: `${Math.random() * 100}%`,
                                        width: 6 + Math.random() * 6,
                                        height: 6 + Math.random() * 6,
                                        backgroundColor: [...CONFETTI_COLORS, ...GOLD_COLORS][i % (CONFETTI_COLORS.length + GOLD_COLORS.length)],
                                        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                                        animation: `celeb-confetti-cascade ${2.5 + Math.random() * 2}s ease-in ${Math.random() * 1.5}s forwards`,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* === ACHIEVEMENT OVERLAY === */}
            {mode === 'achievement' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {/* Badge materializing */}
                    <div className="relative" style={{ animation: 'celeb-badge-materialize 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
                        <div className="w-28 h-28 rounded-2xl flex items-center justify-center border-2 border-gold-400/50"
                            style={{
                                background: 'linear-gradient(135deg, rgba(201,161,60,0.3), rgba(255,190,130,0.2))',
                                boxShadow: '0 0 40px rgba(201,161,60,0.4), 0 0 80px rgba(201,161,60,0.2)',
                                animation: 'celeb-badge-glow 1.5s ease-in-out infinite alternate',
                            }}>
                            <span className="text-5xl">{detail?.achievementIcon || '🏆'}</span>
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
                        <div className="text-2xl font-bold text-white">
                            {detail?.achievementName || 'Badge Sbloccato!'}
                        </div>
                    </div>

                    <div className="mt-8 text-xs text-white/40" style={{
                        animation: 'celeb-subtitle-in 0.5s ease-out 2s both',
                    }}>
                        Clicca per continuare
                    </div>
                </div>
            )}

            {/* === LOOT REVEAL OVERLAY === */}
            {mode === 'loot_reveal' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {/* Chest burst effect */}
                    <div style={{ animation: 'celeb-chest-burst 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
                        <div className="w-24 h-24 rounded-full flex items-center justify-center"
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
                            <span className="text-5xl" style={{ animation: 'celeb-fenice-icon 1.5s ease-in-out infinite' }}>
                                {detail?.lootRarity === 'legendary' ? '👑' : detail?.lootRarity === 'epic' ? '🔮' : '💎'}
                            </span>
                        </div>
                    </div>

                    {/* Rarity text */}
                    <div className="mt-4 text-center" style={{ animation: 'celeb-subtitle-in 0.4s ease-out 0.3s both' }}>
                        <div className={`text-2xl font-black uppercase tracking-wider ${
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
