"use client";

import { useMemo, useState, useTransition } from "react";
import { BarChart3, Download, Filter, Trophy, AlertTriangle, Ban, CheckCircle2 } from "lucide-react";
import {
    getGdoAggregate,
    getConfermeAggregate,
    getSalesAggregate,
    exportCsvResoconto,
    type QualitaLeadFilters,
    type GdoAggregate,
    type ConfermeAggregate,
    type SalesAggregate,
} from "./actions";
import { invalidateGdoSurvey, invalidateConfermeSurvey } from "@/app/actions/surveyActions";

interface SuspiciousData {
    gdo: Array<{ id: string; leadId: string; gdoUserId: string; userName: string | null; createdAt: Date; fillDurationMs: number | null; invalidatedAt: Date | null }>;
    conferme: Array<{ id: string; leadId: string; confermeUserId: string; userName: string | null; createdAt: Date; fillDurationMs: number | null; invalidatedAt: Date | null }>;
}

interface Props {
    funnels: string[];
    initialFilters: QualitaLeadFilters;
    initialGdo: GdoAggregate;
    initialConferme: ConfermeAggregate;
    initialSales: SalesAggregate;
    initialClosedWonGdo: GdoAggregate;
    initialSuspicious: SuspiciousData;
}

export default function QualitaLeadClient({
    funnels, initialFilters, initialGdo, initialConferme, initialSales, initialClosedWonGdo, initialSuspicious,
}: Props) {
    const [filters, setFilters] = useState<QualitaLeadFilters>(initialFilters);
    const [gdo, setGdo] = useState(initialGdo);
    const [conferme, setConferme] = useState(initialConferme);
    const [sales, setSales] = useState(initialSales);
    const [closedWonGdo, setClosedWonGdo] = useState(initialClosedWonGdo);
    const [suspicious, setSuspicious] = useState(initialSuspicious);
    const [isPending, startTransition] = useTransition();
    const [tab, setTab] = useState<"overview" | "profile" | "suspicious">("overview");

    const refresh = (next: QualitaLeadFilters) => {
        setFilters(next);
        startTransition(async () => {
            const [g, c, s, cw] = await Promise.all([
                getGdoAggregate(next),
                getConfermeAggregate(next),
                getSalesAggregate(next),
                getGdoAggregate({ ...next, onlyClosedWon: true }),
            ]);
            setGdo(g);
            setConferme(c);
            setSales(s);
            setClosedWonGdo(cw);
        });
    };

    const toggleFunnel = (f: string) => {
        const next = filters.funnels.includes(f) ? filters.funnels.filter((x) => x !== f) : [...filters.funnels, f];
        refresh({ ...filters, funnels: next });
    };

    const handleExport = async () => {
        const csv = await exportCsvResoconto(filters);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ts = new Date().toISOString().slice(0, 10);
        a.download = `qualita-lead_${ts}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleInvalidate = async (kind: "gdo" | "conferme", id: string) => {
        const ok = confirm("Invalidare questo sondaggio? Verranno rimossi i coins al GDO/Conferme.");
        if (!ok) return;
        const res = kind === "gdo" ? await invalidateGdoSurvey(id) : await invalidateConfermeSurvey(id);
        if (!res.success) {
            alert(res.error || "Errore");
            return;
        }
        setSuspicious((prev) => ({
            ...prev,
            [kind]: prev[kind].map((r) => (r.id === id ? { ...r, invalidatedAt: new Date() } : r)),
        }));
    };

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                        <BarChart3 className="h-6 w-6 text-brand-orange" /> Qualità Lead
                    </h1>
                    <p className="text-sm text-ash-500">Analisi dei sondaggi raccolti da GDO, Conferme e Venditori.</p>
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 rounded-xl border border-ash-200 bg-white px-4 py-2 text-sm font-semibold text-ash-700 shadow-sm hover:bg-ash-50"
                >
                    <Download className="h-4 w-4" /> Esporta CSV resoconto
                </button>
            </header>

            {/* Filters */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ash-500">
                    <Filter className="h-3.5 w-3.5" /> Filtri
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-ash-600">Dal</label>
                        <input
                            type="date"
                            value={filters.startDate ?? ""}
                            onChange={(e) => refresh({ ...filters, startDate: e.target.value || null })}
                            className="w-full rounded-lg border border-ash-200 px-3 py-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-ash-600">Al</label>
                        <input
                            type="date"
                            value={filters.endDate ?? ""}
                            onChange={(e) => refresh({ ...filters, endDate: e.target.value || null })}
                            className="w-full rounded-lg border border-ash-200 px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-semibold text-ash-600">Funnel ({filters.funnels.length === 0 ? "tutti" : filters.funnels.length})</label>
                        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                            {funnels.map((f) => {
                                const on = filters.funnels.includes(f);
                                return (
                                    <button
                                        key={f}
                                        type="button"
                                        onClick={() => toggleFunnel(f)}
                                        className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white" : "border-ash-200 bg-white text-ash-600 hover:border-brand-orange/60"}`}
                                    >
                                        {f}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                {isPending && <div className="mt-3 text-xs text-ash-500">Aggiornamento in corso…</div>}
            </section>

            {/* Tabs */}
            <nav className="flex gap-2 border-b border-ash-200">
                <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Panoramica per ruolo</TabBtn>
                <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}><Trophy className="mr-1 inline h-3.5 w-3.5" /> Profilo chiusi</TabBtn>
                <TabBtn active={tab === "suspicious"} onClick={() => setTab("suspicious")}>
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Survey sospette ({suspicious.gdo.filter((x) => !x.invalidatedAt).length + suspicious.conferme.filter((x) => !x.invalidatedAt).length})
                </TabBtn>
            </nav>

            {tab === "overview" && (
                <div className="space-y-6">
                    <KpiCards
                        gdoTotal={gdo.totalSurveys}
                        gdoCompleted={gdo.completedSurveys}
                        confermeTotal={conferme.totalSurveys}
                        salesTotal={sales.totalSurveys}
                        avgFillMs={gdo.avgFillDurationMs}
                    />

                    <SectionRole title="GDO — Profilo demografico/comportamentale" color="orange">
                        <BarQ label="Età" items={gdo.ageRange} />
                        <BarQ label="Stato occupazionale" items={gdo.occupation} />
                        <BarQ label="Motivo richiesta (multi)" items={gdo.requestReason} />
                        <BarQ label="Cosa si aspettava (multi)" items={gdo.expectation} />
                        <BarQ label="Problema principale" items={gdo.mainProblem} />
                        <BarQ label="Conoscenza digitale" items={gdo.digitalKnow} />
                        <BarQ label="Cambiamento entro" items={gdo.changeWithin} />
                        <BarQ label="Cerca cambiamento da" items={gdo.changeSince} />
                    </SectionRole>

                    <SectionRole title="Conferme — Qualità fissaggio" color="indigo">
                        <YesNoPair label="Si ricorda appuntamento" yes={conferme.remembersApptYes} no={conferme.remembersApptNo} />
                        <YesNoPair label="Ha visto il video" yes={conferme.watchedVideoYes} no={conferme.watchedVideoNo} />
                        <YesNoPair label="Confermato" yes={conferme.confirmedYes} no={conferme.confirmedNo} />
                        <BarQ label="Perché no" items={conferme.whyNot} />
                    </SectionRole>

                    <SectionRole title="Venditori — Lead non chiusi" color="rose">
                        <BarQ label="Segnali di problema (multi)" items={sales.problemSignals} />
                        <BarQ label="Segnali di urgenza (multi)" items={sales.urgencySignals} />
                        <BarQ label="Reazione al prezzo" items={sales.priceReaction} />
                    </SectionRole>
                </div>
            )}

            {tab === "profile" && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <div className="font-bold">Chi chiude?</div>
                        <div>Breakdown delle risposte GDO dei lead che hanno chiuso (salespersonOutcome = &quot;Chiuso&quot;).</div>
                    </div>
                    <SectionRole title="Profilo demografico dei chiusi" color="emerald">
                        <BarQ label="Età" items={closedWonGdo.ageRange} />
                        <BarQ label="Stato occupazionale" items={closedWonGdo.occupation} />
                        <BarQ label="Motivo richiesta (multi)" items={closedWonGdo.requestReason} />
                        <BarQ label="Cosa si aspettava (multi)" items={closedWonGdo.expectation} />
                        <BarQ label="Problema principale" items={closedWonGdo.mainProblem} />
                        <BarQ label="Conoscenza digitale" items={closedWonGdo.digitalKnow} />
                        <BarQ label="Cambiamento entro" items={closedWonGdo.changeWithin} />
                        <BarQ label="Cerca cambiamento da" items={closedWonGdo.changeSince} />
                    </SectionRole>
                    <div className="text-xs text-ash-500">
                        Totale chiusi analizzati: <strong>{closedWonGdo.totalSurveys}</strong>
                    </div>
                </div>
            )}

            {tab === "suspicious" && (
                <div className="space-y-6">
                    <SuspiciousTable
                        title="Sondaggi GDO sospetti"
                        rows={suspicious.gdo}
                        userKey="gdoUserId"
                        onInvalidate={(id) => handleInvalidate("gdo", id)}
                    />
                    <SuspiciousTable
                        title="Sondaggi Conferme sospetti"
                        rows={suspicious.conferme}
                        userKey="confermeUserId"
                        onInvalidate={(id) => handleInvalidate("conferme", id)}
                    />
                </div>
            )}
        </div>
    );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${active ? "border-brand-orange text-brand-orange" : "border-transparent text-ash-500 hover:text-ash-700"}`}
        >
            {children}
        </button>
    );
}

function KpiCards({ gdoTotal, gdoCompleted, confermeTotal, salesTotal, avgFillMs }: {
    gdoTotal: number; gdoCompleted: number; confermeTotal: number; salesTotal: number; avgFillMs: number;
}) {
    const gdoPerc = gdoTotal > 0 ? Math.round((gdoCompleted / gdoTotal) * 100) : 0;
    const avgSec = avgFillMs > 0 ? Math.round(avgFillMs / 1000) : 0;
    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi title="Sondaggi GDO" value={gdoTotal} sub={`${gdoCompleted} completi (${gdoPerc}%)`} />
            <Kpi title="Sondaggi Conferme" value={confermeTotal} sub="sul totale esiti" />
            <Kpi title="Sondaggi Venditori" value={salesTotal} sub="su lead non chiusi" />
            <Kpi title="Tempo medio GDO" value={`${avgSec}s`} sub="di compilazione" />
        </div>
    );
}

function Kpi({ title, value, sub }: { title: string; value: string | number; sub: string }) {
    return (
        <div className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ash-500">{title}</div>
            <div className="mt-1 text-2xl font-bold text-ash-900">{value}</div>
            <div className="text-xs text-ash-500">{sub}</div>
        </div>
    );
}

function SectionRole({ title, color, children }: { title: string; color: "orange" | "indigo" | "rose" | "emerald"; children: React.ReactNode }) {
    const colorMap: Record<string, string> = {
        orange: "border-orange-200 bg-orange-50/50",
        indigo: "border-indigo-200 bg-indigo-50/50",
        rose: "border-rose-200 bg-rose-50/50",
        emerald: "border-emerald-200 bg-emerald-50/50",
    };
    return (
        <section className={`rounded-2xl border p-4 shadow-sm ${colorMap[color]}`}>
            <h2 className="mb-4 text-lg font-bold text-ash-900">{title}</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
        </section>
    );
}

function BarQ({ label, items }: { label: string; items: Array<{ option: string; count: number; percent: number }> }) {
    const maxCount = useMemo(() => items.reduce((m, i) => Math.max(m, i.count), 0), [items]);
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-3">
            <div className="mb-2 text-xs font-bold text-ash-700">{label}</div>
            {items.length === 0 ? (
                <div className="text-xs text-ash-400">Nessun dato</div>
            ) : (
                <div className="space-y-1.5">
                    {items.map((it) => (
                        <div key={it.option}>
                            <div className="flex items-center justify-between text-xs">
                                <span className="truncate font-medium text-ash-700">{it.option}</span>
                                <span className="tabular-nums text-ash-500">
                                    {it.count} · {it.percent}%
                                </span>
                            </div>
                            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-ash-100">
                                <div
                                    className="h-full rounded-full bg-brand-orange"
                                    style={{ width: `${maxCount > 0 ? (it.count / maxCount) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function YesNoPair({ label, yes, no }: { label: string; yes: number; no: number }) {
    const total = yes + no;
    const yesP = total > 0 ? Math.round((yes / total) * 100) : 0;
    const noP = total > 0 ? 100 - yesP : 0;
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-3">
            <div className="mb-2 text-xs font-bold text-ash-700">{label}</div>
            <div className="flex gap-2">
                <div className="flex-1 rounded-lg bg-emerald-50 px-3 py-2 text-center">
                    <div className="text-xs font-semibold text-emerald-600">Sì</div>
                    <div className="text-lg font-bold text-emerald-700">{yes} <span className="text-xs">({yesP}%)</span></div>
                </div>
                <div className="flex-1 rounded-lg bg-rose-50 px-3 py-2 text-center">
                    <div className="text-xs font-semibold text-rose-600">No</div>
                    <div className="text-lg font-bold text-rose-700">{no} <span className="text-xs">({noP}%)</span></div>
                </div>
            </div>
        </div>
    );
}

function SuspiciousTable({ title, rows, userKey, onInvalidate }: {
    title: string;
    rows: Array<{ id: string; leadId: string; userName: string | null; createdAt: Date; fillDurationMs: number | null; invalidatedAt: Date | null } & Record<string, unknown>>;
    userKey: string;
    onInvalidate: (id: string) => void;
}) {
    void userKey;
    return (
        <div className="overflow-hidden rounded-2xl border border-ash-200 bg-white shadow-sm">
            <div className="border-b border-ash-100 bg-amber-50/50 px-4 py-3 text-sm font-bold text-amber-900">{title}</div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-xs uppercase tracking-wider text-ash-500">
                        <tr>
                            <th className="px-3 py-2 text-left">Data</th>
                            <th className="px-3 py-2 text-left">Utente</th>
                            <th className="px-3 py-2 text-left">Lead</th>
                            <th className="px-3 py-2 text-left">Durata</th>
                            <th className="px-3 py-2 text-left">Stato</th>
                            <th className="px-3 py-2 text-right">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ash-100">
                        {rows.length === 0 && (
                            <tr><td colSpan={6} className="px-3 py-4 text-center text-ash-400">Nessun sondaggio sospetto</td></tr>
                        )}
                        {rows.map((r) => (
                            <tr key={r.id}>
                                <td className="px-3 py-2 text-xs tabular-nums text-ash-600">{new Date(r.createdAt).toLocaleString("it-IT")}</td>
                                <td className="px-3 py-2 font-medium">{r.userName || "?"}</td>
                                <td className="px-3 py-2 font-mono text-xs text-ash-500">{String(r.leadId).slice(0, 8)}…</td>
                                <td className="px-3 py-2 tabular-nums">{r.fillDurationMs != null ? `${Math.round((r.fillDurationMs as number) / 1000)}s` : "—"}</td>
                                <td className="px-3 py-2">
                                    {r.invalidatedAt ? (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                            <Ban className="h-3 w-3" /> Invalidata
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                            <AlertTriangle className="h-3 w-3" /> Sospetta
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {!r.invalidatedAt && (
                                        <button
                                            onClick={() => onInvalidate(r.id)}
                                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                        >
                                            <CheckCircle2 className="h-3 w-3" /> Invalida
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
