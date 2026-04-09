"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SafeWrapper } from "./SafeWrapper";
import { createDuel } from "@/app/actions/duelActions";

type GdoUser = {
  id: string;
  name: string | null;
  displayName: string | null;
  gdoCode: number | null;
};

const DURATIONS = [
  { label: "30 min", value: 30 },
  { label: "1 ora", value: 60 },
  { label: "2 ore", value: 120 },
  { label: "4 ore", value: 240 },
  { label: "Giornata", value: 480 },
];

const METRICS = [
  { label: "Fissaggi", value: "fissaggi" },
  { label: "Chiamate", value: "chiamate" },
];

function DuelCreateModalInner({
  gdoUsers,
  creatorRole,
}: {
  gdoUsers: GdoUser[];
  creatorRole: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [challenger, setChallenger] = useState<string>("");
  const [opponent, setOpponent] = useState<string>("");
  const [metric, setMetric] = useState<string>("fissaggi");
  const [duration, setDuration] = useState<number>(60);
  const [reward, setReward] = useState<number>(100);
  const [error, setError] = useState<string>("");

  function handleCreate() {
    if (!challenger || !opponent) {
      setError("Seleziona entrambi i GDO");
      return;
    }
    if (challenger === opponent) {
      setError("I due GDO devono essere diversi");
      return;
    }
    setError("");

    startTransition(async () => {
      const result = await createDuel(
        challenger,
        opponent,
        metric,
        duration,
        reward,
        creatorRole
      );
      if (result.success) {
        setIsOpen(false);
        setChallenger("");
        setOpponent("");
        router.refresh();
      } else {
        setError(result.error || "Errore creazione duello");
      }
    });
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(true)}
        className="font-bold px-4 py-2 rounded-lg text-sm transition-all hover:brightness-110"
        style={{
          background: "linear-gradient(135deg, #fd8b00, #ffbf00)",
          color: "#402d00",
        }}
      >
        {"\u2694\uFE0F"} Crea Duello
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl overflow-hidden"
            style={{
              background: "rgba(32, 31, 31, 0.85)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "0 0 40px rgba(255,191,0,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="p-5 flex items-center justify-between"
              style={{
                borderBottom: "1px solid rgba(80, 69, 50, 0.3)",
              }}
            >
              <h2
                className="text-lg font-bold tracking-tight"
                style={{ color: "#e5e2e1" }}
              >
                {"\u2694\uFE0F"} Crea Duello 1v1
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-xl transition-colors"
                style={{ color: "#9c8f78" }}
              >
                {"\u2715"}
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5">
              {/* Challenger */}
              <div>
                <label
                  className="text-[10px] uppercase tracking-wider font-bold mb-1.5 block"
                  style={{ color: "#9c8f78" }}
                >
                  Sfidante
                </label>
                <select
                  value={challenger}
                  onChange={(e) => setChallenger(e.target.value)}
                  className="w-full rounded-lg p-2.5 text-sm outline-none"
                  style={{
                    background: "rgba(28, 27, 27, 0.8)",
                    color: "#e5e2e1",
                    border: "1px solid rgba(80, 69, 50, 0.15)",
                  }}
                >
                  <option value="">Seleziona GDO...</option>
                  {gdoUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.name}{" "}
                      {u.gdoCode ? `(#${u.gdoCode})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Opponent */}
              <div>
                <label
                  className="text-[10px] uppercase tracking-wider font-bold mb-1.5 block"
                  style={{ color: "#9c8f78" }}
                >
                  Avversario
                </label>
                <select
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  className="w-full rounded-lg p-2.5 text-sm outline-none"
                  style={{
                    background: "rgba(28, 27, 27, 0.8)",
                    color: "#e5e2e1",
                    border: "1px solid rgba(80, 69, 50, 0.15)",
                  }}
                >
                  <option value="">Seleziona GDO...</option>
                  {gdoUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.name}{" "}
                      {u.gdoCode ? `(#${u.gdoCode})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Metric */}
              <div>
                <label
                  className="text-[10px] uppercase tracking-wider font-bold mb-1.5 block"
                  style={{ color: "#9c8f78" }}
                >
                  Metrica
                </label>
                <div className="flex gap-2">
                  {METRICS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setMetric(m.value)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background:
                          metric === m.value
                            ? "rgba(255,191,0,0.12)"
                            : "rgba(28, 27, 27, 0.8)",
                        color:
                          metric === m.value ? "#ffbf00" : "#9c8f78",
                        border: `1px solid ${
                          metric === m.value
                            ? "rgba(255,191,0,0.3)"
                            : "rgba(80, 69, 50, 0.15)"
                        }`,
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label
                  className="text-[10px] uppercase tracking-wider font-bold mb-1.5 block"
                  style={{ color: "#9c8f78" }}
                >
                  Durata
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDuration(d.value)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background:
                          duration === d.value
                            ? "rgba(255,191,0,0.12)"
                            : "rgba(28, 27, 27, 0.8)",
                        color:
                          duration === d.value ? "#ffbf00" : "#9c8f78",
                        border: `1px solid ${
                          duration === d.value
                            ? "rgba(255,191,0,0.3)"
                            : "rgba(80, 69, 50, 0.15)"
                        }`,
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reward */}
              <div>
                <label
                  className="text-[10px] uppercase tracking-wider font-bold mb-1.5 block"
                  style={{ color: "#9c8f78" }}
                >
                  Reward (Fenice Coins)
                </label>
                <input
                  type="number"
                  value={reward}
                  onChange={(e) => setReward(Number(e.target.value))}
                  min={10}
                  max={1000}
                  className="w-full rounded-lg p-2.5 text-sm outline-none"
                  style={{
                    background: "rgba(28, 27, 27, 0.8)",
                    color: "#e5e2e1",
                    border: "1px solid rgba(80, 69, 50, 0.15)",
                  }}
                />
              </div>

              {error && (
                <div className="text-sm" style={{ color: "#ffb4ab" }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={isPending}
                className="w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110"
                style={{
                  background: "linear-gradient(135deg, #fd8b00, #ffbf00)",
                  color: "#402d00",
                }}
              >
                {isPending ? "Creazione..." : "Lancia Duello!"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DuelCreateModal({
  gdoUsers,
  creatorRole,
}: {
  gdoUsers: GdoUser[];
  creatorRole: string;
}) {
  return (
    <SafeWrapper>
      <DuelCreateModalInner gdoUsers={gdoUsers} creatorRole={creatorRole} />
    </SafeWrapper>
  );
}
