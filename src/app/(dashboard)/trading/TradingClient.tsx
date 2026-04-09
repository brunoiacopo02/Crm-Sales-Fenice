"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SafeWrapper } from "@/components/SafeWrapper";
import {
  createTradeOffer,
  acceptTradeOffer,
  rejectTradeOffer,
  getOtherUserCreatures,
} from "@/app/actions/tradingActions";

type Creature = {
  userCreatureId: string;
  creatureId: string;
  level: number;
  isEquipped: boolean;
  name: string;
  rarity: string;
  element: string;
  imageUrl: string | null;
  xpFed?: number;
  obtainedAt?: Date | null;
  description?: string;
  baseXpBonus?: number;
  baseCoinBonus?: number;
  maxLevel?: number;
};

type Offer = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  createdAt: Date;
  offeredCreature: {
    name: string;
    rarity: string;
    element: string;
    level: number;
  } | null;
  requestedCreature: {
    name: string;
    rarity: string;
    element: string;
    level: number;
  } | null;
  fromUserName: string;
  toUserName: string;
};

type GdoUser = {
  id: string;
  name: string | null;
  displayName: string | null;
  gdoCode: number | null;
};

type Tab = "tradable" | "received" | "sent";
type ModalStep = "select_mine" | "select_gdo" | "select_theirs" | "confirm";

/* ── Stitch "Celestial Archive" Design Tokens ── */
const RARITY_ACCENT: Record<string, string> = {
  common: "#6b7280",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#ffbf00",
};

const RARITY_LABEL: Record<string, string> = {
  common: "Comune",
  rare: "Raro",
  epic: "Epico",
  legendary: "Leggendario",
};

const ELEMENT_ICONS: Record<string, string> = {
  fuoco: "\uD83D\uDD25",
  terra: "\uD83C\uDF3F",
  acqua: "\uD83D\uDCA7",
  aria: "\uD83D\uDCA8",
  luce: "\u2728",
  ombra: "\uD83C\uDF11",
};

/* ── Creature Card (Genshin-style: left accent bar + tonal surface) ── */
function CreatureCard({
  c,
  selected,
  onClick,
  compact,
}: {
  c: Creature;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  const accent = RARITY_ACCENT[c.rarity] || RARITY_ACCENT.common;
  return (
    <div
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-lg cursor-pointer transition-all duration-200
        ${selected ? "ring-2 ring-amber-400/60 scale-[1.03]" : "hover:scale-[1.02]"}
        ${compact ? "p-2.5" : "p-3"}
      `}
      style={{
        background: selected
          ? "rgba(42, 42, 42, 0.95)"
          : "rgba(32, 31, 31, 0.7)",
        backdropFilter: "blur(12px)",
        boxShadow: selected
          ? `0 0 20px ${accent}30`
          : `0 0 10px ${accent}10`,
      }}
    >
      {/* Left rarity accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-lg"
        style={{ background: accent }}
      />

      <div className="pl-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-base">
            {ELEMENT_ICONS[c.element] || "\uD83D\uDD2E"}
          </span>
          <span
            className="font-semibold text-sm truncate"
            style={{ color: "#e5e2e1" }}
          >
            {c.name}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#d4c5ab" }}>
            Lv.{c.level}
          </span>
          <div
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              background: `${accent}18`,
              color: accent,
            }}
          >
            <div
              className="h-1 w-1 rounded-full"
              style={{ background: accent }}
            />
            {RARITY_LABEL[c.rarity] || c.rarity}
          </div>
        </div>
        {!compact && c.baseXpBonus != null && (
          <div
            className="flex gap-2 mt-1.5 text-[10px]"
            style={{ color: "#9c8f78" }}
          >
            {c.baseXpBonus > 0 && <span>+{c.baseXpBonus}% XP</span>}
            {c.baseCoinBonus != null && c.baseCoinBonus > 0 && (
              <span>+{c.baseCoinBonus}% Coins</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Offer Card ── */
function OfferCard({
  offer,
  userId,
  onAccept,
  onReject,
  isPending,
}: {
  offer: Offer;
  userId: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}) {
  const isReceived = offer.toUserId === userId;
  const statusStyle =
    offer.status === "accepted"
      ? { color: "#4caf50", label: "Accettata" }
      : offer.status === "rejected"
        ? { color: "#ef4444", label: "Rifiutata" }
        : { color: "#ffbf00", label: "In attesa" };

  const offAccent = RARITY_ACCENT[offer.offeredCreature?.rarity || "common"];
  const reqAccent = RARITY_ACCENT[offer.requestedCreature?.rarity || "common"];

  return (
    <div
      className="relative overflow-hidden rounded-lg p-4"
      style={{
        background: "rgba(32, 31, 31, 0.7)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs" style={{ color: "#d4c5ab" }}>
          {isReceived
            ? `Da: ${offer.fromUserName}`
            : `A: ${offer.toUserName}`}
        </div>
        <div
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
          style={{
            color: statusStyle.color,
            background: `${statusStyle.color}18`,
          }}
        >
          {statusStyle.label}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Offered */}
        <div className="flex-1 relative overflow-hidden rounded-lg p-3" style={{ background: "rgba(42, 42, 42, 0.6)" }}>
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: offAccent }}
          />
          <div className="pl-2">
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#9c8f78" }}>
              Offerta
            </div>
            <div className="text-sm font-semibold" style={{ color: "#e5e2e1" }}>
              {offer.offeredCreature?.name || "?"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#d4c5ab" }}>
              Lv.{offer.offeredCreature?.level || 1} &middot;{" "}
              {RARITY_LABEL[offer.offeredCreature?.rarity || "common"]}
            </div>
          </div>
        </div>

        <div className="text-xl" style={{ color: "#ffbf00" }}>
          {"\u21C4"}
        </div>

        {/* Requested */}
        <div className="flex-1 relative overflow-hidden rounded-lg p-3" style={{ background: "rgba(42, 42, 42, 0.6)" }}>
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: reqAccent }}
          />
          <div className="pl-2">
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#9c8f78" }}>
              Richiesta
            </div>
            <div className="text-sm font-semibold" style={{ color: "#e5e2e1" }}>
              {offer.requestedCreature?.name || "?"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#d4c5ab" }}>
              Lv.{offer.requestedCreature?.level || 1} &middot;{" "}
              {RARITY_LABEL[offer.requestedCreature?.rarity || "common"]}
            </div>
          </div>
        </div>
      </div>

      {isReceived && offer.status === "pending" && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onAccept(offer.id)}
            disabled={isPending}
            className="flex-1 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #4caf50, #388e3c)",
              color: "#fff",
            }}
          >
            Accetta
          </button>
          <button
            onClick={() => onReject(offer.id)}
            disabled={isPending}
            className="flex-1 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
            }}
          >
            Rifiuta
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main Trading Client ── */
export default function TradingClient({
  userId,
  myCreatures,
  offers,
  gdoUsers,
}: {
  userId: string;
  myCreatures: Creature[];
  offers: Offer[];
  gdoUsers: GdoUser[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("tradable");

  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("select_mine");
  const [selectedMyCreature, setSelectedMyCreature] = useState<Creature | null>(null);
  const [selectedGdo, setSelectedGdo] = useState<GdoUser | null>(null);
  const [theirCreatures, setTheirCreatures] = useState<Creature[]>([]);
  const [selectedTheirCreature, setSelectedTheirCreature] = useState<Creature | null>(null);
  const [loadingTheirs, setLoadingTheirs] = useState(false);

  const tradableCreatures = myCreatures.filter(
    (c) => !c.isEquipped && c.rarity !== "legendary"
  );
  const receivedOffers = offers.filter((o) => o.toUserId === userId);
  const sentOffers = offers.filter((o) => o.fromUserId === userId);
  const pendingReceived = receivedOffers.filter(
    (o) => o.status === "pending"
  ).length;

  function openModal() {
    setShowModal(true);
    setModalStep("select_mine");
    setSelectedMyCreature(null);
    setSelectedGdo(null);
    setTheirCreatures([]);
    setSelectedTheirCreature(null);
  }

  async function selectGdo(gdo: GdoUser) {
    setSelectedGdo(gdo);
    setLoadingTheirs(true);
    try {
      const creatures = await getOtherUserCreatures(gdo.id);
      setTheirCreatures(creatures as Creature[]);
    } catch {
      /* ignore */
    }
    setLoadingTheirs(false);
    setModalStep("select_theirs");
  }

  function handleAccept(offerId: string) {
    startTransition(async () => {
      await acceptTradeOffer(offerId, userId);
      router.refresh();
    });
  }

  function handleReject(offerId: string) {
    startTransition(async () => {
      await rejectTradeOffer(offerId, userId);
      router.refresh();
    });
  }

  function handleConfirmTrade() {
    if (!selectedMyCreature || !selectedGdo || !selectedTheirCreature) return;
    startTransition(async () => {
      await createTradeOffer(
        userId,
        selectedGdo.id,
        selectedMyCreature.userCreatureId,
        selectedTheirCreature.userCreatureId
      );
      setShowModal(false);
      router.refresh();
    });
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "tradable", label: "Scambiabili", count: tradableCreatures.length },
    { key: "received", label: "Ricevute", count: pendingReceived },
    { key: "sent", label: "Inviate", count: sentOffers.length },
  ];

  const STEPS: ModalStep[] = [
    "select_mine",
    "select_gdo",
    "select_theirs",
    "confirm",
  ];

  return (
    <SafeWrapper>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: "#e5e2e1" }}
            >
              Mercato Scambi
            </h1>
            <p className="text-sm mt-1" style={{ color: "#9c8f78" }}>
              Scambia creature con gli altri GDO del team
            </p>
          </div>
          <button
            onClick={openModal}
            className="font-bold px-5 py-2.5 rounded-lg text-sm transition-all hover:brightness-110"
            style={{
              background: "linear-gradient(135deg, #fd8b00, #ffbf00)",
              color: "#402d00",
            }}
          >
            + Proponi Scambio
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 p-1 rounded-lg mb-6"
          style={{ background: "rgba(32, 31, 31, 0.5)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all"
              style={{
                background:
                  tab === t.key ? "rgba(53, 53, 52, 0.9)" : "transparent",
                color: tab === t.key ? "#ffe2ab" : "#9c8f78",
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "rgba(255,191,0,0.15)",
                    color: "#ffbf00",
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tradable Grid */}
        {tab === "tradable" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {tradableCreatures.length === 0 ? (
              <div
                className="col-span-full text-center py-16 text-sm"
                style={{ color: "#9c8f78" }}
              >
                Nessuna creatura scambiabile. Le equipaggiate e leggendarie
                sono escluse.
              </div>
            ) : (
              tradableCreatures.map((c) => (
                <CreatureCard key={c.userCreatureId} c={c} />
              ))
            )}
          </div>
        )}

        {/* Received Offers */}
        {tab === "received" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {receivedOffers.length === 0 ? (
              <div
                className="col-span-full text-center py-16 text-sm"
                style={{ color: "#9c8f78" }}
              >
                Nessuna offerta ricevuta.
              </div>
            ) : (
              receivedOffers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  userId={userId}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  isPending={isPending}
                />
              ))
            )}
          </div>
        )}

        {/* Sent Offers */}
        {tab === "sent" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sentOffers.length === 0 ? (
              <div
                className="col-span-full text-center py-16 text-sm"
                style={{ color: "#9c8f78" }}
              >
                Nessuna offerta inviata.
              </div>
            ) : (
              sentOffers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  userId={userId}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  isPending={isPending}
                />
              ))
            )}
          </div>
        )}

        {/* ── Trade Modal (Glassmorphism) ── */}
        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setShowModal(false)}
          >
            <div
              className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl"
              style={{
                background: "rgba(32, 31, 31, 0.85)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "0 0 40px rgba(255,191,0,0.08)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                className="p-5"
                style={{
                  borderBottom: "1px solid rgba(80, 69, 50, 0.3)",
                }}
              >
                <div className="flex items-center justify-between">
                  <h2
                    className="text-lg font-bold tracking-tight"
                    style={{ color: "#e5e2e1" }}
                  >
                    Proponi Scambio
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-xl transition-colors"
                    style={{ color: "#9c8f78" }}
                  >
                    {"\u2715"}
                  </button>
                </div>
                {/* Progress steps */}
                <div className="flex gap-2 mt-3">
                  {STEPS.map((step, i) => (
                    <div
                      key={step}
                      className="flex-1 h-[3px] rounded-full transition-all"
                      style={{
                        background:
                          i <= STEPS.indexOf(modalStep)
                            ? "linear-gradient(90deg, #fd8b00, #ffbf00)"
                            : "rgba(80, 69, 50, 0.3)",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto max-h-[60vh]">
                {/* Step 1: Select my creature */}
                {modalStep === "select_mine" && (
                  <div>
                    <div
                      className="text-xs uppercase tracking-wider mb-3 font-semibold"
                      style={{ color: "#9c8f78" }}
                    >
                      Seleziona la tua creatura
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {tradableCreatures.map((c) => (
                        <CreatureCard
                          key={c.userCreatureId}
                          c={c}
                          compact
                          selected={
                            selectedMyCreature?.userCreatureId ===
                            c.userCreatureId
                          }
                          onClick={() => {
                            setSelectedMyCreature(c);
                            setModalStep("select_gdo");
                          }}
                        />
                      ))}
                    </div>
                    {tradableCreatures.length === 0 && (
                      <div
                        className="text-center py-8 text-sm"
                        style={{ color: "#9c8f78" }}
                      >
                        Nessuna creatura scambiabile.
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Select GDO */}
                {modalStep === "select_gdo" && (
                  <div>
                    <div
                      className="text-xs uppercase tracking-wider mb-3 font-semibold"
                      style={{ color: "#9c8f78" }}
                    >
                      Seleziona il destinatario
                    </div>
                    <div className="space-y-2">
                      {gdoUsers.map((gdo) => (
                        <div
                          key={gdo.id}
                          onClick={() => selectGdo(gdo)}
                          className="flex items-center gap-3 rounded-lg p-3 cursor-pointer transition-all"
                          style={{
                            background: "rgba(42, 42, 42, 0.6)",
                          }}
                        >
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
                            style={{
                              background: "rgba(255,191,0,0.12)",
                              color: "#ffbf00",
                            }}
                          >
                            {(gdo.displayName || gdo.name || "?")[0].toUpperCase()}
                          </div>
                          <div>
                            <div
                              className="text-sm font-semibold"
                              style={{ color: "#e5e2e1" }}
                            >
                              {gdo.displayName || gdo.name}
                            </div>
                            {gdo.gdoCode && (
                              <div
                                className="text-xs"
                                style={{ color: "#9c8f78" }}
                              >
                                GDO #{gdo.gdoCode}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setModalStep("select_mine")}
                      className="mt-4 text-xs transition-colors"
                      style={{ color: "#9c8f78" }}
                    >
                      {"\u2190"} Indietro
                    </button>
                  </div>
                )}

                {/* Step 3: Select their creature */}
                {modalStep === "select_theirs" && (
                  <div>
                    <div
                      className="text-xs uppercase tracking-wider mb-3 font-semibold"
                      style={{ color: "#9c8f78" }}
                    >
                      Creature di{" "}
                      {selectedGdo?.displayName || selectedGdo?.name}
                    </div>
                    {loadingTheirs ? (
                      <div
                        className="text-center py-8 text-sm"
                        style={{ color: "#9c8f78" }}
                      >
                        Caricamento...
                      </div>
                    ) : theirCreatures.length === 0 ? (
                      <div
                        className="text-center py-8 text-sm"
                        style={{ color: "#9c8f78" }}
                      >
                        Nessuna creatura scambiabile.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {theirCreatures.map((c) => (
                          <CreatureCard
                            key={c.userCreatureId}
                            c={c}
                            compact
                            selected={
                              selectedTheirCreature?.userCreatureId ===
                              c.userCreatureId
                            }
                            onClick={() => {
                              setSelectedTheirCreature(c);
                              setModalStep("confirm");
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => setModalStep("select_gdo")}
                      className="mt-4 text-xs transition-colors"
                      style={{ color: "#9c8f78" }}
                    >
                      {"\u2190"} Indietro
                    </button>
                  </div>
                )}

                {/* Step 4: Confirm */}
                {modalStep === "confirm" && (
                  <div>
                    <div
                      className="text-xs uppercase tracking-wider mb-4 font-semibold"
                      style={{ color: "#9c8f78" }}
                    >
                      Conferma lo scambio
                    </div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex-1">
                        <div
                          className="text-[10px] uppercase tracking-wider mb-1.5"
                          style={{ color: "#9c8f78" }}
                        >
                          Tu offri
                        </div>
                        {selectedMyCreature && (
                          <CreatureCard c={selectedMyCreature} compact />
                        )}
                      </div>
                      <div className="text-2xl" style={{ color: "#ffbf00" }}>
                        {"\u21C4"}
                      </div>
                      <div className="flex-1">
                        <div
                          className="text-[10px] uppercase tracking-wider mb-1.5"
                          style={{ color: "#9c8f78" }}
                        >
                          Ricevi da{" "}
                          {selectedGdo?.displayName || selectedGdo?.name}
                        </div>
                        {selectedTheirCreature && (
                          <CreatureCard c={selectedTheirCreature} compact />
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleConfirmTrade}
                      disabled={isPending}
                      className="w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110"
                      style={{
                        background: "linear-gradient(135deg, #fd8b00, #ffbf00)",
                        color: "#402d00",
                      }}
                    >
                      {isPending ? "Invio..." : "Invia Proposta di Scambio"}
                    </button>
                    <button
                      onClick={() => setModalStep("select_theirs")}
                      className="mt-3 text-xs block mx-auto transition-colors"
                      style={{ color: "#9c8f78" }}
                    >
                      {"\u2190"} Indietro
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </SafeWrapper>
  );
}
