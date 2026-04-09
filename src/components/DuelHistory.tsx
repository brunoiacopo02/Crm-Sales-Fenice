"use client";

import { SafeWrapper } from "./SafeWrapper";

type DuelRecord = {
    id: string;
    opponentName: string;
    metric: string;
    myScore: number;
    theirScore: number;
    result: string;
    rewardCoins: number;
    endTime: Date;
};

type DuelStats = {
    totalDuels: number;
    wins: number;
    losses: number;
    winRate: number;
};

const RESULT_BADGE: Record<string, { label: string; bg: string; text: string }> = {
    VINTO: { label: 'Vittoria', bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
    PERSO: { label: 'Sconfitta', bg: 'bg-red-500/20', text: 'text-red-400' },
    PARI: { label: 'Pareggio', bg: 'bg-slate-500/20', text: 'text-slate-400' },
};

function DuelHistoryInner({ duels, stats }: { duels: DuelRecord[]; stats: DuelStats }) {
    if (stats.totalDuels === 0) return null;

    return (
        <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/10 rounded-xl p-5">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>⚔️</span> Storico Duelli
            </h3>

            {/* Stats bar */}
            <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="text-center bg-black/20 rounded-lg p-2">
                    <div className="text-lg font-bold text-white">{stats.totalDuels}</div>
                    <div className="text-[10px] text-white/40 uppercase">Totali</div>
                </div>
                <div className="text-center bg-black/20 rounded-lg p-2">
                    <div className="text-lg font-bold text-emerald-400">{stats.wins}</div>
                    <div className="text-[10px] text-white/40 uppercase">Vittorie</div>
                </div>
                <div className="text-center bg-black/20 rounded-lg p-2">
                    <div className="text-lg font-bold text-red-400">{stats.losses}</div>
                    <div className="text-[10px] text-white/40 uppercase">Sconfitte</div>
                </div>
                <div className="text-center bg-black/20 rounded-lg p-2">
                    <div className="text-lg font-bold text-amber-400">{stats.winRate}%</div>
                    <div className="text-[10px] text-white/40 uppercase">Win Rate</div>
                </div>
            </div>

            {/* Duel list */}
            <div className="space-y-2">
                {duels.map(duel => {
                    const badge = RESULT_BADGE[duel.result] || RESULT_BADGE.PARI;
                    return (
                        <div key={duel.id} className="flex items-center gap-3 bg-black/20 rounded-lg p-3">
                            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${badge.bg} ${badge.text}`}>
                                {badge.label}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white truncate">vs {duel.opponentName}</div>
                                <div className="text-[10px] text-white/40 capitalize">{duel.metric}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-bold text-white">{duel.myScore} - {duel.theirScore}</div>
                                {duel.result === 'VINTO' && (
                                    <div className="text-[10px] text-yellow-400">+{duel.rewardCoins} 🪙</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function DuelHistory({ duels, stats }: { duels: DuelRecord[]; stats: DuelStats }) {
    return (
        <SafeWrapper>
            <DuelHistoryInner duels={duels} stats={stats} />
        </SafeWrapper>
    );
}
