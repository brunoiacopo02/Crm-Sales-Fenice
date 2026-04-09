"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SafeWrapper } from "@/components/SafeWrapper";
import { createTradeOffer, acceptTradeOffer, rejectTradeOffer, getOtherUserCreatures } from "@/app/actions/tradingActions";

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
    offeredCreature: { name: string; rarity: string; element: string; level: number } | null;
    requestedCreature: { name: string; rarity: string; element: string; level: number } | null;
    fromUserName: string;
    toUserName: string;
};

type GdoUser = {
    id: string;
    name: string | null;
    displayName: string | null;
    gdoCode: number | null;
};

type Tab = 'tradable' | 'received' | 'sent';

const RARITY_COLORS: Record<string, string> = {
    common: 'border-slate-500 text-slate-300',
    rare: 'border-blue-500 text-blue-300',
    epic: 'border-purple-500 text-purple-300',
    legendary: 'border-yellow-500 text-yellow-300',
};

const RARITY_BG: Record<string, string> = {
    common: 'bg-slate-800/60',
    rare: 'bg-blue-900/30',
    epic: 'bg-purple-900/30',
    legendary: 'bg-yellow-900/20',
};

const ELEMENT_ICONS: Record<string, string> = {
    fuoco: '🔥', terra: '🌍', acqua: '💧', aria: '💨', luce: '✨', ombra: '🌑',
};

function CreatureCard({ c, selected, onClick }: { c: Creature; selected?: boolean; onClick?: () => void }) {
    return (
        <div
            onClick={onClick}
            className={`
                rounded-lg border-2 p-3 cursor-pointer transition-all
                ${RARITY_COLORS[c.rarity] || RARITY_COLORS.common}
                ${RARITY_BG[c.rarity] || RARITY_BG.common}
                ${selected ? 'ring-2 ring-amber-400 scale-105' : 'hover:scale-[1.02]'}
            `}
        >
            <div className="flex items-center gap-2 mb-1">
                <span>{ELEMENT_ICONS[c.element] || '🔮'}</span>
                <span className="font-bold text-sm text-white truncate">{c.name}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
                <span>Lv.{c.level}</span>
                <span className="capitalize">{c.rarity}</span>
            </div>
        </div>
    );
}

function OfferCard({ offer, userId, onAccept, onReject, isPending }: {
    offer: Offer;
    userId: string;
    onAccept: (id: string) => void;
    onReject: (id: string) => void;
    isPending: boolean;
}) {
    const isReceived = offer.toUserId === userId;
    const statusColor = offer.status === 'accepted' ? 'text-emerald-400' : offer.status === 'rejected' ? 'text-red-400' : 'text-amber-400';

    return (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-slate-400">
                    {isReceived ? `Da: ${offer.fromUserName}` : `A: ${offer.toUserName}`}
                </div>
                <div className={`text-xs font-bold uppercase ${statusColor}`}>{offer.status}</div>
            </div>
            <div className="flex items-center gap-3">
                <div className={`flex-1 rounded-lg p-2 border ${RARITY_COLORS[offer.offeredCreature?.rarity || 'common']}`}>
                    <div className="text-xs text-slate-400 mb-1">Offerta</div>
                    <div className="text-sm font-bold text-white">{offer.offeredCreature?.name || '?'}</div>
                    <div className="text-xs text-slate-400">Lv.{offer.offeredCreature?.level || 1} · {offer.offeredCreature?.rarity}</div>
                </div>
                <div className="text-slate-500 text-xl">⇄</div>
                <div className={`flex-1 rounded-lg p-2 border ${RARITY_COLORS[offer.requestedCreature?.rarity || 'common']}`}>
                    <div className="text-xs text-slate-400 mb-1">Richiesta</div>
                    <div className="text-sm font-bold text-white">{offer.requestedCreature?.name || '?'}</div>
                    <div className="text-xs text-slate-400">Lv.{offer.requestedCreature?.level || 1} · {offer.requestedCreature?.rarity}</div>
                </div>
            </div>
            {isReceived && offer.status === 'pending' && (
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={() => onAccept(offer.id)}
                        disabled={isPending}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold py-2 rounded-lg disabled:opacity-50 transition-colors"
                    >
                        Accetta
                    </button>
                    <button
                        onClick={() => onReject(offer.id)}
                        disabled={isPending}
                        className="flex-1 bg-red-600/80 hover:bg-red-700 text-white text-sm font-bold py-2 rounded-lg disabled:opacity-50 transition-colors"
                    >
                        Rifiuta
                    </button>
                </div>
            )}
        </div>
    );
}

type ModalStep = 'select_mine' | 'select_gdo' | 'select_theirs' | 'confirm';

export default function TradingClient({ userId, myCreatures, offers, gdoUsers }: {
    userId: string;
    myCreatures: Creature[];
    offers: Offer[];
    gdoUsers: GdoUser[];
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [tab, setTab] = useState<Tab>('tradable');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [modalStep, setModalStep] = useState<ModalStep>('select_mine');
    const [selectedMyCreature, setSelectedMyCreature] = useState<Creature | null>(null);
    const [selectedGdo, setSelectedGdo] = useState<GdoUser | null>(null);
    const [theirCreatures, setTheirCreatures] = useState<Creature[]>([]);
    const [selectedTheirCreature, setSelectedTheirCreature] = useState<Creature | null>(null);
    const [loadingTheirs, setLoadingTheirs] = useState(false);

    const tradableCreatures = myCreatures.filter(c => !c.isEquipped && c.rarity !== 'legendary');
    const receivedOffers = offers.filter(o => o.toUserId === userId);
    const sentOffers = offers.filter(o => o.fromUserId === userId);

    const pendingReceived = receivedOffers.filter(o => o.status === 'pending').length;

    function openModal() {
        setShowModal(true);
        setModalStep('select_mine');
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
        } catch { /* ignore */ }
        setLoadingTheirs(false);
        setModalStep('select_theirs');
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
            await createTradeOffer(userId, selectedGdo.id, selectedMyCreature.userCreatureId, selectedTheirCreature.userCreatureId);
            setShowModal(false);
            router.refresh();
        });
    }

    return (
        <SafeWrapper>
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Scambi Creature</h1>
                        <p className="text-sm text-slate-500">Scambia creature con gli altri GDO</p>
                    </div>
                    <button
                        onClick={openModal}
                        className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-amber-500/20"
                    >
                        + Proponi Scambio
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6">
                    {([
                        { key: 'tradable' as Tab, label: 'Scambiabili', count: tradableCreatures.length },
                        { key: 'received' as Tab, label: 'Offerte Ricevute', count: pendingReceived },
                        { key: 'sent' as Tab, label: 'Offerte Inviate', count: sentOffers.length },
                    ]).map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                                tab === t.key
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {t.label} {t.count > 0 && <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{t.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {tab === 'tradable' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {tradableCreatures.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-slate-400">
                                Nessuna creatura scambiabile. Le creature equipaggiate e leggendarie non possono essere scambiate.
                            </div>
                        ) : (
                            tradableCreatures.map(c => (
                                <CreatureCard key={c.userCreatureId} c={c} />
                            ))
                        )}
                    </div>
                )}

                {tab === 'received' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {receivedOffers.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-slate-400">
                                Nessuna offerta ricevuta.
                            </div>
                        ) : (
                            receivedOffers.map(o => (
                                <OfferCard key={o.id} offer={o} userId={userId} onAccept={handleAccept} onReject={handleReject} isPending={isPending} />
                            ))
                        )}
                    </div>
                )}

                {tab === 'sent' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {sentOffers.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-slate-400">
                                Nessuna offerta inviata.
                            </div>
                        ) : (
                            sentOffers.map(o => (
                                <OfferCard key={o.id} offer={o} userId={userId} onAccept={handleAccept} onReject={handleReject} isPending={isPending} />
                            ))
                        )}
                    </div>
                )}

                {/* Trade Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-slate-700">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-bold text-white">Proponi Scambio</h2>
                                    <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                                </div>
                                <div className="flex gap-2 mt-3">
                                    {(['select_mine', 'select_gdo', 'select_theirs', 'confirm'] as ModalStep[]).map((step, i) => (
                                        <div key={step} className={`flex-1 h-1.5 rounded-full ${
                                            i <= ['select_mine', 'select_gdo', 'select_theirs', 'confirm'].indexOf(modalStep)
                                                ? 'bg-amber-500'
                                                : 'bg-slate-700'
                                        }`} />
                                    ))}
                                </div>
                            </div>

                            <div className="p-5 overflow-y-auto max-h-[60vh]">
                                {modalStep === 'select_mine' && (
                                    <div>
                                        <div className="text-sm text-slate-400 mb-3">Seleziona la tua creatura da offrire:</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {tradableCreatures.map(c => (
                                                <CreatureCard
                                                    key={c.userCreatureId}
                                                    c={c}
                                                    selected={selectedMyCreature?.userCreatureId === c.userCreatureId}
                                                    onClick={() => {
                                                        setSelectedMyCreature(c);
                                                        setModalStep('select_gdo');
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        {tradableCreatures.length === 0 && (
                                            <div className="text-center py-8 text-slate-500">Nessuna creatura scambiabile.</div>
                                        )}
                                    </div>
                                )}

                                {modalStep === 'select_gdo' && (
                                    <div>
                                        <div className="text-sm text-slate-400 mb-3">Seleziona il GDO con cui scambiare:</div>
                                        <div className="space-y-2">
                                            {gdoUsers.map(gdo => (
                                                <div
                                                    key={gdo.id}
                                                    onClick={() => selectGdo(gdo)}
                                                    className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-lg p-3 cursor-pointer hover:border-amber-500 transition-colors"
                                                >
                                                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold">
                                                        {(gdo.displayName || gdo.name || '?')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-bold text-white">{gdo.displayName || gdo.name}</div>
                                                        {gdo.gdoCode && <div className="text-xs text-slate-400">GDO #{gdo.gdoCode}</div>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <button onClick={() => setModalStep('select_mine')} className="mt-4 text-sm text-slate-400 hover:text-white">← Indietro</button>
                                    </div>
                                )}

                                {modalStep === 'select_theirs' && (
                                    <div>
                                        <div className="text-sm text-slate-400 mb-3">
                                            Seleziona la creatura di {selectedGdo?.displayName || selectedGdo?.name} che desideri:
                                        </div>
                                        {loadingTheirs ? (
                                            <div className="text-center py-8 text-slate-500">Caricamento...</div>
                                        ) : theirCreatures.length === 0 ? (
                                            <div className="text-center py-8 text-slate-500">Questo GDO non ha creature scambiabili.</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                {theirCreatures.map(c => (
                                                    <CreatureCard
                                                        key={c.userCreatureId}
                                                        c={c}
                                                        selected={selectedTheirCreature?.userCreatureId === c.userCreatureId}
                                                        onClick={() => {
                                                            setSelectedTheirCreature(c);
                                                            setModalStep('confirm');
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        <button onClick={() => setModalStep('select_gdo')} className="mt-4 text-sm text-slate-400 hover:text-white">← Indietro</button>
                                    </div>
                                )}

                                {modalStep === 'confirm' && (
                                    <div>
                                        <div className="text-sm text-slate-400 mb-4">Conferma lo scambio:</div>
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="flex-1">
                                                <div className="text-xs text-slate-500 mb-1">Tu offri</div>
                                                {selectedMyCreature && <CreatureCard c={selectedMyCreature} />}
                                            </div>
                                            <div className="text-2xl text-amber-400">⇄</div>
                                            <div className="flex-1">
                                                <div className="text-xs text-slate-500 mb-1">Ricevi da {selectedGdo?.displayName || selectedGdo?.name}</div>
                                                {selectedTheirCreature && <CreatureCard c={selectedTheirCreature} />}
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleConfirmTrade}
                                            disabled={isPending}
                                            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl disabled:opacity-50 transition-colors"
                                        >
                                            {isPending ? 'Invio...' : 'Invia Proposta di Scambio'}
                                        </button>
                                        <button onClick={() => setModalStep('select_theirs')} className="mt-3 text-sm text-slate-400 hover:text-white block mx-auto">← Indietro</button>
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
