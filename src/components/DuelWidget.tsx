"use client";

import { useState, useEffect, useCallback } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getActiveDuelsForUser } from "@/app/actions/duelActions";
import { createClient } from "@/utils/supabase/client";

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
    } catch {
      /* ignore */
    }
  }, [userId]);

  useEffect(() => {
    fetchDuels();
    // Polling ogni 5s per avere lo score sempre aggiornato durante il lavoro
    const interval = setInterval(fetchDuels, 5000);
    return () => clearInterval(interval);
  }, [fetchDuels]);

  // Realtime: refetch immediato ad ogni cambio nella tabella duels
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel('duel_widget_' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duels' }, () => {
        fetchDuels();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchDuels, userId]);

  useEffect(() => {
    if (duels.length === 0) return;
    const ticker = setInterval(() => {
      setCountdown(formatCountdown(duels[0].endTime));
    }, 1000);
    return () => clearInterval(ticker);
  }, [duels]);

  if (duels.length === 0) return null;

  const duel = duels[0];
  const isChallenger = duel.challengerId === userId;
  const myScore = isChallenger ? duel.challengerScore : duel.opponentScore;
  const theirScore = isChallenger ? duel.opponentScore : duel.challengerScore;
  const opponentName = isChallenger
    ? duel.opponentName
    : duel.challengerName;
  const total = myScore + theirScore;
  const myPercent = total > 0 ? (myScore / total) * 100 : 50;
  const isWinning = myScore > theirScore;
  const isTied = myScore === theirScore;

  return (
    <div
      className="relative overflow-hidden rounded-lg p-4 mb-4"
      style={{
        background: "rgba(32, 31, 31, 0.75)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 0 20px rgba(255,191,0,0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base">{"\u2694\uFE0F"}</span>
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: "#ffe2ab" }}
          >
            Duello Attivo
          </span>
        </div>
        <div
          className="text-[11px] font-semibold px-2.5 py-1 rounded-md"
          style={{
            background: "rgba(255,191,0,0.1)",
            color: "#ffbf00",
          }}
        >
          {countdown || formatCountdown(duel.endTime)}
        </div>
      </div>

      {/* Score Display — competitive split */}
      <div className="flex items-center gap-3">
        {/* My Side (blue) */}
        <div
          className="flex-1 text-center p-3 rounded-lg"
          style={{
            background: isWinning
              ? "rgba(59,130,246,0.12)"
              : "rgba(42, 42, 42, 0.6)",
          }}
        >
          <div
            className="text-[10px] uppercase tracking-wider mb-1"
            style={{ color: "#9c8f78" }}
          >
            Tu
          </div>
          <div
            className="text-3xl font-black tracking-tight"
            style={{ color: isWinning ? "#3b82f6" : "#e5e2e1" }}
          >
            {myScore}
          </div>
        </div>

        {/* VS */}
        <div
          className="text-xs font-bold"
          style={{ color: "#504532" }}
        >
          VS
        </div>

        {/* Their Side (red) */}
        <div
          className="flex-1 text-center p-3 rounded-lg"
          style={{
            background:
              !isWinning && !isTied
                ? "rgba(239,68,68,0.12)"
                : "rgba(42, 42, 42, 0.6)",
          }}
        >
          <div
            className="text-[10px] uppercase tracking-wider mb-1 truncate"
            style={{ color: "#9c8f78" }}
          >
            {opponentName}
          </div>
          <div
            className="text-3xl font-black tracking-tight"
            style={{
              color: !isWinning && !isTied ? "#ef4444" : "#e5e2e1",
            }}
          >
            {theirScore}
          </div>
        </div>
      </div>

      {/* Progress bar — shifts toward the leader */}
      <div
        className="h-[4px] rounded-full mt-3 overflow-hidden"
        style={{ background: "rgba(53, 53, 52, 0.8)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${myPercent}%`,
            background: isWinning
              ? "linear-gradient(90deg, #3b82f6, #60a5fa)"
              : isTied
                ? "linear-gradient(90deg, #9c8f78, #d4c5ab)"
                : "linear-gradient(90deg, #ef4444, #f87171)",
          }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "#9c8f78" }}
        >
          {duel.metric}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-xs">{"\uD83D\uDCB0"}</span>
          <span
            className="text-xs font-semibold"
            style={{ color: "#ffe2ab" }}
          >
            {duel.rewardCoins} in palio
          </span>
        </div>
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
