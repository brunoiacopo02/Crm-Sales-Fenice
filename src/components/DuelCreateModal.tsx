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

function DuelCreateModalInner({ gdoUsers, creatorRole }: {
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
            const result = await createDuel(challenger, opponent, metric, duration, reward, creatorRole);
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
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors shadow-lg shadow-amber-500/20"
            >
                ⚔️ Crea Duello
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setIsOpen(false)}>
                    <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">⚔️ Crea Duello 1v1</h2>
                            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div>
                                <label className="text-sm text-slate-400 mb-1 block">Sfidante</label>
                                <select
                                    value={challenger}
                                    onChange={e => setChallenger(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg p-2.5 text-sm"
                                >
                                    <option value="">Seleziona GDO...</option>
                                    {gdoUsers.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.displayName || u.name} {u.gdoCode ? `(#${u.gdoCode})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-sm text-slate-400 mb-1 block">Avversario</label>
                                <select
                                    value={opponent}
                                    onChange={e => setOpponent(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg p-2.5 text-sm"
                                >
                                    <option value="">Seleziona GDO...</option>
                                    {gdoUsers.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.displayName || u.name} {u.gdoCode ? `(#${u.gdoCode})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-sm text-slate-400 mb-1 block">Metrica</label>
                                <div className="flex gap-2">
                                    {METRICS.map(m => (
                                        <button
                                            key={m.value}
                                            onClick={() => setMetric(m.value)}
                                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                                                metric === m.value
                                                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                                                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                                            }`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-sm text-slate-400 mb-1 block">Durata</label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {DURATIONS.map(d => (
                                        <button
                                            key={d.value}
                                            onClick={() => setDuration(d.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                                duration === d.value
                                                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                                                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                                            }`}
                                        >
                                            {d.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-sm text-slate-400 mb-1 block">Reward (Fenice Coins)</label>
                                <input
                                    type="number"
                                    value={reward}
                                    onChange={e => setReward(Number(e.target.value))}
                                    min={10}
                                    max={1000}
                                    className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg p-2.5 text-sm"
                                />
                            </div>

                            {error && <div className="text-red-400 text-sm">{error}</div>}

                            <button
                                onClick={handleCreate}
                                disabled={isPending}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl disabled:opacity-50 transition-colors"
                            >
                                {isPending ? 'Creazione...' : 'Lancia Duello!'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export function DuelCreateModal({ gdoUsers, creatorRole }: {
    gdoUsers: GdoUser[];
    creatorRole: string;
}) {
    return (
        <SafeWrapper>
            <DuelCreateModalInner gdoUsers={gdoUsers} creatorRole={creatorRole} />
        </SafeWrapper>
    );
}
