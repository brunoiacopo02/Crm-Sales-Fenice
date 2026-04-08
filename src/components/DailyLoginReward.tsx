'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Flame, Coins, Sparkles, Zap, Star } from 'lucide-react';
import { checkDailyLoginStatus, claimDailyLogin } from '@/app/actions/dailyLoginActions';
import { getAnimationsEnabled, triggerCelebration } from '@/lib/animationUtils';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'crm-fenice-daily-login-last';

const WELCOME_MESSAGES = [
    'Pronto a spaccare? 🔥',
    'Un altro giorno, un\'altra vittoria!',
    'La Fenice risorge ogni giorno!',
    'Il successo ti aspetta!',
    'Oggi sara\' il TUO giorno!',
    'Nessuno ti ferma!',
    'Obiettivo: dominare la classifica!',
    'Energia al massimo!',
];

interface CoinParticle {
    id: number;
    x: number;
    delay: number;
    duration: number;
    size: number;
}

export function DailyLoginReward({ userId }: { userId: string }) {
    const router = useRouter();
    const [visible, setVisible] = useState(false);
    const [phase, setPhase] = useState<'welcome' | 'claiming' | 'claimed'>('welcome');
    const [streakCount, setStreakCount] = useState(0);
    const [bonusCoins, setBonusCoins] = useState(5);
    const [userName, setUserName] = useState('');
    const [coinsAwarded, setCoinsAwarded] = useState(0);
    const [particles, setParticles] = useState<CoinParticle[]>([]);

    const welcomeMessage = useMemo(
        () => WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)],
        []
    );

    const animationsEnabled = typeof window !== 'undefined' ? getAnimationsEnabled() : true;

    // Check if we should show the daily login modal
    useEffect(() => {
        async function check() {
            // Check localStorage first for quick rejection
            if (typeof window !== 'undefined') {
                const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                const lastShown = localStorage.getItem(STORAGE_KEY);
                if (lastShown === todayStr) return;
            }

            // Check server
            const status = await checkDailyLoginStatus(userId);
            if (status.alreadyClaimed) {
                // Mark as shown so we don't check again
                if (typeof window !== 'undefined') {
                    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                    localStorage.setItem(STORAGE_KEY, todayStr);
                }
                return;
            }

            setStreakCount(status.streakCount);
            setBonusCoins(status.bonusCoins);
            setUserName(status.userName);
            setVisible(true);
        }
        check();
    }, [userId]);

    // Generate coin particles for the cascade effect
    const spawnCoinParticles = useCallback(() => {
        const newParticles: CoinParticle[] = Array.from({ length: 20 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            delay: Math.random() * 0.8,
            duration: 1.5 + Math.random() * 1.5,
            size: 16 + Math.random() * 16,
        }));
        setParticles(newParticles);
    }, []);

    const handleClaim = useCallback(async () => {
        if (phase !== 'welcome') return;
        setPhase('claiming');

        const result = await claimDailyLogin(userId);

        if (result.success) {
            setCoinsAwarded(result.coinsAwarded);
            setPhase('claimed');

            // Spawn coin cascade animation
            if (animationsEnabled) {
                spawnCoinParticles();
                triggerCelebration('confetti');
            }

            // Mark as shown in localStorage
            if (typeof window !== 'undefined') {
                const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                localStorage.setItem(STORAGE_KEY, todayStr);
            }
        } else {
            setPhase('welcome');
        }
    }, [phase, userId, animationsEnabled, spawnCoinParticles]);

    const handleClose = useCallback(() => {
        setVisible(false);
        router.refresh();
    }, [router]);

    if (!visible) return null;

    const streakTier = streakCount >= 7 ? 'inferno' : streakCount >= 3 ? 'fiamma' : 'base';
    const flameColor = streakTier === 'inferno'
        ? 'text-purple-400'
        : streakTier === 'fiamma'
            ? 'text-ember-400'
            : 'text-brand-orange';
    const flameGlow = streakTier === 'inferno'
        ? 'shadow-[0_0_20px_rgba(168,85,247,0.4)]'
        : streakTier === 'fiamma'
            ? 'shadow-[0_0_20px_rgba(239,68,68,0.3)]'
            : '';

    return (
        <div className="modal-backdrop" style={{ zIndex: 70 }}>
            <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 71 }}>
                {/* Coin cascade particles */}
                {phase === 'claimed' && animationsEnabled && particles.map(p => (
                    <div
                        key={p.id}
                        className="absolute animate-coin-cascade pointer-events-none"
                        style={{
                            left: `${p.x}%`,
                            top: '-20px',
                            animationDelay: `${p.delay}s`,
                            animationDuration: `${p.duration}s`,
                            fontSize: `${p.size}px`,
                            zIndex: 72,
                        }}
                    >
                        🪙
                    </div>
                ))}

                <div
                    className="relative max-w-sm w-full mx-2 sm:mx-4"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="modal-content p-8 text-center bg-gradient-to-b from-brand-charcoal via-ash-800 to-ash-900 overflow-visible">
                        {/* Top decorative glow */}
                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-40 h-24 bg-brand-orange/20 rounded-full blur-3xl pointer-events-none" />

                        {/* Welcome phase */}
                        {phase === 'welcome' && (
                            <>
                                {/* Flame icon with streak */}
                                <div className={`relative mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center bg-gradient-to-br from-brand-orange/20 to-ember-500/20 border border-brand-orange/30 ${flameGlow} ${animationsEnabled ? 'animate-daily-flame-pulse' : ''}`}>
                                    <Flame className={`w-10 h-10 ${flameColor} ${animationsEnabled ? 'animate-daily-flame-flicker' : ''}`} />
                                    {streakCount > 0 && (
                                        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-br from-ember-500 to-brand-orange flex items-center justify-center text-white text-xs font-bold border-2 border-ash-800">
                                            {streakCount}
                                        </div>
                                    )}
                                </div>

                                {/* Welcome text */}
                                <h2 className="text-2xl font-bold text-white mb-1">
                                    Benvenuto, <span className="text-brand-orange">{userName}</span>!
                                </h2>
                                <p className="text-ash-400 text-sm mb-5">
                                    {welcomeMessage}
                                </p>

                                {/* Streak info */}
                                {streakCount > 0 ? (
                                    <div className="mb-5 p-3 rounded-xl bg-white/5 border border-white/10">
                                        <div className="flex items-center justify-center gap-2 mb-1">
                                            <Flame className={`w-4 h-4 ${flameColor}`} />
                                            <span className="text-white font-semibold text-sm">
                                                Streak: {streakCount} {streakCount === 1 ? 'giorno' : 'giorni'}
                                            </span>
                                        </div>
                                        <p className="text-ash-400 text-xs">
                                            {streakTier === 'inferno'
                                                ? 'Moltiplicatore INFERNO x3! Sei inarrestabile!'
                                                : streakTier === 'fiamma'
                                                    ? 'Moltiplicatore Fiamma x1.5! Continua cosi!'
                                                    : 'Continua a completare quest per aumentare il moltiplicatore!'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="mb-5 p-3 rounded-xl bg-white/5 border border-white/10">
                                        <div className="flex items-center justify-center gap-2 mb-1">
                                            <Star className="w-4 h-4 text-ash-400" />
                                            <span className="text-ash-300 font-semibold text-sm">
                                                Nessuna streak attiva
                                            </span>
                                        </div>
                                        <p className="text-ash-500 text-xs">
                                            Completa una quest oggi per iniziare la tua streak!
                                        </p>
                                    </div>
                                )}

                                {/* Daily bonus preview */}
                                <div className="mb-6 flex items-center justify-center gap-3">
                                    <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-gold-500/20 to-brand-orange/20 border border-gold-400/30">
                                        <Coins className="w-5 h-5 text-gold-400" />
                                        <span className="text-xl font-bold text-white">+{bonusCoins}</span>
                                        <span className="text-gold-300 text-sm font-medium">coins</span>
                                    </div>
                                </div>

                                {/* Claim button */}
                                <button
                                    onClick={handleClaim}
                                    className="w-full py-3.5 px-6 rounded-xl font-bold text-lg bg-gradient-to-r from-brand-orange via-gold-400 to-brand-orange text-brand-charcoal hover:shadow-glow-gold hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                                >
                                    Inizia la giornata!
                                </button>
                            </>
                        )}

                        {/* Claiming phase (brief loading) */}
                        {phase === 'claiming' && (
                            <div className="py-8">
                                <div className={`mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-brand-orange/30 to-gold-400/30 ${animationsEnabled ? 'animate-pulse' : ''}`}>
                                    <Sparkles className="w-8 h-8 text-brand-orange" />
                                </div>
                                <p className="text-ash-300 text-sm">Reclamo bonus...</p>
                            </div>
                        )}

                        {/* Claimed phase */}
                        {phase === 'claimed' && (
                            <>
                                {/* Success icon */}
                                <div className={`mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center bg-gradient-to-br from-gold-500/30 to-brand-orange/30 border border-gold-400/40 ${animationsEnabled ? 'animate-daily-coin-bounce' : ''}`}>
                                    <Coins className="w-10 h-10 text-gold-400" />
                                </div>

                                {/* Coins awarded */}
                                <div className="mb-2 flex items-center justify-center gap-2">
                                    <span className={`text-4xl font-bold text-white ${animationsEnabled ? 'animate-daily-count-up' : ''}`}>
                                        +{coinsAwarded}
                                    </span>
                                    <span className="text-gold-300 text-lg font-medium">coins</span>
                                </div>

                                <p className="text-ash-400 text-sm mb-2">
                                    Bonus giornaliero riscosso!
                                </p>

                                {streakCount > 0 && (
                                    <p className="text-ash-500 text-xs mb-5">
                                        <Flame className="w-3 h-3 inline text-ember-400" /> Streak di {streakCount} giorni — {
                                            streakCount >= 7 ? 'bonus MASSIMO!' :
                                                streakCount >= 3 ? 'bonus aumentato!' :
                                                    'continua per bonus maggiori!'
                                        }
                                    </p>
                                )}

                                {/* Streak bonus tiers info */}
                                <div className="mb-6 grid grid-cols-3 gap-2 text-center">
                                    <div className={`p-2 rounded-lg ${streakCount < 3 ? 'bg-brand-orange/10 border border-brand-orange/30 ring-1 ring-brand-orange/20' : 'bg-white/5 border border-white/10'}`}>
                                        <Zap className="w-3 h-3 mx-auto text-brand-orange mb-0.5" />
                                        <div className="text-xs text-white font-semibold">+5</div>
                                        <div className="text-[10px] text-ash-500">Base</div>
                                    </div>
                                    <div className={`p-2 rounded-lg ${streakCount >= 3 && streakCount < 7 ? 'bg-ember-500/10 border border-ember-400/30 ring-1 ring-ember-400/20' : 'bg-white/5 border border-white/10'}`}>
                                        <Flame className="w-3 h-3 mx-auto text-ember-400 mb-0.5" />
                                        <div className="text-xs text-white font-semibold">+10</div>
                                        <div className="text-[10px] text-ash-500">3+ giorni</div>
                                    </div>
                                    <div className={`p-2 rounded-lg ${streakCount >= 7 ? 'bg-purple-500/10 border border-purple-400/30 ring-1 ring-purple-400/20' : 'bg-white/5 border border-white/10'}`}>
                                        <Flame className="w-3 h-3 mx-auto text-purple-400 mb-0.5" />
                                        <div className="text-xs text-white font-semibold">+20</div>
                                        <div className="text-[10px] text-ash-500">7+ giorni</div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleClose}
                                    className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-brand-orange via-gold-400 to-brand-orange text-brand-charcoal hover:shadow-glow-gold transition-all duration-300"
                                >
                                    Andiamo! 💪
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
