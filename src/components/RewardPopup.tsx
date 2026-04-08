'use client';

import { useEffect, useState, useRef } from 'react';
import { Zap, Coins, Phone, CalendarCheck, CheckCircle, DollarSign, Star } from 'lucide-react';

const ACTION_CONFIG: Record<string, { icon: typeof Zap; label: string; color: string }> = {
    FISSATO: { icon: CalendarCheck, label: 'Appuntamento fissato!', color: 'text-brand-orange' },
    PRESENZIATO: { icon: CheckCircle, label: 'Lead presenziato!', color: 'text-emerald-400' },
    CHIUSO: { icon: DollarSign, label: 'Deal chiuso!', color: 'text-gold-400' },
    CONFERMATO: { icon: CheckCircle, label: 'Conferma registrata!', color: 'text-emerald-400' },
    DEAL_CHIUSO: { icon: DollarSign, label: 'Vendita conclusa!', color: 'text-gold-400' },
    BONUS_SETTIMANALE: { icon: Star, label: 'Bonus settimanale!', color: 'text-purple-400' },
};

const MOTIVATIONAL_MESSAGES = [
    'Continua cosi!',
    'Sei on fire!',
    'Che macchina!',
    'Unstoppable!',
    'Top performer!',
    'Stai spaccando!',
    'Grande lavoro!',
    'Inarrestabile!',
    'Fenomeno!',
    'Che bomba!',
    'Non ti ferma nessuno!',
    'Leggenda!',
];

export interface RewardPopupData {
    id: string;
    xpGained: number;
    coinsGained: number;
    actionType: string;
    didLevelUp: boolean;
    newLevel?: number;
    message: string;
}

interface RewardPopupProps {
    data: RewardPopupData;
    onDismiss: (id: string) => void;
    index: number;
}

export function RewardPopup({ data, onDismiss, index }: RewardPopupProps) {
    const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Enter -> visible
        const enterTimer = setTimeout(() => setPhase('visible'), 50);
        // Visible -> exit after 3s
        timerRef.current = setTimeout(() => setPhase('exit'), 3000);
        return () => {
            clearTimeout(enterTimer);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    useEffect(() => {
        if (phase === 'exit') {
            const exitTimer = setTimeout(() => onDismiss(data.id), 400);
            return () => clearTimeout(exitTimer);
        }
    }, [phase, data.id, onDismiss]);

    const config = ACTION_CONFIG[data.actionType] || { icon: Zap, label: 'Reward!', color: 'text-brand-orange' };
    const Icon = config.icon;
    const bottomOffset = 16 + index * 88;

    return (
        <div
            className={`fixed right-4 z-[9998] pointer-events-auto transition-all duration-400 ease-out ${
                phase === 'enter' ? 'translate-y-4 opacity-0 scale-95' :
                phase === 'exit' ? 'translate-y-(-2) opacity-0 scale-95' :
                'translate-y-0 opacity-100 scale-100'
            }`}
            style={{ bottom: bottomOffset }}
            onClick={() => setPhase('exit')}
        >
            <div className="relative overflow-hidden rounded-xl bg-ash-900/95 backdrop-blur-sm border border-ash-700/50 px-4 py-3 shadow-lg min-w-[260px] max-w-[320px] cursor-pointer reward-popup-glow">
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-xl opacity-30 reward-glow-pulse" />

                {/* Particles */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
                    {[...Array(6)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute w-1 h-1 rounded-full bg-brand-orange reward-particle"
                            style={{
                                left: `${15 + Math.random() * 70}%`,
                                top: `${20 + Math.random() * 60}%`,
                                animationDelay: `${i * 0.15}s`,
                                opacity: 0,
                            }}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="relative flex items-center gap-3">
                    <div className={`flex-shrink-0 ${config.color}`}>
                        <Icon size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-ash-300 truncate">{config.label}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                            {data.xpGained > 0 && (
                                <div className="flex items-center gap-0.5 text-sm font-bold text-emerald-400">
                                    <Zap size={13} />
                                    <span>+{data.xpGained} XP</span>
                                </div>
                            )}
                            {data.coinsGained > 0 && (
                                <div className="flex items-center gap-0.5 text-sm font-bold text-gold-400">
                                    <Coins size={13} />
                                    <span>+{data.coinsGained}</span>
                                </div>
                            )}
                        </div>
                        <div className="text-[10px] text-ash-400 mt-0.5 italic">{data.message}</div>
                    </div>
                </div>

                {/* Level up banner */}
                {data.didLevelUp && (
                    <div className="mt-2 pt-2 border-t border-ash-700/50 text-center">
                        <span className="text-xs font-bold text-brand-orange animate-pulse">
                            LEVEL UP! Livello {data.newLevel}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

export function getRandomMotivationalMessage(): string {
    return MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
}
