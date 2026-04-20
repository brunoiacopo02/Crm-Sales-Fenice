"use client";

import { useEffect, useState, useCallback } from "react";
import { Swords, Clock, Coins, Trophy, Users as UsersIcon, RefreshCw } from "lucide-react";
import { SafeWrapper } from "./SafeWrapper";
import { getAllActiveDuelsForMonitor } from "@/app/actions/duelActions";
import { createClient } from "@/utils/supabase/client";

interface DuelRow {
    id: string;
    metric: string;
    duration: number;
    startTime: Date | string;
    endTime: Date | string;
    challenger: { id: string; name: string; gdoCode: number | null; score: number };
    opponent: { id: string; name: string; gdoCode: number | null; score: number };
    rewardCoins: number;
    pot: number;
}

function formatCountdown(endTime: Date | string): string {
    const diff = new Date(endTime).getTime() - Date.now();
    if (diff <= 0) return "Scaduto";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function formatMetric(metric: string): string {
    if (metric === 'fissaggi') return 'Appuntamenti fissati';
    if (metric === 'chiamate') return 'Chiamate';
    return metric;
}

function TeamDuelsMonitorInner() {
    const [duels, setDuels] = useState<DuelRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const fetchDuels = useCallback(async () => {
        try {
            const data = await getAllActiveDuelsForMonitor();
            setDuels(data as unknown as DuelRow[]);
        } catch {
            /* ignore */
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial + polling every 5s
    useEffect(() => {
        fetchDuels();
        const interval = setInterval(fetchDuels, 5000);
        return () => clearInterval(interval);
    }, [fetchDuels]);

    // Countdown ticker
    useEffect(() => {
        const t = setInterval(() => setTick((x) => x + 1), 1000);
        return () => clearInterval(t);
    }, []);
    void tick;

    // Realtime: quando la tabella duels cambia (score updates, nuovi duelli,
    // completamento) refetch immediato.
    useEffect(() => {
        const supabase = createClient();
        const ch = supabase.channel('duels_monitor')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'duels' }, () => {
                fetchDuels();
            })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [fetchDuels]);

    if (loading) {
        return (
            <div className="rounded-xl border border-ash-200 bg-white p-4 shadow-sm">
                <div className="text-sm text-ash-500">Caricamento duelli…</div>
            </div>
        );
    }

    if (duels.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-ash-300 bg-ash-50/40 p-4 text-center">
                <Swords className="mx-auto mb-2 h-6 w-6 text-ash-400" />
                <p className="text-sm text-ash-500">Nessun duello attivo in questo momento.</p>
            </div>
        );
    }

    return (
        <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    <Swords className="h-4 w-4" /> Duelli attivi nel team ({duels.length})
                </h2>
                <button onClick={fetchDuels} className="flex items-center gap-1 rounded-md border border-ash-200 bg-white px-2 py-1 text-[11px] text-ash-600 hover:bg-ash-50" title="Ricarica">
                    <RefreshCw className="h-3 w-3" />
                </button>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {duels.map((d) => {
                    const leader: 'c' | 'o' | 'tie' =
                        d.challenger.score > d.opponent.score ? 'c'
                        : d.opponent.score > d.challenger.score ? 'o'
                        : 'tie';
                    return (
                        <div key={d.id} className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                            {/* Header */}
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                                    {formatMetric(d.metric)}
                                </span>
                                <span className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                    <Clock className="h-3 w-3" /> {formatCountdown(d.endTime)}
                                </span>
                            </div>

                            {/* Versus box */}
                            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                <ParticipantBox
                                    name={d.challenger.name}
                                    gdoCode={d.challenger.gdoCode}
                                    score={d.challenger.score}
                                    isLeader={leader === 'c'}
                                    isLoser={leader === 'o'}
                                />
                                <div className="flex items-center text-xs font-black text-ash-400">VS</div>
                                <ParticipantBox
                                    name={d.opponent.name}
                                    gdoCode={d.opponent.gdoCode}
                                    score={d.opponent.score}
                                    isLeader={leader === 'o'}
                                    isLoser={leader === 'c'}
                                />
                            </div>

                            {/* Footer */}
                            <div className="mt-3 flex items-center justify-between text-[11px] text-ash-500">
                                <span className="inline-flex items-center gap-1">
                                    <UsersIcon className="h-3 w-3" /> Durata {d.duration} min
                                </span>
                                <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                                    <Coins className="h-3 w-3" /> {d.rewardCoins} × 2 = {d.pot} in palio
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function ParticipantBox({ name, gdoCode, score, isLeader, isLoser }: {
    name: string; gdoCode: number | null; score: number; isLeader: boolean; isLoser: boolean;
}) {
    return (
        <div className={`rounded-lg border px-2 py-1.5 text-center ${isLeader ? 'border-emerald-300 bg-emerald-50' : isLoser ? 'border-rose-200 bg-rose-50/50' : 'border-ash-200 bg-ash-50/50'}`}>
            <div className="flex items-center justify-center gap-1">
                {gdoCode != null && (
                    <span className="rounded bg-ash-200 px-1 py-0.5 text-[9px] font-bold font-mono text-ash-700">{gdoCode}</span>
                )}
                <span className="truncate text-[11px] font-semibold text-ash-700" title={name}>{name}</span>
                {isLeader && <Trophy className="h-3 w-3 text-emerald-600" />}
            </div>
            <div className={`mt-0.5 text-xl font-black ${isLeader ? 'text-emerald-700' : isLoser ? 'text-rose-600' : 'text-ash-800'}`}>
                {score}
            </div>
        </div>
    );
}

export function TeamDuelsMonitor() {
    return <SafeWrapper><TeamDuelsMonitorInner /></SafeWrapper>;
}
