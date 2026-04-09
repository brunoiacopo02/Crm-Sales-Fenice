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

/* ── Stitch "Celestial Archive" Result Tokens ── */
const RESULT_STYLE: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  VINTO: {
    label: "Vittoria",
    color: "#4caf50",
    bg: "rgba(76,175,80,0.12)",
  },
  PERSO: {
    label: "Sconfitta",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  PARI: {
    label: "Pareggio",
    color: "#9c8f78",
    bg: "rgba(156,143,120,0.12)",
  },
};

function DuelHistoryInner({
  duels,
  stats,
}: {
  duels: DuelRecord[];
  stats: DuelStats;
}) {
  if (stats.totalDuels === 0) return null;

  const STAT_CARDS: { value: string | number; label: string; color: string }[] =
    [
      { value: stats.totalDuels, label: "Totali", color: "#e5e2e1" },
      { value: stats.wins, label: "Vittorie", color: "#4caf50" },
      { value: stats.losses, label: "Sconfitte", color: "#ef4444" },
      { value: `${stats.winRate}%`, label: "Win Rate", color: "#ffbf00" },
    ];

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: "rgba(32, 31, 31, 0.7)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-base">{"\u2694\uFE0F"}</span>
        <h3
          className="text-base font-bold tracking-tight"
          style={{ color: "#e5e2e1" }}
        >
          Storico Duelli
        </h3>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {STAT_CARDS.map((s) => (
          <div
            key={s.label}
            className="text-center p-3 rounded-lg"
            style={{ background: "rgba(14, 14, 14, 0.6)" }}
          >
            <div
              className="text-xl font-black tracking-tight"
              style={{ color: s.color }}
            >
              {s.value}
            </div>
            <div
              className="text-[10px] uppercase tracking-wider mt-0.5"
              style={{ color: "#9c8f78" }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Win rate bar */}
      <div
        className="h-[4px] rounded-full mb-5 overflow-hidden"
        style={{ background: "rgba(53, 53, 52, 0.8)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${stats.winRate}%`,
            background: "linear-gradient(90deg, #4caf50, #ffbf00)",
          }}
        />
      </div>

      {/* Duel list */}
      <div className="space-y-2">
        {duels.map((duel) => {
          const rs = RESULT_STYLE[duel.result] || RESULT_STYLE.PARI;
          return (
            <div
              key={duel.id}
              className="relative flex items-center gap-3 p-3 rounded-lg overflow-hidden"
              style={{ background: "rgba(14, 14, 14, 0.5)" }}
            >
              {/* Left accent bar */}
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                style={{ background: rs.color }}
              />

              {/* Result badge */}
              <div
                className="pl-2 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0"
                style={{
                  background: rs.bg,
                  color: rs.color,
                }}
              >
                {rs.label}
              </div>

              {/* Opponent + Metric */}
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-semibold truncate"
                  style={{ color: "#e5e2e1" }}
                >
                  vs {duel.opponentName}
                </div>
                <div
                  className="text-[10px] capitalize"
                  style={{ color: "#9c8f78" }}
                >
                  {duel.metric}
                </div>
              </div>

              {/* Score + Reward */}
              <div className="text-right shrink-0">
                <div
                  className="text-sm font-bold tabular-nums"
                  style={{ color: "#e5e2e1" }}
                >
                  {duel.myScore} - {duel.theirScore}
                </div>
                {duel.result === "VINTO" && duel.rewardCoins > 0 && (
                  <div className="flex items-center justify-end gap-0.5">
                    <span className="text-[10px]">{"\uD83D\uDCB0"}</span>
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: "#ffe2ab" }}
                    >
                      +{duel.rewardCoins}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DuelHistory({
  duels,
  stats,
}: {
  duels: DuelRecord[];
  stats: DuelStats;
}) {
  return (
    <SafeWrapper>
      <DuelHistoryInner duels={duels} stats={stats} />
    </SafeWrapper>
  );
}
