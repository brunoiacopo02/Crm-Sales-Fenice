'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { SafeWrapper } from '@/components/SafeWrapper';
import {
    Compass, Lock, CheckCircle2, Swords, Shield, Sparkles, Crown,
    Flame, Droplets, Wind, Sun, Moon, Mountain, Zap, Heart,
    ChevronDown, ChevronUp, Trophy,
} from 'lucide-react';

// Types
type BossDef = {
    id: string;
    stageNumber: number;
    name: string;
    description: string;
    imageUrl: string | null;
    totalHp: number;
    element: string;
    rewardCreatureId: string | null;
    rewardCoins: number;
    rewardTitle: string | null;
};

type ActiveBoss = BossDef & { currentHp: number };

type AdventureProgress = {
    currentStage: number;
    currentBossHp: number | null;
    activeBoss: ActiveBoss | null;
    // Individual fields
    stageRequirement?: { metric: string; value: number };
    // Team fields
    level?: number;
    totalXp?: number;
    xpForNextLevel?: number;
} | null;

type Props = {
    progress: AdventureProgress;
    bosses: BossDef[];
    isTeam: boolean;
    userId: string;
};

const ELEMENT_ICONS: Record<string, typeof Flame> = {
    fuoco: Flame,
    acqua: Droplets,
    terra: Mountain,
    aria: Wind,
    luce: Sun,
    ombra: Moon,
};

const ELEMENT_COLORS: Record<string, { text: string; bg: string; border: string; glow: string }> = {
    fuoco: { text: 'text-red-400', bg: 'bg-red-950/40', border: 'border-red-500/50', glow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]' },
    acqua: { text: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/50', glow: 'shadow-[0_0_20px_rgba(6,182,212,0.3)]' },
    terra: { text: 'text-amber-500', bg: 'bg-amber-950/40', border: 'border-amber-600/50', glow: 'shadow-[0_0_20px_rgba(217,119,6,0.3)]' },
    aria: { text: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/50', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]' },
    luce: { text: 'text-yellow-300', bg: 'bg-yellow-950/40', border: 'border-yellow-400/50', glow: 'shadow-[0_0_20px_rgba(250,204,21,0.3)]' },
    ombra: { text: 'text-violet-400', bg: 'bg-violet-950/40', border: 'border-violet-500/50', glow: 'shadow-[0_0_20px_rgba(139,92,246,0.3)]' },
};

const DAMAGE_MAP: Record<string, number> = {
    chiamata: 5,
    fissaggio: 50,
    conferma: 30,
    presenza: 40,
    chiusura: 100,
};

function HpBar({ current, total, size = 'normal' }: { current: number; total: number; size?: 'normal' | 'large' }) {
    const pct = Math.max(0, Math.min(100, (current / total) * 100));
    const barColor = pct > 50 ? 'from-green-500 to-emerald-400' : pct > 25 ? 'from-yellow-500 to-orange-400' : 'from-red-500 to-rose-400';
    const h = size === 'large' ? 'h-5' : 'h-2.5';

    return (
        <div className={`w-full ${h} bg-black/40 rounded-full overflow-hidden border border-white/10`}>
            <div
                className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-700 ease-out`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

function BossCard({
    boss,
    isActive,
    isDefeated,
    currentHp,
}: {
    boss: BossDef;
    isActive: boolean;
    isDefeated: boolean;
    currentHp: number | null;
}) {
    const elConf = ELEMENT_COLORS[boss.element] || ELEMENT_COLORS.fuoco;
    const ElIcon = ELEMENT_ICONS[boss.element] || Zap;
    const [expanded, setExpanded] = useState(isActive);

    return (
        <div className={`rounded-xl border-2 ${isActive ? elConf.border + ' ' + elConf.glow : isDefeated ? 'border-green-500/30' : 'border-white/10'} ${isActive ? elConf.bg : isDefeated ? 'bg-green-950/20' : 'bg-[#1a1a2e]/60'} p-4 transition-all duration-300`}>
            {/* Header */}
            <div
                className="flex items-center justify-between cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(!expanded)}
                onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    {/* Boss avatar */}
                    <div className={`w-12 h-12 rounded-lg ${isActive ? elConf.bg : 'bg-black/30'} border ${isActive ? elConf.border : 'border-white/10'} flex items-center justify-center overflow-hidden`}>
                        {boss.imageUrl ? (
                            <img src={boss.imageUrl} alt={boss.name} className="w-full h-full object-cover rounded-lg" />
                        ) : (
                            <Swords className={`h-6 w-6 ${isActive ? elConf.text : isDefeated ? 'text-green-400/50' : 'text-white/20'}`} />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className={`text-sm font-bold ${isActive ? 'text-white' : isDefeated ? 'text-green-400/70' : 'text-white/40'}`}>
                                {boss.name}
                            </h3>
                            <div className={`flex items-center gap-1 text-[10px] ${elConf.text}`}>
                                <ElIcon className="h-3 w-3" />
                                <span className="capitalize">{boss.element}</span>
                            </div>
                        </div>
                        <div className="text-[11px] text-white/40">
                            Stadio {boss.stageNumber} {isDefeated && <span className="text-green-400">&mdash; Sconfitto</span>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isDefeated && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                    {isActive && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                    {expanded ? <ChevronUp className="h-4 w-4 text-white/30" /> : <ChevronDown className="h-4 w-4 text-white/30" />}
                </div>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="mt-4 space-y-3">
                    <div className="text-xs text-white/50">{boss.description}</div>

                    {/* HP Bar */}
                    {isActive && currentHp !== null && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5 text-white/60">
                                    <Heart className="h-3.5 w-3.5 text-red-400" />
                                    <span>HP</span>
                                </div>
                                <span className="text-white font-mono font-bold">{currentHp} / {boss.totalHp}</span>
                            </div>
                            <HpBar current={currentHp} total={boss.totalHp} size="large" />
                            {/* Damage reference */}
                            <div className="flex flex-wrap gap-2 mt-2">
                                {Object.entries(DAMAGE_MAP).map(([action, dmg]) => (
                                    <div key={action} className="flex items-center gap-1 bg-black/30 rounded-md px-2 py-1 text-[10px]">
                                        <Swords className="h-2.5 w-2.5 text-red-400" />
                                        <span className="text-white/60 capitalize">{action}</span>
                                        <span className="text-red-300 font-mono">-{dmg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {isDefeated && (
                        <div className="flex items-center gap-1.5 text-xs text-green-400/70">
                            <Trophy className="h-3.5 w-3.5" />
                            <span>Boss sconfitto! Ricompense ottenute.</span>
                        </div>
                    )}

                    {/* Rewards preview */}
                    <div className="flex flex-wrap gap-2 text-[11px]">
                        {boss.rewardCoins > 0 && (
                            <div className="flex items-center gap-1 bg-amber-900/30 border border-amber-500/20 rounded-lg px-2.5 py-1">
                                <Sparkles className="h-3 w-3 text-amber-400" />
                                <span className="text-amber-300">{boss.rewardCoins} Coins</span>
                            </div>
                        )}
                        {boss.rewardCreatureId && (
                            <div className="flex items-center gap-1 bg-purple-900/30 border border-purple-500/20 rounded-lg px-2.5 py-1">
                                <Shield className="h-3 w-3 text-purple-400" />
                                <span className="text-purple-300">Creatura</span>
                            </div>
                        )}
                        {boss.rewardTitle && (
                            <div className="flex items-center gap-1 bg-blue-900/30 border border-blue-500/20 rounded-lg px-2.5 py-1">
                                <Crown className="h-3 w-3 text-blue-400" />
                                <span className="text-blue-300">{boss.rewardTitle}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function StageNode({
    stage,
    status,
}: {
    stage: number;
    status: 'completed' | 'current' | 'locked';
}) {
    const base = 'w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold transition-all duration-200';

    if (status === 'completed') {
        return (
            <div className={`${base} bg-green-900/40 border border-green-500/30 text-green-400`} title={`Stadio ${stage} - Completato`}>
                <CheckCircle2 className="h-4 w-4" />
            </div>
        );
    }

    if (status === 'current') {
        return (
            <div
                className={`${base} bg-gradient-to-br from-orange-500/30 to-amber-500/30 border-2 border-orange-400 text-orange-300 shadow-[0_0_16px_rgba(251,146,60,0.4)] animate-pulse`}
                title={`Stadio ${stage} - Corrente`}
            >
                {stage}
            </div>
        );
    }

    return (
        <div className={`${base} bg-[#1a1a2e]/40 border border-white/5 text-white/20`} title={`Stadio ${stage} - Bloccato`}>
            <Lock className="h-3 w-3" />
        </div>
    );
}

export default function MappaAvventuraClient({ progress, bosses, isTeam, userId }: Props) {
    const currentStage = progress?.currentStage ?? 1;
    const initialBoss = progress?.activeBoss ?? null;

    // Realtime boss HP for team mode
    const [liveBossHp, setLiveBossHp] = useState<number | null>(null);
    const [lastDamageEvent, setLastDamageEvent] = useState<{ userName: string; damage: number; action: string } | null>(null);

    useEffect(() => {
        if (!isTeam) return;

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail) return;
            setLiveBossHp(detail.bossHp);
            setLastDamageEvent({ userName: detail.userName, damage: detail.damage, action: detail.action });
            // Auto-clear damage toast after 4s
            setTimeout(() => setLastDamageEvent(null), 4000);
        };

        window.addEventListener('team_boss_damage_event', handler);
        return () => window.removeEventListener('team_boss_damage_event', handler);
    }, [isTeam]);

    // Use live HP if available, otherwise initial
    const activeBoss = initialBoss ? {
        ...initialBoss,
        currentHp: liveBossHp !== null ? liveBossHp : initialBoss.currentHp,
    } : null;

    // Build boss lookup map
    const bossMap = useMemo(() => {
        const map: Record<number, BossDef> = {};
        for (const b of bosses) {
            map[b.stageNumber] = b;
        }
        return map;
    }, [bosses]);

    // Build 10 sections of 10 stages
    const sections = useMemo(() => {
        const result: { sectionIdx: number; stages: number[]; boss: BossDef | null; bossStage: number }[] = [];
        for (let s = 0; s < 10; s++) {
            const startStage = s * 10 + 1;
            const bossStage = (s + 1) * 10;
            const stages: number[] = [];
            for (let i = startStage; i < bossStage; i++) {
                stages.push(i);
            }
            stages.push(bossStage);
            result.push({ sectionIdx: s, stages, boss: bossMap[bossStage] || null, bossStage });
        }
        return result;
    }, [bossMap]);

    // Calculate overall progress
    const completedStages = Math.max(0, currentStage - 1);
    const progressPct = Math.round((completedStages / 100) * 100);

    return (
        <SafeWrapper>
            <div className="space-y-6 max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-600 to-red-600 shadow-lg shadow-orange-900/30">
                            <Compass className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                                {isTeam ? 'Avventura Team' : 'Mappa Avventura'}
                            </h1>
                            <div className="text-sm text-ash-500 mt-0.5">
                                {isTeam
                                    ? 'Il percorso condiviso del Team Conferme'
                                    : 'Il tuo percorso personale attraverso 100 stadi'}
                            </div>
                        </div>
                    </div>
                    {/* Progress counter */}
                    <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/10 rounded-xl px-5 py-3 text-center">
                        <div className="text-2xl font-bold text-white">{completedStages}<span className="text-white/40">/100</span></div>
                        <div className="text-[10px] text-white/50 uppercase tracking-wider mt-0.5">Stadi Completati</div>
                    </div>
                </div>

                {/* Overall progress bar */}
                <div className="bg-[#1a1a2e]/50 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-white/50 uppercase tracking-wider">Progresso Globale</div>
                        <div className="text-xs text-white/60 font-mono">{progressPct}%</div>
                    </div>
                    <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/10">
                        <div
                            className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                    {isTeam && progress && 'level' in progress && (
                        <div className="flex items-center gap-4 mt-3 text-xs text-white/50">
                            <div className="flex items-center gap-1">
                                <Shield className="h-3.5 w-3.5 text-blue-400" />
                                <span>Team Lv. <span className="text-white font-bold">{progress.level}</span></span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
                                <span>XP: <span className="text-white font-bold">{progress.totalXp}</span>/{progress.xpForNextLevel}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Active boss banner */}
                {activeBoss && (
                    <SafeWrapper>
                        <div className="bg-gradient-to-r from-red-950/40 to-orange-950/40 border-2 border-red-500/40 rounded-xl p-5 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
                            <div className="flex items-center gap-2 mb-3">
                                <Swords className="h-5 w-5 text-red-400 animate-pulse" />
                                <h2 className="text-lg font-bold text-red-300">Boss Attivo: {activeBoss.name}</h2>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-1.5 text-white/60">
                                        <Heart className="h-4 w-4 text-red-400" />
                                        <span>Vita</span>
                                    </div>
                                    <span className="text-white font-mono font-bold text-lg">{activeBoss.currentHp} / {activeBoss.totalHp}</span>
                                </div>
                                <HpBar current={activeBoss.currentHp} total={activeBoss.totalHp} size="large" />
                                {/* Live damage toast for team mode */}
                                {isTeam && lastDamageEvent && (
                                    <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300 animate-pulse">
                                        ⚔️ {lastDamageEvent.userName} ha inflitto {lastDamageEvent.damage} danni con un {lastDamageEvent.action}!
                                    </div>
                                )}
                                <div className="text-xs text-white/40 mt-2">
                                    Ogni azione lavorativa infligge danni al boss. Sconfiggilo per ottenere ricompense!
                                </div>
                            </div>
                        </div>
                    </SafeWrapper>
                )}

                {/* Adventure sections */}
                <div className="space-y-4">
                    {sections.map((section) => {
                        const sectionStart = section.stages[0];
                        const sectionEnd = section.bossStage;
                        const isSectionCompleted = currentStage > sectionEnd;
                        const isSectionActive = currentStage >= sectionStart && currentStage <= sectionEnd;
                        const isSectionLocked = currentStage < sectionStart;
                        const isBossActive = currentStage === sectionEnd && activeBoss !== null;
                        const isBossDefeated = currentStage > sectionEnd;

                        return (
                            <SafeWrapper key={section.sectionIdx}>
                                <div className={`rounded-xl border ${isSectionActive ? 'border-orange-500/30 bg-[#1a1a2e]/80' : isSectionCompleted ? 'border-green-500/20 bg-green-950/10' : 'border-white/5 bg-[#1a1a2e]/30'} p-4 transition-all duration-300`}>
                                    {/* Section header */}
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className={`text-xs font-bold uppercase tracking-wider ${isSectionActive ? 'text-orange-400' : isSectionCompleted ? 'text-green-400/70' : 'text-white/20'}`}>
                                                Zona {section.sectionIdx + 1}
                                            </div>
                                            <div className="text-[10px] text-white/30">
                                                Stadi {sectionStart}&ndash;{sectionEnd}
                                            </div>
                                        </div>
                                        {isSectionCompleted && (
                                            <div className="flex items-center gap-1 text-[10px] text-green-400/70">
                                                <CheckCircle2 className="h-3 w-3" />
                                                <span>Completata</span>
                                            </div>
                                        )}
                                        {isSectionLocked && (
                                            <div className="flex items-center gap-1 text-[10px] text-white/20">
                                                <Lock className="h-3 w-3" />
                                                <span>Bloccata</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Stage grid (9 normal + 1 boss) */}
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {section.stages.filter(s => s !== section.bossStage).map((stage) => {
                                            const status: 'completed' | 'current' | 'locked' =
                                                stage < currentStage ? 'completed' :
                                                    stage === currentStage ? 'current' : 'locked';
                                            return (
                                                <StageNode key={stage} stage={stage} status={status} />
                                            );
                                        })}
                                    </div>

                                    {/* Boss encounter */}
                                    {section.boss && (
                                        <BossCard
                                            boss={section.boss}
                                            isActive={isBossActive}
                                            isDefeated={isBossDefeated}
                                            currentHp={isBossActive ? (activeBoss?.currentHp ?? section.boss.totalHp) : null}
                                        />
                                    )}

                                    {/* Boss placeholder if no boss data */}
                                    {!section.boss && (
                                        <div className="rounded-xl border border-white/5 bg-black/20 p-4 flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-black/30 border border-white/5 flex items-center justify-center">
                                                <Swords className="h-5 w-5 text-white/15" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-white/30">Boss Stadio {section.bossStage}</div>
                                                <div className="text-[10px] text-white/15">In arrivo...</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </SafeWrapper>
                        );
                    })}
                </div>

                {/* Legend */}
                <div className="bg-[#1a1a2e]/50 border border-white/5 rounded-xl p-4">
                    <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Legenda</div>
                    <div className="flex flex-wrap gap-4 text-xs text-white/50">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-green-900/40 border border-green-500/30 flex items-center justify-center">
                                <CheckCircle2 className="h-3 w-3 text-green-400" />
                            </div>
                            <span>Completato</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-orange-500/20 border-2 border-orange-400 flex items-center justify-center animate-pulse">
                                <span className="text-[10px] text-orange-300 font-bold">N</span>
                            </div>
                            <span>Stadio Corrente</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-[#1a1a2e]/40 border border-white/5 flex items-center justify-center">
                                <Lock className="h-3 w-3 text-white/20" />
                            </div>
                            <span>Bloccato</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-red-950/40 border border-red-500/30 flex items-center justify-center">
                                <Swords className="h-3 w-3 text-red-400" />
                            </div>
                            <span>Boss</span>
                        </div>
                    </div>
                </div>
            </div>
        </SafeWrapper>
    );
}
