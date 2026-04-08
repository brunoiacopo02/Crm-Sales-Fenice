'use client';

import { useEffect, useState, useRef } from 'react';
import { Trophy, Zap, Coins, ChevronRight, Sparkles, Star } from 'lucide-react';
import { getAnimationsEnabled, triggerCelebration } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

interface CompletedQuestInfo {
    title: string;
    rewardXp: number;
    rewardCoins: number;
}

interface NextQuestInfo {
    title: string;
    description: string;
    targetValue: number;
    rewardXp: number;
    rewardCoins: number;
}

interface QuestChainModalProps {
    completedQuest: CompletedQuestInfo;
    nextQuest: NextQuestInfo | null;
    onClose: () => void;
}

const CELEBRATION_MESSAGES = [
    'Missione compiuta!',
    'Obiettivo raggiunto!',
    'Sfida superata!',
    'Eccellente lavoro!',
    'Sei inarrestabile!',
    'Che campione!',
];

function ConfettiParticle({ index }: { index: number }) {
    const colors = ['#FFBE82', '#E8523F', '#C9A13C', '#a78bfa', '#34d399', '#60a5fa', '#fbbf24'];
    const color = colors[index % colors.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 600;
    const duration = 2000 + Math.random() * 1500;
    const size = 6 + Math.random() * 6;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${left}%`,
                top: '-4%',
                width: size,
                height: size,
                backgroundColor: color,
                borderRadius: '2px',
                opacity: 0,
                animation: `quest-chain-confetti ${duration}ms ease-in ${delay}ms forwards`,
                transform: `rotate(${Math.random() * 360}deg)`,
            }}
        />
    );
}

function XpCounter({ value }: { value: number }) {
    const [displayed, setDisplayed] = useState(0);

    useEffect(() => {
        let start = 0;
        const increment = Math.max(1, Math.floor(value / 30));
        const timer = setInterval(() => {
            start += increment;
            if (start >= value) {
                setDisplayed(value);
                clearInterval(timer);
            } else {
                setDisplayed(start);
            }
        }, 30);
        return () => clearInterval(timer);
    }, [value]);

    return <span>{displayed}</span>;
}

export function QuestChainModal({ completedQuest, nextQuest, onClose }: QuestChainModalProps) {
    const [phase, setPhase] = useState<'celebrate' | 'teaser'>('celebrate');
    const [showTeaser, setShowTeaser] = useState(false);
    const animationsEnabled = getAnimationsEnabled();
    const messageRef = useRef(
        CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)]
    );

    useEffect(() => {
        if (animationsEnabled) {
            triggerCelebration('confetti');
        }
        playSound('quest_complete');
        // Show teaser after 1.5 seconds
        const timer = setTimeout(() => {
            setShowTeaser(true);
            setPhase('teaser');
        }, 1500);
        return () => clearTimeout(timer);
    }, [animationsEnabled]);

    // Close on click anywhere (after celebration)
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget && phase === 'teaser') {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: 9998 }}
            onClick={handleBackdropClick}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ animation: 'fade-in 300ms ease-out forwards' }} />

            {/* Confetti layer */}
            {animationsEnabled && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {Array.from({ length: 35 }).map((_, i) => (
                        <ConfettiParticle key={i} index={i} />
                    ))}
                </div>
            )}

            {/* Modal */}
            <div
                className="relative w-full max-w-md rounded-2xl overflow-hidden"
                style={{ animation: 'quest-chain-modal-enter 500ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
            >
                {/* Glow border effect */}
                <div className="absolute inset-0 rounded-2xl" style={{ animation: animationsEnabled ? 'quest-chain-glow 2s ease-in-out infinite' : 'none' }} />

                <div className="relative bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900/60 border border-gold-500/30 rounded-2xl p-6">
                    {/* Completion section */}
                    <div className="text-center">
                        {/* Trophy icon with glow */}
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gold-500/20 border-2 border-gold-400/50 mb-4" style={{ animation: animationsEnabled ? 'quest-chain-trophy-pulse 1.5s ease-in-out infinite' : 'none' }}>
                            <Trophy className="h-8 w-8 text-gold-400" />
                        </div>

                        <div className="text-sm font-semibold text-gold-400 uppercase tracking-wider mb-1">
                            {messageRef.current}
                        </div>
                        <h2 className="text-xl font-bold text-white mb-3">
                            Quest Completata!
                        </h2>
                        <div className="text-sm text-ash-300 mb-4 font-medium">
                            {completedQuest.title}
                        </div>

                        {/* Reward counters */}
                        <div className="flex items-center justify-center gap-6 mb-6">
                            <div className="flex items-center gap-2 bg-brand-orange/10 rounded-xl px-4 py-2.5 border border-brand-orange/20">
                                <Zap className="h-5 w-5 text-brand-orange" />
                                <div className="text-lg font-bold text-brand-orange">
                                    +<XpCounter value={completedQuest.rewardXp} /> XP
                                </div>
                            </div>
                            <div className="flex items-center gap-2 bg-gold-500/10 rounded-xl px-4 py-2.5 border border-gold-500/20">
                                <Coins className="h-5 w-5 text-gold-400" />
                                <div className="text-lg font-bold text-gold-400">
                                    +<XpCounter value={completedQuest.rewardCoins} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-transparent via-ash-600/50 to-transparent mb-5" />

                    {/* Next quest teaser or completion message */}
                    <div
                        className={`transition-all duration-500 ${showTeaser ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                    >
                        {nextQuest ? (
                            <div>
                                {/* Next quest header */}
                                <div className="flex items-center gap-2 mb-3">
                                    <Sparkles className="h-4 w-4 text-ember-400" />
                                    <div className="text-xs font-semibold text-ember-400 uppercase tracking-wider">
                                        Prossima sfida
                                    </div>
                                </div>

                                {/* Next quest card */}
                                <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4" style={{ animation: animationsEnabled ? 'quest-chain-shimmer 3s ease-in-out infinite' : 'none' }}>
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-sm text-white/90">
                                                {nextQuest.title}
                                            </div>
                                            <div className="text-xs text-ash-400 mt-1 line-clamp-2">
                                                {nextQuest.description}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Progress bar at 0% */}
                                    <div className="flex items-center gap-2.5 mb-3">
                                        <div className="flex-1 h-2 bg-ash-800/80 rounded-full overflow-hidden border border-ash-700/40">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-ember-500 via-brand-orange to-gold-400"
                                                style={{ width: '0%' }}
                                            />
                                        </div>
                                        <div className="text-xs font-mono text-ash-300 tabular-nums shrink-0 w-14 text-right">
                                            0/{nextQuest.targetValue}
                                        </div>
                                    </div>

                                    {/* Reward preview */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1 text-xs font-medium text-brand-orange-300">
                                            <Zap className="h-3 w-3" />
                                            +{nextQuest.rewardXp} XP
                                        </div>
                                        <div className="flex items-center gap-1 text-xs font-medium text-gold-400">
                                            <Coins className="h-3 w-3" />
                                            +{nextQuest.rewardCoins}
                                        </div>
                                    </div>
                                </div>

                                {/* CTA button */}
                                <button
                                    onClick={onClose}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-ember-500 to-brand-orange text-white border border-ember-400/30 hover:from-ember-400 hover:to-brand-orange-hover transition-all shadow-lg shadow-ember-500/20"
                                >
                                    Accetta la sfida!
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="text-center">
                                {/* All quests completed */}
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gold-500/15 border border-gold-500/30 mb-3">
                                    <Star className="h-6 w-6 text-gold-400" />
                                </div>
                                <div className="text-sm font-semibold text-white mb-1">
                                    Hai completato tutto!
                                </div>
                                <div className="text-xs text-ash-400 mb-4">
                                    Torna domani per nuove sfide
                                </div>

                                <button
                                    onClick={onClose}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-gold-500/30 to-gold-400/20 text-gold-300 border border-gold-500/30 hover:bg-gold-500/40 transition-all"
                                >
                                    Continua
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
