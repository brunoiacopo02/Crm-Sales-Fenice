"use client";

import { useState, useEffect, useCallback } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getActiveDuelsForUser } from "@/app/actions/duelActions";

type DuelData = {
    id: string;
    challengerId: string;
    opponentId: string;
    metric: string;
    duration: number;
    startTime: Date;
    endTime: Date;
    challengerScore: number;
    opponentScore: number;
    rewardCoins: number;
    challengerName: string;
    opponentName: string;
};

function formatCountdown(endTime: Date): string {
    const diff = new Date(endTime).getTime() - Date.now();
    if (diff <= 0) return "Tempo scaduto";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function DuelWidgetInner({ userId }: { userId: string }) {
    const [duels, setDuels] = useState<DuelData[]>([]);
    const [countdown, setCountdown] = useState("");

    const fetchDuels = useCallback(async () => {
        try {
            const data = await getActiveDuelsForUser(userId);
            setDuels(data as DuelData[]);
        } catch { /* ignore */ }
    }, [userId]);

    useEffect(() => {
        fetchDuels();
        const interval = setInterval(fetchDuels, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, [fetchDuels]);

    // Countdown ticker
    useEffect(() => {
        if (duels.length === 0) return;
        const ticker = setInterval(() => {
            setCountdown(formatCountdown(duels[0].endTime));
        }, 1000);
        return () => clearInterval(ticker);
    }, [duels]);

    if (duels.length === 0) return null;

    const duel = duels[0]; // Show first active duel
    const isChallenger = duel.challengerId === userId;
    const myScore = isChallenger ? duel.challengerScore : duel.opponentScore;
    const theirScore = isChallenger ? duel.opponentScore : duel.challengerScore;
    const opponentName = isChallenger ? duel.opponentName : duel.challengerName;
    const isWinning = myScore > theirScore;
    const isTied = myScore === theirScore;

    return (
        <div className="bg-gradient-to-r from-slate-800/90 to-slate-900/90 border border-amber-500/30 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-lg">⚔️</span>
                    <span className="text-sm font-bold text-amber-400">Duello Attivo</span>
                </div>
                <div className="text-xs text-slate-400 bg-slate-700/60 px-2 py-1 rounded-full">
                    {countdown || formatCountdown(duel.endTime)}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className={`flex-1 text-center p-2 rounded-lg ${isWinning ? 'bg-emerald-900/30 border border-emerald-500/30' : 'bg-slate-700/30'}`}>
                    <div className="text-xs text-slate-400 mb-1">Tu</div>
                    <div className="text-2xl font-black text-white">{myScore}</div>
                </div>

                <div className="text-slate-500 font-bold text-sm">VS</div>

                <div className={`flex-1 text-center p-2 rounded-lg ${!isWinning && !isTied ? 'bg-red-900/30 border border-red-500/30' : 'bg-slate-700/30'}`}>
                    <div className="text-xs text-slate-400 mb-1 truncate">{opponentName}</div>
                    <div className="text-2xl font-black text-white">{theirScore}</div>
                </div>
            </div>

            <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                <span className="capitalize">Metrica: {duel.metric}</span>
                <span className="text-yellow-400">🪙 {duel.rewardCoins} in palio</span>
            </div>
        </div>
    );
}

export function DuelWidget({ userId }: { userId: string }) {
    return (
        <SafeWrapper>
            <DuelWidgetInner userId={userId} />
        </SafeWrapper>
    );
}
