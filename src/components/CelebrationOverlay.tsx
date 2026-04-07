'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getAnimationsEnabled } from '@/lib/animationUtils';

type CelebrationType = 'fire' | 'confetti';

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

export function CelebrationOverlay() {
    const [particles, setParticles] = useState<Particle[]>([]);
    const [type, setType] = useState<CelebrationType | null>(null);
    const counterRef = useRef(0);
    const activeRef = useRef(false);

    const runCelebration = useCallback((celebType: CelebrationType) => {
        if (activeRef.current) return;
        if (!getAnimationsEnabled()) return;

        activeRef.current = true;
        setType(celebType);

        const count = celebType === 'confetti' ? 40 : 25;
        const colors = celebType === 'confetti' ? CONFETTI_COLORS : FIRE_COLORS;
        const newParticles: Particle[] = [];

        for (let i = 0; i < count; i++) {
            counterRef.current++;
            newParticles.push({
                id: counterRef.current,
                x: celebType === 'confetti'
                    ? Math.random() * 100
                    : 30 + Math.random() * 40,
                color: colors[Math.floor(Math.random() * colors.length)],
                delay: Math.random() * (celebType === 'confetti' ? 800 : 600),
                duration: celebType === 'confetti'
                    ? 2500 + Math.random() * 1500
                    : 1200 + Math.random() * 800,
                size: celebType === 'confetti'
                    ? 6 + Math.random() * 8
                    : 4 + Math.random() * 10,
            });
        }

        setParticles(newParticles);

        setTimeout(() => {
            setParticles([]);
            setType(null);
            activeRef.current = false;
        }, 4500);
    }, []);

    useEffect(() => {
        const handleCelebration = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const celebType = detail?.type as CelebrationType;
            if (celebType === 'fire' || celebType === 'confetti') {
                runCelebration(celebType);
            }
        };

        // Also listen for realtime_update to catch achievement unlocks
        const handleRealtimeUpdate = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.type === 'achievement_unlocked') {
                runCelebration('confetti');
            }
        };

        window.addEventListener('celebration', handleCelebration);
        window.addEventListener('realtime_update', handleRealtimeUpdate);

        return () => {
            window.removeEventListener('celebration', handleCelebration);
            window.removeEventListener('realtime_update', handleRealtimeUpdate);
        };
    }, [runCelebration]);

    if (particles.length === 0 || !type) return null;

    return (
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: `${p.x}%`,
                        ...(type === 'confetti'
                            ? { top: '-2%' }
                            : { bottom: '0%' }),
                        width: p.size,
                        height: p.size,
                        backgroundColor: p.color,
                        borderRadius: type === 'confetti' ? '2px' : '50%',
                        opacity: 0,
                        animation: `${type === 'confetti' ? 'confetti-fall' : 'fire-rise'} ${p.duration}ms ease-${type === 'confetti' ? 'in' : 'out'} ${p.delay}ms forwards`,
                    }}
                />
            ))}
        </div>
    );
}
