'use client';

import { useEffect, useState, useCallback } from 'react';
import { Swords, Coins, Timer, Target, X } from 'lucide-react';
import { SafeWrapper } from './SafeWrapper';

type DuelStartDetail = {
    id: string;
    type: string;
    title: string;
    body: string;
    metadata: {
        duelId: string;
        opponentId: string;
        opponentName: string;
        metric: string;
        metricLabel: string;
        durationMinutes: number;
        stake: number;
        pot: number;
    } | null;
};

function DuelStartOverlayInner() {
    const [data, setData] = useState<DuelStartDetail | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        function handler(e: Event) {
            const detail = (e as CustomEvent<DuelStartDetail>).detail;
            if (!detail || !detail.metadata) return;
            setData(detail);
            setVisible(true);
        }
        window.addEventListener('duel_started', handler);
        return () => window.removeEventListener('duel_started', handler);
    }, []);

    const close = useCallback(() => {
        setVisible(false);
        setTimeout(() => setData(null), 400);
    }, []);

    if (!visible || !data?.metadata) return null;

    const { opponentName, metricLabel, durationMinutes, stake, pot } = data.metadata;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-duel-overlay-in"
            style={{
                background: 'radial-gradient(ellipse at center, rgba(120, 20, 20, 0.92) 0%, rgba(20, 10, 5, 0.96) 70%)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={close}
        >
            {/* Animated fire particles background */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute inset-0 opacity-30" style={{
                    background: 'radial-gradient(circle at 30% 40%, rgba(255, 140, 66, 0.6) 0%, transparent 40%), radial-gradient(circle at 70% 60%, rgba(255, 80, 20, 0.5) 0%, transparent 45%)',
                }} />
            </div>

            {/* Content */}
            <div
                className="relative w-full max-w-lg text-center animate-duel-content-in"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={close}
                    className="absolute -top-2 -right-2 p-2 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 transition-colors"
                >
                    <X className="w-4 h-4 text-white/80" />
                </button>

                {/* Crossed swords icon with glow */}
                <div className="flex justify-center mb-6">
                    <div className="relative">
                        <div
                            className="absolute inset-0 rounded-full blur-3xl animate-pulse"
                            style={{ background: 'radial-gradient(circle, rgba(255,191,0,0.7) 0%, transparent 70%)' }}
                        />
                        <div className="relative w-28 h-28 rounded-full flex items-center justify-center border-2"
                            style={{
                                background: 'linear-gradient(135deg, #fd8b00, #ff3008)',
                                borderColor: 'rgba(255,215,0,0.8)',
                                boxShadow: '0 0 60px rgba(255,140,66,0.6), inset 0 0 30px rgba(0,0,0,0.3)',
                            }}
                        >
                            <Swords className="w-14 h-14 text-white drop-shadow-lg" strokeWidth={2.5} />
                        </div>
                    </div>
                </div>

                {/* Title */}
                <h1
                    className="text-5xl font-black mb-2 tracking-tight uppercase"
                    style={{
                        background: 'linear-gradient(180deg, #ffe082 0%, #ffbf00 50%, #fd8b00 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textShadow: '0 0 30px rgba(255,191,0,0.5)',
                        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.7))',
                    }}
                >
                    Sfida!
                </h1>

                {/* Subtitle */}
                <div className="text-lg font-semibold text-white/90 mb-1">
                    Contro <span className="text-amber-300">{opponentName}</span>
                </div>
                <div className="text-xs uppercase tracking-[0.2em] text-white/50 mb-8">
                    Che vinca il migliore
                </div>

                {/* Stats card */}
                <div
                    className="rounded-2xl p-5 mb-6 border"
                    style={{
                        background: 'rgba(0,0,0,0.5)',
                        borderColor: 'rgba(255,191,0,0.3)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
                    }}
                >
                    <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col items-center gap-2">
                            <Target className="w-5 h-5 text-amber-300" />
                            <div className="text-[10px] uppercase tracking-wider text-white/50">Metrica</div>
                            <div className="text-sm font-bold text-white">{metricLabel}</div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <Timer className="w-5 h-5 text-amber-300" />
                            <div className="text-[10px] uppercase tracking-wider text-white/50">Durata</div>
                            <div className="text-sm font-bold text-white">
                                {durationMinutes >= 60 ? `${durationMinutes / 60}h` : `${durationMinutes}m`}
                            </div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <Coins className="w-5 h-5 text-amber-300" />
                            <div className="text-[10px] uppercase tracking-wider text-white/50">Posta</div>
                            <div className="text-sm font-bold text-white">{stake}</div>
                        </div>
                    </div>
                </div>

                {/* Pot highlight */}
                <div
                    className="rounded-xl px-5 py-4 mb-6 border-2"
                    style={{
                        background: 'linear-gradient(135deg, rgba(255,191,0,0.15), rgba(253,139,0,0.15))',
                        borderColor: 'rgba(255,215,0,0.5)',
                    }}
                >
                    <div className="text-[11px] uppercase tracking-wider text-amber-200/80 mb-1">Montepremi</div>
                    <div className="flex items-center justify-center gap-2">
                        <Coins className="w-6 h-6 text-yellow-400" />
                        <span className="text-4xl font-black text-yellow-300">{pot}</span>
                        <span className="text-sm text-yellow-200/70 font-medium">monete al vincitore</span>
                    </div>
                    <div className="text-[11px] text-amber-200/60 mt-2">
                        Hai già pagato <b className="text-amber-200">{stake} monete</b> di scommessa.
                    </div>
                </div>

                {/* Accept button */}
                <button
                    onClick={close}
                    className="w-full py-4 rounded-xl text-base font-black uppercase tracking-wider transition-all hover:brightness-110 hover:scale-[1.02] active:scale-100"
                    style={{
                        background: 'linear-gradient(135deg, #fd8b00, #ff3008)',
                        color: '#fff',
                        boxShadow: '0 8px 24px rgba(255,80,20,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
                        textShadow: '0 2px 4px rgba(0,0,0,0.4)',
                    }}
                >
                    Accetto la sfida ⚔️
                </button>
            </div>

            {/* Inline animations */}
            <style jsx>{`
                @keyframes duel-overlay-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes duel-content-in {
                    0% { opacity: 0; transform: scale(0.85) translateY(20px); }
                    100% { opacity: 1; transform: scale(1) translateY(0); }
                }
                .animate-duel-overlay-in {
                    animation: duel-overlay-in 0.35s ease-out;
                }
                .animate-duel-content-in {
                    animation: duel-content-in 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                }
            `}</style>
        </div>
    );
}

export function DuelStartOverlay() {
    return (
        <SafeWrapper fallback={null}>
            <DuelStartOverlayInner />
        </SafeWrapper>
    );
}
