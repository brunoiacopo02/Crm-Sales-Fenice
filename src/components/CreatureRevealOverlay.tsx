"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SafeWrapper } from "./SafeWrapper";
import { getAnimationsEnabled } from "@/lib/animationUtils";

type Rarity = "common" | "rare" | "epic" | "legendary";
type Phase = "hidden" | "glow" | "creature" | "info";

interface RevealData {
  creatureName: string;
  rarity: Rarity;
  element: string;
  imageUrl?: string | null;
  xpBonus?: number;
  coinBonus?: number;
}

/* ── Stitch "Celestial Archive" + "Aetheric Forge" Rarity Tokens ── */
const RARITY_CONFIG: Record<
  Rarity,
  { color: string; glowColor: string; label: string; radial: string }
> = {
  common: {
    color: "#6b7280",
    glowColor: "rgba(107,114,128,0.25)",
    label: "Comune",
    radial: "radial-gradient(circle, rgba(107,114,128,0.3), transparent 70%)",
  },
  rare: {
    color: "#3b82f6",
    glowColor: "rgba(59,130,246,0.35)",
    label: "Raro",
    radial: "radial-gradient(circle, rgba(59,130,246,0.35), transparent 70%)",
  },
  epic: {
    color: "#a855f7",
    glowColor: "rgba(168,85,247,0.4)",
    label: "Epico",
    radial: "radial-gradient(circle, rgba(168,85,247,0.4), transparent 70%)",
  },
  legendary: {
    color: "#ffbf00",
    glowColor: "rgba(255,191,0,0.5)",
    label: "Leggendario",
    radial: "radial-gradient(circle, rgba(255,191,0,0.5), transparent 70%)",
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

function CreatureRevealInner() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [data, setData] = useState<RevealData | null>(null);
  const animEnabled = useRef(true);

  useEffect(() => {
    animEnabled.current = getAnimationsEnabled();
  }, []);

  const startReveal = useCallback((reveal: RevealData) => {
    setData(reveal);

    if (!animEnabled.current) {
      setPhase("info");
      return;
    }

    setPhase("glow");
    setTimeout(() => setPhase("creature"), 900);
    setTimeout(() => setPhase("info"), 2000);
  }, []);

  const handleClose = useCallback(() => {
    setPhase("hidden");
    setData(null);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<RevealData>).detail;
      if (detail) startReveal(detail);
    };
    window.addEventListener("creature_reveal", handler);
    return () => window.removeEventListener("creature_reveal", handler);
  }, [startReveal]);

  if (phase === "hidden" || !data) return null;

  const cfg = RARITY_CONFIG[data.rarity] || RARITY_CONFIG.common;
  const isLegendary = data.rarity === "legendary";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
    >
      {/* Ascending particles (always visible) */}
      {animEnabled.current && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: isLegendary ? 30 : 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: `${2 + Math.random() * 3}px`,
                height: `${2 + Math.random() * 3}px`,
                background: isLegendary
                  ? "#ffbf00"
                  : cfg.color,
                left: `${Math.random() * 100}%`,
                bottom: `-${Math.random() * 10}%`,
                opacity: 0,
                animation: `creature-particle-rise ${3 + Math.random() * 4}s linear infinite`,
                animationDelay: `${Math.random() * 3}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Glow phase — expanding radial */}
      {phase === "glow" && (
        <div
          className="creature-reveal-glow"
          style={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: cfg.radial,
            animation: "creature-glow-expand 0.9s ease-out forwards",
          }}
        />
      )}

      {/* Creature phase — creature icon appears */}
      {phase === "creature" && (
        <div className="flex flex-col items-center creature-reveal-appear">
          <div
            className="w-36 h-36 rounded-xl flex items-center justify-center text-6xl"
            style={{
              background: "rgba(32, 31, 31, 0.6)",
              backdropFilter: "blur(12px)",
              boxShadow: `0 0 60px ${cfg.glowColor}, 0 0 120px ${cfg.glowColor}`,
            }}
          >
            {ELEMENT_ICONS[data.element] || "\uD83D\uDD2E"}
          </div>
        </div>
      )}

      {/* Info phase — full reveal with name, badge, stats */}
      {phase === "info" && (
        <div
          className={`flex flex-col items-center creature-reveal-info ${
            isLegendary ? "creature-legendary-shake" : ""
          }`}
        >
          {/* Creature icon container */}
          <div
            className="w-40 h-40 rounded-xl flex items-center justify-center text-7xl mb-8"
            style={{
              background: "rgba(32, 31, 31, 0.6)",
              backdropFilter: "blur(12px)",
              boxShadow: `0 0 80px ${cfg.glowColor}, 0 0 160px ${cfg.glowColor}`,
            }}
          >
            {ELEMENT_ICONS[data.element] || "\uD83D\uDD2E"}
          </div>

          {/* Rarity badge */}
          <div
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-widest mb-3"
            style={{
              background: `${cfg.color}20`,
              color: cfg.color,
              boxShadow: `0 0 12px ${cfg.color}30`,
            }}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{
                background: cfg.color,
                boxShadow: `0 0 8px ${cfg.color}`,
              }}
            />
            {cfg.label}
          </div>

          {/* Creature name */}
          <div
            className="text-3xl font-black tracking-tight mb-1"
            style={{ color: "#e5e2e1" }}
          >
            {data.creatureName}
          </div>

          {/* Element */}
          <div className="flex items-center gap-1.5 mb-6">
            <span className="text-base">
              {ELEMENT_ICONS[data.element] || "\uD83D\uDD2E"}
            </span>
            <span
              className="text-sm capitalize"
              style={{ color: "#d4c5ab" }}
            >
              {data.element}
            </span>
          </div>

          {/* Stat cards */}
          {(data.xpBonus || data.coinBonus) && (
            <div className="flex gap-3 mb-8">
              {data.xpBonus != null && data.xpBonus > 0 && (
                <div
                  className="px-4 py-2 rounded-lg text-center"
                  style={{
                    background: "rgba(168,85,247,0.1)",
                    boxShadow: "0 0 12px rgba(168,85,247,0.08)",
                  }}
                >
                  <div
                    className="text-lg font-bold"
                    style={{ color: "#a855f7" }}
                  >
                    +{data.xpBonus}%
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "#9c8f78" }}
                  >
                    XP Bonus
                  </div>
                </div>
              )}
              {data.coinBonus != null && data.coinBonus > 0 && (
                <div
                  className="px-4 py-2 rounded-lg text-center"
                  style={{
                    background: "rgba(255,191,0,0.1)",
                    boxShadow: "0 0 12px rgba(255,191,0,0.08)",
                  }}
                >
                  <div
                    className="text-lg font-bold"
                    style={{ color: "#ffbf00" }}
                  >
                    +{data.coinBonus}%
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "#9c8f78" }}
                  >
                    Coins
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Legendary particle burst */}
          {isLegendary && animEnabled.current && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    width: `${2 + Math.random() * 4}px`,
                    height: `${2 + Math.random() * 4}px`,
                    background: "#ffbf00",
                    left: `${30 + Math.random() * 40}%`,
                    top: `${30 + Math.random() * 40}%`,
                    opacity: 0,
                    animation: `creature-particle-burst ${1 + Math.random() * 1.5}s ease-out forwards`,
                    animationDelay: `${Math.random() * 0.5}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Dismiss button */}
          <button
            onClick={handleClose}
            className="px-8 py-3 rounded-lg text-sm font-bold transition-all hover:brightness-110"
            style={{
              background: "linear-gradient(135deg, #fd8b00, #ffbf00)",
              color: "#402d00",
              boxShadow: "0 0 20px rgba(255,191,0,0.2)",
            }}
          >
            Fantastico!
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes creature-glow-expand {
          0% {
            transform: scale(0.2);
            opacity: 0;
          }
          40% {
            opacity: 1;
          }
          100% {
            transform: scale(5);
            opacity: 0;
          }
        }
        .creature-reveal-appear {
          animation: creature-appear 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)
            forwards;
        }
        @keyframes creature-appear {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .creature-reveal-info {
          animation: creature-info-in 0.6s ease-out forwards;
        }
        @keyframes creature-info-in {
          0% {
            transform: translateY(30px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .creature-legendary-shake {
          animation: creature-info-in 0.6s ease-out forwards,
            creature-shake 0.6s ease-in-out 0.6s;
        }
        @keyframes creature-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          10%,
          30%,
          50%,
          70%,
          90% {
            transform: translateX(-5px);
          }
          20%,
          40%,
          60%,
          80% {
            transform: translateX(5px);
          }
        }
        @keyframes creature-particle-rise {
          0% {
            transform: translateY(0) scale(0.5);
            opacity: 0;
          }
          10% {
            opacity: 0.7;
          }
          90% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(-100vh) scale(1);
            opacity: 0;
          }
        }
        @keyframes creature-particle-burst {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(
                ${Math.random() > 0.5 ? "" : "-"}${50 + Math.random() * 100}px,
                ${Math.random() > 0.5 ? "" : "-"}${50 + Math.random() * 100}px
              )
              scale(0);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export function CreatureRevealOverlay() {
  return (
    <SafeWrapper>
      <CreatureRevealInner />
    </SafeWrapper>
  );
}
