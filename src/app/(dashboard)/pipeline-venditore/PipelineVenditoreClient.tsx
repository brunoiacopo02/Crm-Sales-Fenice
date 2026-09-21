"use client";

import { useState, useTransition } from "react";
import { Power, PhoneCall, Loader2, RefreshCw, Users } from "lucide-react";
import {
    getSalesPipelineOverview,
    assignBotReturnsToSalesPipeline,
    type SalesPipelineOverviewLead,
} from "@/app/actions/salesPipelineActions";
import { setSalesPipelineConfig } from "@/app/actions/salesPipelineConfigActions";
import type { SalesPipelineConfig } from "@/lib/salesPipeline/config";
import { SELF_BOOKED_OUTCOME } from "@/lib/salesPipeline/sentinel";

interface Venditore {
    id: string;
    name: string;
}

interface Overview {
    config: SalesPipelineConfig;
    divertedFresh: number;
    botReturns: number;
    leads: SalesPipelineOverviewLead[];
}

interface Props {
    initialOverview: Overview;
    venditori: Venditore[];
}

/** Nome leggibile del venditore configurato, o niente se non è nella lista. */
function nomeVenditore(id: string | null, venditori: Venditore[]): string {
    if (!id) return "";
    return venditori.find(v => v.id === id)?.name || id;
}

export default function PipelineVenditoreClient({ initialOverview, venditori }: Props) {
    const [overview, setOverview] = useState<Overview>(initialOverview);
    const [draftUserId, setDraftUserId] = useState<string>(initialOverview.config.salesUserId || "");
    const [draftCap, setDraftCap] = useState<number>(initialOverview.config.freshCap);
    const [configMsg, setConfigMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [savingToggle, setSavingToggle] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    const [assignCount, setAssignCount] = useState<number>(5);
    const [assignMsg, setAssignMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    const cfg = overview.config;
    /** La bozza dice una cosa diversa da quello che c'e' salvato. */
    const bozzaNonSalvata = draftUserId !== (cfg.salesUserId || "") || draftCap !== cfg.freshCap;

    const refresh = async () => {
        const fresh = await getSalesPipelineOverview();
        setOverview(fresh);
        setDraftUserId(fresh.config.salesUserId || "");
        setDraftCap(fresh.config.freshCap);
    };

    const handleToggle = async () => {
        setConfigMsg(null);
        setSavingToggle(true);
        // L'interruttore accende e spegne QUELLO CHE E' SALVATO, non la bozza.
        // Con i valori di bozza bastava cambiare venditore nel selettore senza
        // salvare, spegnere e riaccendere, e la pipeline ripartiva su un
        // venditore che nessuno aveva mai confermato.
        const next: SalesPipelineConfig = {
            enabled: !cfg.enabled,
            salesUserId: cfg.salesUserId,
            freshCap: cfg.freshCap,
        };
        const res = await setSalesPipelineConfig(next);
        setSavingToggle(false);
        if (!res.success || !res.config) {
            setConfigMsg({ type: "err", text: res.error || "Errore nel salvataggio." });
            return;
        }
        setOverview(o => ({ ...o, config: res.config! }));
        setConfigMsg({
            type: "ok",
            text: res.config.enabled ? "Pipeline accesa." : "Pipeline spenta.",
        });
    };

    const handleSaveSettings = async () => {
        setConfigMsg(null);
        setSavingSettings(true);
        const next: SalesPipelineConfig = {
            enabled: cfg.enabled,
            salesUserId: draftUserId || null,
            freshCap: Number.isFinite(draftCap) && draftCap >= 0 ? Math.floor(draftCap) : 0,
        };
        const res = await setSalesPipelineConfig(next);
        setSavingSettings(false);
        if (!res.success || !res.config) {
            setConfigMsg({ type: "err", text: res.error || "Errore nel salvataggio." });
            return;
        }
        setOverview(o => ({ ...o, config: res.config! }));
        setDraftUserId(res.config.salesUserId || "");
        setDraftCap(res.config.freshCap);
        setConfigMsg({ type: "ok", text: "Impostazioni salvate." });
    };

    const handleAssign = () => {
        setAssignMsg(null);
        startTransition(async () => {
            const res = await assignBotReturnsToSalesPipeline(assignCount);
            if (!res.success) {
                setAssignMsg({ type: "err", text: res.error || "Errore nell'assegnazione." });
                return;
            }
            const moved = res.moved ?? 0;
            await refresh();
            if (moved < assignCount) {
                setAssignMsg({
                    type: "err",
                    text: `Spostati solo ${moved} lead su ${assignCount} richiesti: non ce n'erano abbastanza che soddisfacessero tutte le guardie.`,
                });
            } else {
                setAssignMsg({ type: "ok", text: `Spostati ${moved} lead nella pipeline.` });
            }
        });
    };

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <PhoneCall className="h-6 w-6 text-brand-orange" /> Pipeline autonoma venditore
                </h1>
                <p className="text-sm text-ash-500">
                    Un venditore che chiama lead a freddo e si fissa gli appuntamenti da solo,
                    fuori dal giro di GDO e Conferme.
                </p>
            </header>

            {/* Interruttore acceso/spento */}
            <section className={`rounded-2xl border p-4 shadow-sm ${cfg.enabled ? "border-emerald-200 bg-emerald-50" : "border-ash-200 bg-white"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-bold text-ash-900">
                            {cfg.enabled
                                ? `Pipeline accesa: in corso su ${nomeVenditore(cfg.salesUserId, venditori) || "—"}`
                                : "Pipeline spenta: i lead seguono il giro di sempre"}
                        </div>
                        <p className="mt-0.5 text-xs text-ash-500">
                            Spegnere qui è il modo più veloce per fermare tutto: nessun deploy, nessuna env.
                        </p>
                        {bozzaNonSalvata && (
                            <p className="mt-0.5 text-xs font-semibold text-amber-700">
                                Hai modifiche non salvate qui sotto: l&apos;interruttore usa le impostazioni salvate.
                            </p>
                        )}
                    </div>
                    <div>
                        <button
                            onClick={handleToggle}
                            disabled={savingToggle}
                            className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors disabled:opacity-50 ${cfg.enabled ? "bg-emerald-500" : "bg-ash-300"}`}
                        >
                            <span className={`inline-block h-7 w-7 transform rounded-full bg-white shadow transition-transform ${cfg.enabled ? "translate-x-8" : "translate-x-0.5"}`} />
                            {savingToggle && <Loader2 className="absolute -right-7 h-4 w-4 animate-spin text-ash-400" />}
                        </button>
                    </div>
                </div>
            </section>

            {configMsg && (
                <div className={`rounded-xl border px-4 py-2 text-sm ${configMsg.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                    {configMsg.text}
                </div>
            )}

            {/* Selettore venditore + tetto freschi */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-ash-900">Impostazioni</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-ash-600">Venditore</label>
                        <select
                            value={draftUserId}
                            onChange={(e) => setDraftUserId(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm"
                        >
                            <option value="">Nessuno scelto</option>
                            {venditori.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-ash-600">Tetto freschi</label>
                        <input
                            type="number"
                            min={0}
                            value={draftCap}
                            onChange={(e) => setDraftCap(Number(e.target.value))}
                            className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm"
                        />
                    </div>
                </div>
                <div className="mt-4">
                    <button
                        onClick={handleSaveSettings}
                        disabled={savingSettings}
                        className="flex items-center gap-1.5 rounded-lg border border-brand-orange/30 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-brand-orange hover:bg-orange-100 disabled:opacity-50"
                    >
                        {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        Salva impostazioni
                    </button>
                </div>
            </section>

            {/* Contatori */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-ash-500">Freschi dirottati</div>
                    <div className="mt-1 text-2xl font-black text-ash-900">
                        {overview.divertedFresh} <span className="text-sm font-bold text-ash-400">/ {cfg.freshCap}</span>
                    </div>
                </div>
                <div className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-ash-500">Ridati assegnati</div>
                    <div className="mt-1 text-2xl font-black text-ash-900">{overview.botReturns}</div>
                </div>
            </section>

            {/* Assegna ridati dal GDO più carico */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-ash-900">Assegna ridati dal GDO più carico</h2>
                <p className="mt-0.5 text-xs text-ash-500">
                    Prende i lead ridati dal bot dal GDO con più lead nuovi da chiamare, e li sposta al venditore.
                    Se non ce ne sono abbastanza che soddisfino tutte le guardie, ne sposta meno di quanti richiesti.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={assignCount}
                        onChange={(e) => setAssignCount(Number(e.target.value))}
                        className="w-24 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm"
                    />
                    <div>
                        <button
                            onClick={handleAssign}
                            disabled={isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-brand-orange/30 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-brand-orange hover:bg-orange-100 disabled:opacity-50"
                        >
                            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                            Assegna {assignCount} ridati dal GDO più carico
                        </button>
                    </div>
                    <div>
                        <button
                            onClick={() => refresh()}
                            className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2 py-1.5 text-xs font-medium text-ash-600 hover:bg-ash-50"
                            title="Ricarica"
                        >
                            <RefreshCw className="h-3 w-3" />
                        </button>
                    </div>
                </div>
                {assignMsg && (
                    <div className={`mt-3 rounded-xl border px-4 py-2 text-sm ${assignMsg.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                        {assignMsg.text}
                    </div>
                )}
            </section>

            {/* Tabella dei lead in pipeline */}
            <section className="rounded-2xl border border-ash-200 bg-white shadow-sm">
                <div className="border-b border-ash-100 px-4 py-3">
                    <h2 className="text-sm font-bold text-ash-900">Lead in pipeline ({overview.leads.length})</h2>
                </div>
                {overview.leads.length === 0 ? (
                    <div className="p-6 text-center text-sm text-ash-400">Nessun lead in pipeline.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-xs">
                            <thead className="text-ash-500">
                                <tr>
                                    <th className="px-4 py-2 font-semibold">Nome</th>
                                    <th className="px-4 py-2 font-semibold">Telefono</th>
                                    <th className="px-4 py-2 font-semibold">Tentativi</th>
                                    <th className="px-4 py-2 font-semibold">Stato</th>
                                    <th className="px-4 py-2 font-semibold">Appuntamento</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ash-100">
                                {overview.leads.map(l => (
                                    <tr key={l.id}>
                                        <td className="px-4 py-2 font-medium text-ash-900">{l.name}</td>
                                        <td className="px-4 py-2 font-mono text-ash-700">{l.phone}</td>
                                        <td className="px-4 py-2 text-ash-700">{l.callCount}</td>
                                        <td className="px-4 py-2 text-ash-700">{l.status}</td>
                                        <td className="px-4 py-2">
                                            {l.confirmationsOutcome === SELF_BOOKED_OUTCOME && l.appointmentDate ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                                                    Autofissato · {new Date(l.appointmentDate).toLocaleString("it-IT")}
                                                </span>
                                            ) : (
                                                <span className="text-ash-400">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
