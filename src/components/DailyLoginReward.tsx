'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Flame, Coins, Sparkles, Check, X, Lock, Crown, Gift } from 'lucide-react';
import { checkDailyLoginStatus, claimDailyLogin } from '@/app/actions/dailyLoginActions';
import type { DayCalendarEntry } from '@/app/actions/dailyLoginActions';
import { getAnimationsEnabled, triggerCelebration } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'crm-fenice-daily-login-last';

const WELCOME_MESSAGES = [
    'Pronto a spaccare?',
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
    const [calendar, setCalendar] = useState<DayCalendarEntry[]>([]);
    const [allPriorDaysClaimed, setAllPriorDaysClaimed] = useState(false);
    const [weeklyBonusTitle, setWeeklyBonusTitle] = useState(false);

    const welcomeMessage = useMemo(
        () => WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)],
        []
    );

    const animationsEnabled = typeof window !== 'undefined' ? getAnimationsEnabled() : true;

    // Check if we should show the daily login modal
    useEffect(() => {
        async function check() {
            if (typeof window !== 'undefined') {
                const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                const lastShown = localStorage.getItem(STORAGE_KEY);
                if (lastShown === todayStr) return;
            }

            let status;
            try {
                status = await checkDailyLoginStatus(userId);
            } catch { return; }

            if (status.alreadyClaimed) {
                if (typeof window !== 'undefined') {
                    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                    localStorage.setItem(STORAGE_KEY, todayStr);
                }
                return;
            }

            setStreakCount(status.streakCount);
            setBonusCoins(status.bonusCoins);
            setUserName(status.userName);
            setCalendar(status.calendar);
            setAllPriorDaysClaimed(status.allPriorDaysClaimed);
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

        // Se la server action throwa (timeout rete, redeploy, edge error),
        // senza try/catch il client resta bloccato in 'claiming'. Racchiudo
        // la call + aggiungo un timeout di safety di 15s.
        let result: Awaited<ReturnType<typeof claimDailyLogin>>;
        try {
            result = await Promise.race([
                claimDailyLogin(userId),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 15000)
                ),
            ]);
        } catch (err) {
            console.error('claimDailyLogin failed:', err);
            setPhase('welcome');
            return;
        }

        if (result.success) {
            setCoinsAwarded(result.coinsAwarded);
            setWeeklyBonusTitle(result.weeklyBonusTitle);
            setPhase('claimed');

            // Update today's calendar entry to claimed
            setCalendar(prev => prev.map(d =>
                d.status === 'today' ? { ...d, status: 'claimed' as const } : d
            ));

            playSound('coin_earned');
            if (animationsEnabled) {
                spawnCoinParticles();
                triggerCelebration('confetti');
            }

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
                        <Coins className="text-gold-400" style={{ width: `${p.size}px`, height: `${p.size}px` }} />
                    </div>
                ))}

                <div
                    className="relative max-w-lg w-full mx-4"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="modal-content p-6 text-center bg-gradient-to-b from-[#1A1620] via-[#141118] to-[#0D0B0E] border border-[#2a2235] overflow-visible rounded-2xl">
                        {/* Top decorative glow */}
                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-40 h-24 bg-brand-orange/20 rounded-full blur-3xl pointer-events-none" />

                        {/* Welcome phase */}
                        {phase === 'welcome' && (
                            <>
                                {/* Compact header */}
                                <div className="flex items-center gap-3 mb-5">
                                    <div className={`relative w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-brand-orange/20 to-ember-500/20 border border-brand-orange/30 ${animationsEnabled ? 'animate-daily-flame-pulse' : ''}`}>
                                        <Flame className={`w-7 h-7 ${flameColor} ${animationsEnabled ? 'animate-daily-flame-flicker' : ''}`} />
                                        {streakCount > 0 && (
                                            <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-gradient-to-br from-ember-500 to-brand-orange flex items-center justify-center text-white text-[10px] font-bold border-2 border-[#1A1620]">
                                                {streakCount}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-left">
                                        <h2 className="text-xl font-bold text-white">
                                            Ciao, <span className="text-brand-orange">{userName}</span>!
                                        </h2>
                                        <p className="text-ash-400 text-xs">{welcomeMessage}</p>
                                    </div>
                                </div>

                                {/* Weekly Calendar Strip */}
                                <div className="mb-5">
                                    <div className="flex items-center justify-between gap-1.5">
                                        {calendar.map((day) => (
                                            <CalendarDay
                                                key={day.date}
                                                day={day}
                                                allPriorDaysClaimed={allPriorDaysClaimed}
                                                animationsEnabled={animationsEnabled}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Streak multiplier info */}
                                {streakCount > 0 && (
                                    <div className="mb-4 p-2.5 rounded-xl bg-white/5 border border-white/10">
                                        <div className="flex items-center justify-center gap-2">
                                            <Flame className={`w-4 h-4 ${flameColor}`} />
                                            <span className="text-white font-semibold text-sm">
                                                Streak: {streakCount} {streakCount === 1 ? 'giorno' : 'giorni'}
                                            </span>
                                            <span className="text-ash-400 text-xs">
                                                {streakTier === 'inferno'
                                                    ? '(x3 Inferno!)'
                                                    : streakTier === 'fiamma'
                                                        ? '(x1.5 Fiamma)'
                                                        : ''}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Today's reward preview */}
                                <div className="mb-5 flex items-center justify-center gap-3">
                                    <div className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-gold-500/20 to-brand-orange/20 border border-gold-400/30">
                                        <Coins className="w-5 h-5 text-gold-400" />
                                        <span className="text-2xl font-bold text-white">+{bonusCoins}</span>
                                        <span className="text-gold-300 text-sm font-medium">coins</span>
                                    </div>
                                </div>

                                {/* Claim button */}
                                <button
                                    onClick={handleClaim}
                                    className="w-full py-3.5 px-6 rounded-xl font-bold text-lg bg-gradient-to-r from-brand-orange via-gold-400 to-brand-orange text-brand-charcoal hover:shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                                >
                                    Riscuoti il bonus!
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
                                <div className={`mx-auto mb-3 w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-gold-500/30 to-brand-orange/30 border border-gold-400/40 ${animationsEnabled ? 'animate-daily-coin-bounce' : ''}`}>
                                    <Coins className="w-8 h-8 text-gold-400" />
                                </div>

                                {/* Coins awarded */}
                                <div className="mb-2 flex items-center justify-center gap-2">
                                    <span className={`text-3xl font-bold text-white ${animationsEnabled ? 'animate-daily-count-up' : ''}`}>
                                        +{coinsAwarded}
                                    </span>
                                    <span className="text-gold-300 text-lg font-medium">coins</span>
                                </div>

                                <p className="text-ash-400 text-sm mb-2">
                                    Bonus giornaliero riscosso!
                                </p>

                                {/* Weekly bonus title unlock */}
                                {weeklyBonusTitle && (
                                    <div className="mb-3 p-2.5 rounded-lg bg-purple-500/10 border border-purple-400/30">
                                        <div className="flex items-center justify-center gap-2">
                                            <Crown className="w-4 h-4 text-purple-400" />
                                            <span className="text-purple-300 text-sm font-bold">
                                                Titolo sbloccato: Maratoneta Settimanale!
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Mini calendar showing week status after claim */}
                                <div className="mb-4 flex items-center justify-center gap-1.5">
                                    {calendar.map((day) => (
                                        <div
                                            key={day.date}
                                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold
                                                ${day.status === 'claimed' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : ''}
                                                ${day.status === 'missed' ? 'bg-red-500/10 text-red-400/50 border border-red-500/20' : ''}
                                                ${day.status === 'today' ? 'bg-gold-400/15 text-gold-400 border border-gold-400/30' : ''}
                                                ${day.status === 'future' ? 'bg-white/5 text-ash-600 border border-white/10' : ''}
                                            `}
                                        >
                                            {day.status === 'claimed' ? <Check className="w-3.5 h-3.5" /> : day.status === 'missed' ? <X className="w-3.5 h-3.5" /> : day.label.charAt(0)}
                                        </div>
                                    ))}
                                </div>

                                {streakCount > 0 && (
                                    <p className="text-ash-500 text-xs mb-4">
                                        <Flame className="w-3 h-3 inline text-ember-400" /> Streak di {streakCount} giorni — {
                                            streakCount >= 7 ? 'bonus MASSIMO!' :
                                                streakCount >= 3 ? 'bonus aumentato!' :
                                                    'continua per bonus maggiori!'
                                        }
                                    </p>
                                )}

                                <button
                                    onClick={handleClose}
                                    className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-brand-orange via-gold-400 to-brand-orange text-brand-charcoal hover:shadow-[0_0_20px_rgba(255,215,0,0.3)] transition-all duration-300"
                                >
                                    Andiamo!
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Individual calendar day box */
function CalendarDay({
    day,
    allPriorDaysClaimed,
    animationsEnabled,
}: {
    day: DayCalendarEntry;
    allPriorDaysClaimed: boolean;
    animationsEnabled: boolean;
}) {
    const isClaimed = day.status === 'claimed';
    const isMissed = day.status === 'missed';
    const isToday = day.status === 'today';
    const isFuture = day.status === 'future';

    return (
        <div
            className={`
                relative flex-1 flex flex-col items-center py-2.5 px-1 rounded-xl border transition-all duration-300
                ${isToday ? 'border-gold-400/60 bg-gradient-to-b from-gold-400/15 to-brand-orange/10 shadow-[0_0_12px_rgba(255,215,0,0.15)]' : ''}
                ${isToday && animationsEnabled ? 'animate-daily-calendar-glow' : ''}
                ${isClaimed ? 'border-emerald-500/40 bg-emerald-500/8' : ''}
                ${isMissed ? 'border-red-500/25 bg-red-500/5 opacity-50' : ''}
                ${isFuture ? 'border-white/8 bg-white/[0.02] opacity-35' : ''}
            `}
        >
            {/* Day label */}
            <span className={`text-[10px] font-semibold uppercase tracking-wider mb-1
                ${isToday ? 'text-gold-300' : isClaimed ? 'text-emerald-400' : isMissed ? 'text-red-400' : 'text-ash-500'}
            `}>
                {day.label}
            </span>

            {/* Status icon */}
            <div className="relative w-8 h-8 flex items-center justify-center mb-1">
                {isClaimed && (
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                )}
                {isMissed && (
                    <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center">
                        <X className="w-4 h-4 text-red-400/70" />
                    </div>
                )}
                {isToday && (
                    <div className={`w-7 h-7 rounded-full bg-gold-400/20 flex items-center justify-center ${animationsEnabled ? 'animate-daily-flame-flicker' : ''}`}>
                        <Gift className="w-4 h-4 text-gold-400" />
                    </div>
                )}
                {isFuture && (
                    <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center">
                        <Lock className="w-3.5 h-3.5 text-ash-600" />
                    </div>
                )}
            </div>

            {/* Coin amount */}
            <div className={`flex items-center gap-0.5
                ${isToday ? 'text-gold-300' : isClaimed ? 'text-emerald-300' : isMissed ? 'text-red-300/50' : 'text-ash-500'}
            `}>
                <Coins className="w-3 h-3" />
                <span className="text-xs font-bold">
                    {day.isStreakBonus && !allPriorDaysClaimed && !isClaimed ? '?' : day.reward}
                </span>
            </div>

            {/* Sunday crown indicator */}
            {day.isStreakBonus && (
                <Crown className={`absolute -top-2 -right-1 w-3.5 h-3.5 ${allPriorDaysClaimed || isClaimed ? 'text-gold-400' : 'text-ash-600'}`} />
            )}
        </div>
    );
}
