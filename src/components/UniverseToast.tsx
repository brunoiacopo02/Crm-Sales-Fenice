"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getAnimationsEnabled } from "@/lib/animationUtils";

type ToastType = "creature_drop" | "boss_defeated" | "chest_ready";
type Rarity = "common" | "rare" | "epic" | "legendary";
type Phase = "enter" | "visible" | "exit";

interface UniverseToastData {
  type: ToastType;
  creatureName?: string;
  rarity?: Rarity;
  element?: string;
  bossName?: string;
  rewardCoins?: number;
  rewardXp?: number;
  chestType?: string;
}

interface ToastItem extends UniverseToastData {
  id: string;
  phase: Phase;
}

const MAX_TOASTS = 2;
const TOAST_DURATION = 4000;
const EXIT_DURATION = 400;

/* ── Stitch Design System: "Celestial Archive" Rarity Tokens ── */
const RARITY_CONFIG: Record<
  Rarity,
  { accent: string; glow: string; label: string; glowSpread: string }
> = {
  common: {
    accent: "#6b7280",
    glow: "0 0 12px rgba(107,114,128,0.15)",
    label: "Comune",
    glowSpread: "0 0 20px rgba(107,114,128,0.08)",
  },
  rare: {
    accent: "#3b82f6",
    glow: "0 0 18px rgba(59,130,246,0.35)",
    label: "Raro",
    glowSpread: "0 0 30px rgba(59,130,246,0.15)",
  },
  epic: {
    accent: "#a855f7",
    glow: "0 0 22px rgba(168,85,247,0.4)",
    label: "Epico",
    glowSpread: "0 0 35px rgba(168,85,247,0.18)",
  },
  legendary: {
    accent: "#ffbf00",
    glow: "0 0 28px rgba(255,191,0,0.5)",
    label: "Leggendario",
    glowSpread: "0 0 40px rgba(255,191,0,0.2)",
  },
};

const ELEMENT_ICONS: Record<string, string> = {
  fuoco: "\uD83D\uDD25",
  terra: "\uD83C\uDF3F",
  acqua: "\uD83D\uDCA7",
  aria: "\uD83D\uDCA8",
  luce: "\u2728",
  ombra: "\uD83C\uDF11",
};

function ToastIcon({ type, element }: { type: ToastType; element?: string }) {
  if (type === "creature_drop") {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: "rgba(255,191,0,0.12)" }}
      >
        <span className="text-xl">
          {element ? ELEMENT_ICONS[element] || "\uD83E\uDD5A" : "\uD83E\uDD5A"}
        </span>
      </div>
    );
  }
  if (type === "boss_defeated") {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: "rgba(253,139,0,0.12)" }}
      >
        <span className="text-xl">{"\u2694\uFE0F"}</span>
      </div>
    );
  }
  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-lg"
      style={{ background: "rgba(76,175,80,0.12)" }}
    >
      <span className="text-xl">{"\uD83D\uDCE6"}</span>
    </div>
  );
}

function RarityBadge({ rarity }: { rarity: Rarity }) {
  const cfg = RARITY_CONFIG[rarity];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: `${cfg.accent}18`,
        color: cfg.accent,
        letterSpacing: "0.08em",
      }}
    >
      <div
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: cfg.accent, boxShadow: `0 0 6px ${cfg.accent}` }}
      />
      {cfg.label}
    </div>
  );
}

function CountdownBar({
  duration,
  rarity,
  animEnabled,
}: {
  duration: number;
  rarity: Rarity;
  animEnabled: boolean;
}) {
  const cfg = RARITY_CONFIG[rarity];
  if (!animEnabled) return null;
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden rounded-b-lg">
      <div
        className="h-full rounded-b-lg universe-toast-countdown"
        style={{
          background: `linear-gradient(90deg, ${cfg.accent}, ${cfg.accent}88)`,
          animationDuration: `${duration}ms`,
        }}
      />
    </div>
  );
}

function UniverseToastInner() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const animEnabled = useRef(true);

  useEffect(() => {
    animEnabled.current = getAnimationsEnabled();
  }, []);

  const addToast = useCallback((data: UniverseToastData) => {
    const id = crypto.randomUUID();
    const newToast: ToastItem = {
      ...data,
      id,
      phase: animEnabled.current ? "enter" : "visible",
    };

    setToasts((prev) => {
      const updated = [...prev, newToast];
      if (updated.length > MAX_TOASTS) {
        return updated.slice(updated.length - MAX_TOASTS);
      }
      return updated;
    });

    if (animEnabled.current) {
      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, phase: "visible" } : t))
        );
      }, 50);
    }

    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, phase: "exit" } : t))
      );
    }, TOAST_DURATION);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION + EXIT_DURATION);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UniverseToastData>).detail;
      if (detail) addToast(detail);
    };
    window.addEventListener("universe_toast", handler);
    return () => window.removeEventListener("universe_toast", handler);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9997] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => {
        const rarity = toast.rarity || "common";
        const cfg = RARITY_CONFIG[rarity];
        const isLegendary = rarity === "legendary";

        const phaseClass =
          toast.phase === "enter"
            ? "translate-x-[120%] opacity-0 scale-95"
            : toast.phase === "exit"
              ? "translate-x-[120%] opacity-0 scale-95"
              : "translate-x-0 opacity-100 scale-100";

        return (
          <div
            key={toast.id}
            className={`
              pointer-events-auto relative min-w-[340px] max-w-[420px] overflow-hidden rounded-lg
              transition-all duration-[400ms] ease-out ${phaseClass}
              ${isLegendary ? "universe-toast-legendary" : ""}
            `}
            style={{
              background: "rgba(32, 31, 31, 0.75)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: `${cfg.glow}, ${cfg.glowSpread}`,
            }}
          >
            {/* Rarity accent bar — left side (Genshin style) */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-lg"
              style={{ background: cfg.accent }}
            />

            {/* Shimmer overlay for rare+ */}
            {rarity !== "common" && animEnabled.current && (
              <div
                className="absolute inset-0 rounded-lg universe-toast-shimmer pointer-events-none"
                style={{
                  background: `linear-gradient(90deg, transparent 0%, ${cfg.accent}0D 50%, transparent 100%)`,
                  backgroundSize: "200% 100%",
                }}
              />
            )}

            {/* Content */}
            <div className="relative flex items-start gap-3 p-4 pl-5">
              <div className="flex-shrink-0 mt-0.5">
                <ToastIcon type={toast.type} element={toast.element} />
              </div>
              <div className="flex-1 min-w-0">
                {toast.type === "creature_drop" && (
                  <>
                    <div
                      className="text-xs font-bold uppercase tracking-wider mb-0.5"
                      style={{ color: "#ffe2ab" }}
                    >
                      Nuova Creatura!
                    </div>
                    <div
                      className="text-sm font-semibold truncate"
                      style={{ color: "#e5e2e1" }}
                    >
                      {toast.creatureName || "Creatura misteriosa"}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <RarityBadge rarity={rarity} />
                      {toast.element && (
                        <span
                          className="text-[10px] uppercase tracking-wider"
                          style={{ color: "#d4c5ab" }}
                        >
                          {toast.element}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {toast.type === "boss_defeated" && (
                  <>
                    <div
                      className="text-xs font-bold uppercase tracking-wider mb-0.5"
                      style={{ color: "#fd8b00" }}
                    >
                      Boss Sconfitto!
                    </div>
                    <div
                      className="text-sm font-semibold truncate"
                      style={{ color: "#e5e2e1" }}
                    >
                      {toast.bossName || "Boss"}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      {toast.rewardCoins != null && toast.rewardCoins > 0 && (
                        <div className="flex items-center gap-1">
                          <div
                            className="h-4 w-4 rounded-full flex items-center justify-center text-[9px]"
                            style={{
                              background: "rgba(255,191,0,0.18)",
                              color: "#ffbf00",
                            }}
                          >
                            {"\uD83D\uDCB0"}
                          </div>
                          <span
                            className="text-xs font-semibold"
                            style={{ color: "#ffe2ab" }}
                          >
                            +{toast.rewardCoins.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {toast.rewardXp != null && toast.rewardXp > 0 && (
                        <div className="flex items-center gap-1">
                          <div
                            className="h-4 w-4 rounded-full flex items-center justify-center text-[9px]"
                            style={{
                              background: "rgba(168,85,247,0.18)",
                              color: "#a855f7",
                            }}
                          >
                            {"\u2B50"}
                          </div>
                          <span
                            className="text-xs font-semibold"
                            style={{ color: "#d4c5ab" }}
                          >
                            +{toast.rewardXp.toLocaleString()} XP
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {toast.type === "chest_ready" && (
                  <>
                    <div
                      className="text-xs font-bold uppercase tracking-wider mb-0.5"
                      style={{ color: "#4caf50" }}
                    >
                      Baule Pronto!
                    </div>
                    <div
                      className="text-sm font-semibold"
                      style={{ color: "#e5e2e1" }}
                    >
                      Baule {toast.chestType || ""} pronto per l&apos;apertura
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Countdown progress bar */}
            <CountdownBar
              duration={TOAST_DURATION}
              rarity={rarity}
              animEnabled={animEnabled.current}
            />
          </div>
        );
      })}

      <style jsx>{`
        @keyframes universe-toast-shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        .universe-toast-countdown {
          animation-name: universe-toast-shrink;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        @keyframes universe-toast-shimmer-anim {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        .universe-toast-shimmer {
          animation: universe-toast-shimmer-anim 3s ease-in-out infinite;
        }
        @keyframes universe-toast-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          10%,
          30%,
          50%,
          70%,
          90% {
            transform: translateX(-2px);
          }
          20%,
          40%,
          60%,
          80% {
            transform: translateX(2px);
          }
        }
        .universe-toast-legendary {
          animation: universe-toast-shake 0.6s ease-in-out;
        }
      `}</style>
    </div>
  );
}

export function UniverseToast() {
  return (
    <SafeWrapper>
      <UniverseToastInner />
    </SafeWrapper>
  );
}
