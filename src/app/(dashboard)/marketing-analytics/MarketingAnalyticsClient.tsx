"use client";

import { useState } from "react";
import { getMarketingStats, saveMarketingBudget, getMarketingStatsByGdo, getInboundSpontaneiStats } from "@/app/actions/marketingActions";
import { Loader2, TrendingUp, Save, Filter, Users, Send } from "lucide-react";

type Stat = {
    funnel: string;
    leads: number;
    leadAssegnati: number;
    apps: number;
    conferme: number;
    trattative: number;
    close: number;
    fatturato: number;
    appsPerc: number;
    confermePerc: number;
    trattativePerc: number;
    closePerc: number;
    fissaggioPerc: number;
    spentAmountEur: number;
    roas: number;
};

type GdoStatTableRow = {
    gdoName: string;
    leadAssegnati: number;
    fissaggioPerc: number;
    appsFissati: number;
    appsConfermati: number;
    confermePerc: number;
    appsPresenziati: number;
    presenziatiPerc: number;
    closed: number;
    closedPerc: number;
    fatturato: number;
}

type FunnelGdoStats = {
    funnel: string;
    gdoStats: GdoStatTableRow[]
};

/** Chi apre lui la chat: quanti scrivono e dove arrivano. */
type InboundRow = {
    scrivono: number;
    fissati: number;
    confermati: number;
    chiusi: number;
    fatturato: number;
    fissatiPerc: number | null;
    confermatiPerc: number | null;
    chiusiPerc: number | null;
};

type InboundStats = { telegram: InboundRow; altriCanali: InboundRow };

export default function MarketingAnalyticsClient({
    initialStats,
    initialStatsByGdo,
    initialInbound,
    initialMonth
}: {
    initialStats: Stat[],
    initialStatsByGdo: FunnelGdoStats[],
    initialInbound: InboundStats,
    initialMonth: string
}) {
    const [month, setMonth] = useState(initialMonth);
    const [stats, setStats] = useState<Stat[]>(initialStats);
    const [statsByGdo, setStatsByGdo] = useState<FunnelGdoStats[]>(initialStatsByGdo);
    const [inbound, setInbound] = useState<InboundStats>(initialInbound);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form states
    const [selectedFunnel, setSelectedFunnel] = useState("");
    const [spentAmount, setSpentAmount] = useState("");

    const fetchStats = async (m: string) => {
        setIsLoading(true);
        try {
            const [data, gdoData, inboundData] = await Promise.all([
                getMarketingStats(m),
                getMarketingStatsByGdo(m),
                getInboundSpontaneiStats(m)
            ]);
            setStats(data);
            setStatsByGdo(gdoData);
            setInbound(inboundData);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMonth = e.target.value;
        setMonth(newMonth);
        fetchStats(newMonth);
    };

    const handleSaveBudget = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFunnel || !spentAmount) return;

        setIsSaving(true);
        try {
            await saveMarketingBudget(selectedFunnel, month, parseFloat(spentAmount));
            // Refresh stats to show new budget and ROAS
            await fetchStats(month);
            setSpentAmount("");
        } catch (error) {
            console.error("Error saving budget", error);
        } finally {
            setIsSaving(false);
        }
    };

    const formatPercent = (val: number) => {
        if (isNaN(val) || !isFinite(val)) return "0.00%";
        return val.toFixed(2) + "%";
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
    };

    const uniqueFunnels = Array.from(new Set(stats.map(s => s.funnel)));

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-7xl mx-auto space-y-8 pb-16">

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-ash-900 flex items-center gap-2">
                            <TrendingUp className="h-8 w-8 text-brand-orange" />
                            Marketing Analytics
                        </h1>
                        <p className="text-ash-500 mt-1">
                            Monitora le performance e il ROAS per ogni campagna marketing.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-ash-200 shadow-sm">
                        <Filter className="w-5 h-5 text-ash-400 ml-2" />
                        <input
                            type="month"
                            value={month}
                            onChange={handleMonthChange}
                            className="bg-transparent border-none focus:ring-0 text-ash-700 font-medium cursor-pointer"
                        />
                    </div>
                </div>

                {/* Chi ci scrive per primo dal canale Telegram */}
                <div className="bg-white rounded-xl border border-ash-200 shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                        <h2 className="text-lg font-semibold text-ash-900 flex items-center gap-2">
                            <Send className="w-5 h-5 text-brand-orange" />
                            Scrivono da Telegram
                        </h2>
                        <p
                            className="text-xs text-ash-500 sm:text-right max-w-md"
                            title="Conta solo chi apre lui la conversazione su WhatsApp dopo aver cliccato il link del canale Telegram. Chi era già un nostro lead da un'inserzione e poi scrive dentro una chat già aperta non compare qui: il bot non lo segnala al CRM. Il lead conta nel mese in cui ha scritto."
                        >
                            Solo chi apre lui la chat dal link del canale. Conteggiati nel mese in cui hanno scritto.
                        </p>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center items-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-brand-orange" />
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                {[
                                    { etichetta: "Scrivono", valore: inbound.telegram.scrivono, perc: null, accento: true },
                                    { etichetta: "Fissati", valore: inbound.telegram.fissati, perc: inbound.telegram.fissatiPerc, accento: false },
                                    { etichetta: "Confermati", valore: inbound.telegram.confermati, perc: inbound.telegram.confermatiPerc, accento: false },
                                    { etichetta: "Chiusi", valore: inbound.telegram.chiusi, perc: inbound.telegram.chiusiPerc, accento: false },
                                ].map(c => (
                                    <div
                                        key={c.etichetta}
                                        className={`rounded-lg border p-4 ${c.accento ? "border-brand-orange/30 bg-orange-50/50" : "border-ash-200 bg-ash-50/50"}`}
                                    >
                                        <div className="text-xs font-medium text-ash-500 uppercase tracking-wide">{c.etichetta}</div>
                                        <div className="mt-1 flex items-baseline gap-2">
                                            <span className={`text-3xl font-bold tabular-nums ${c.accento ? "text-brand-orange" : "text-ash-900"}`}>
                                                {c.valore}
                                            </span>
                                            {c.perc !== null && (
                                                <span className="text-sm font-medium text-ash-500 tabular-nums">
                                                    {formatPercent(c.perc)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-ash-500">
                                <span>
                                    Altri canali, sempre di chi scrive per primo:{" "}
                                    <span className="font-medium text-ash-700 tabular-nums">{inbound.altriCanali.scrivono}</span> scrivono,{" "}
                                    <span className="font-medium text-ash-700 tabular-nums">{inbound.altriCanali.fissati}</span> fissati,{" "}
                                    <span className="font-medium text-ash-700 tabular-nums">{inbound.altriCanali.confermati}</span> confermati,{" "}
                                    <span className="font-medium text-ash-700 tabular-nums">{inbound.altriCanali.chiusi}</span> chiusi
                                </span>
                                {inbound.telegram.fatturato > 0 && (
                                    <span className="font-semibold text-ash-900">
                                        Fatturato da Telegram: {formatCurrency(inbound.telegram.fatturato)}
                                    </span>
                                )}
                            </div>

                            {inbound.telegram.scrivono === 0 && inbound.altriCanali.scrivono === 0 && (
                                <p className="mt-4 text-sm text-ash-500">
                                    Nessuno ha aperto una chat di sua iniziativa in questo mese.
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* Budget Form */}
                <div className="bg-white rounded-xl border border-ash-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-ash-900 mb-4">Gestione Budget mensile</h2>
                    <form onSubmit={handleSaveBudget} className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1 flex-1 min-w-[200px]">
                            <label className="text-sm font-medium text-ash-700">Funnel</label>
                            <select
                                value={selectedFunnel}
                                onChange={e => setSelectedFunnel(e.target.value)}
                                className="w-full h-10 px-3 py-2 bg-white border border-ash-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent"
                                required
                            >
                                <option value="">Seleziona funnel...</option>
                                {uniqueFunnels.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1 flex-1 min-w-[200px]">
                            <label className="text-sm font-medium text-ash-700">Spesa Effettuata (€)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Es. 1500"
                                value={spentAmount}
                                onChange={e => setSpentAmount(e.target.value)}
                                className="w-full h-10 px-3 py-2 bg-white border border-ash-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSaving || !selectedFunnel || !spentAmount}
                            className="h-10 px-4 py-2 bg-brand-orange hover:bg-orange-600 text-white rounded-md font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Salva Spesa
                        </button>
                    </form>
                </div>

                {/* GLOBALI Data Table */}
                <div className="bg-white rounded-xl border border-ash-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        {isLoading ? (
                            <div className="flex justify-center items-center p-12">
                                <Loader2 className="w-8 h-8 animate-spin text-brand-orange" />
                            </div>
                        ) : stats.length === 0 ? (
                            <div className="p-12 text-center text-ash-500">
                                Nessun dato disponibile per questo mese.
                            </div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-ash-50 text-ash-700 border-b border-ash-200">
                                    <tr>
                                        <th className="px-4 py-4 font-semibold">Funnel Globali</th>
                                        <th className="px-4 py-4 font-semibold text-right" title="Tutti i lead importati nel periodo, anche quelli mai assegnati a un GDO">Lead totali</th>
                                        <th className="px-4 py-4 font-semibold text-right" title="Lead effettivamente assegnati a un GDO per il follow-up">Presi in carico</th>
                                        <th className="px-4 py-4 font-semibold text-right" title="Appuntamenti fissati dal team">App fissati</th>
                                        <th className="px-4 py-4 font-semibold text-right text-orange-600" title="App fissati / Lead presi in carico — efficienza del team sui lead lavorati">% Fiss su presi</th>
                                        <th className="px-4 py-4 font-semibold text-right text-ash-500" title="App fissati / Lead totali — conversione globale (include lead non gestiti)">% Fiss su totali</th>
                                        <th className="px-4 py-4 font-semibold text-right">Conferme</th>
                                        <th className="px-4 py-4 font-semibold text-right text-ash-500">Conf %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Trattative</th>
                                        <th className="px-4 py-4 font-semibold text-right text-ash-500">Tratt %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Close</th>
                                        <th className="px-4 py-4 font-semibold text-right text-green-600">Close %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Fatturato</th>
                                        <th className="px-4 py-4 font-semibold text-right text-red-600">Spesa</th>
                                        <th className="px-4 py-4 font-semibold text-right text-brand-orange">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ash-200">
                                    {stats.map((row) => (
                                        <tr key={row.funnel} className="hover:bg-ash-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-ash-900">{row.funnel}</td>
                                            <td className="px-4 py-3 text-right">{row.leads}</td>
                                            <td className="px-4 py-3 text-right font-medium">{row.leadAssegnati}</td>
                                            <td className="px-4 py-3 text-right">{row.apps}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-orange-600 bg-orange-50/30">{formatPercent(row.fissaggioPerc)}</td>
                                            <td className="px-4 py-3 text-right text-ash-500 bg-ash-50/50">{formatPercent(row.appsPerc)}</td>
                                            <td className="px-4 py-3 text-right font-medium">{row.conferme}</td>
                                            <td className="px-4 py-3 text-right text-ash-500 bg-ash-50/50">{formatPercent(row.confermePerc)}</td>
                                            <td className="px-4 py-3 text-right">{row.trattative}</td>
                                            <td className="px-4 py-3 text-right text-ash-500 bg-ash-50/50">{formatPercent(row.trattativePerc)}</td>
                                            <td className="px-4 py-3 text-right font-bold text-ash-900">{row.close}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-green-600 bg-green-50/30">{formatPercent(row.closePerc)}</td>
                                            <td className="px-4 py-3 text-right font-medium">{formatCurrency(row.fatturato)}</td>
                                            <td className="px-4 py-3 text-right text-red-600 font-medium bg-red-50/30">{formatCurrency(row.spentAmountEur)}</td>
                                            <td className="px-4 py-3 text-right font-bold text-brand-orange bg-orange-50/30">
                                                {formatPercent(row.roas)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* DRILL-DOWN PER GDO */}
                <div className="space-y-6 pt-8 border-t border-ash-200 mt-8">
                    <div className="flex items-center gap-2 mb-6">
                        <Users className="w-7 h-7 text-brand-orange" />
                        <h2 className="text-2xl font-bold text-ash-900">Drill-Down per GDO</h2>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center items-center p-12">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-orange" />
                        </div>
                    ) : statsByGdo.length === 0 ? (
                        <div className="p-12 text-center text-ash-500 bg-white rounded-xl border border-ash-200">
                            Nessun dato GDO disponibile.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-8">
                            {statsByGdo.map((funnelItem) => {
                                // Calculate Totals for the bottom row
                                const tLeadAssegnati = funnelItem.gdoStats.reduce((acc, row) => acc + row.leadAssegnati, 0);
                                const tAppsFissati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsFissati, 0);
                                const tAppsConfermati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsConfermati, 0);
                                const tAppsPresenziati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsPresenziati, 0);
                                const tClosed = funnelItem.gdoStats.reduce((acc, row) => acc + row.closed, 0);
                                const tFatturato = funnelItem.gdoStats.reduce((acc, row) => acc + row.fatturato, 0);

                                const tFissPerc = tLeadAssegnati > 0 ? (tAppsFissati / tLeadAssegnati) * 100 : 0;
                                const tConfPerc = tAppsFissati > 0 ? (tAppsConfermati / tAppsFissati) * 100 : 0;
                                const tPresPerc = tAppsConfermati > 0 ? (tAppsPresenziati / tAppsConfermati) * 100 : 0;
                                const tClosePerc = tAppsPresenziati > 0 ? (tClosed / tAppsPresenziati) * 100 : 0;

                                return (
                                    <div key={funnelItem.funnel} className="bg-white rounded-xl border border-ash-200 shadow-sm overflow-hidden">
                                        <div className="bg-orange-50 border-b border-orange-100 px-6 py-4 flex items-center justify-between">
                                            <h3 className="text-lg font-bold text-orange-900 uppercase tracking-wider">{funnelItem.funnel}</h3>
                                            <span className="text-sm font-medium text-brand-orange bg-orange-100 px-3 py-1 rounded-full">
                                                {funnelItem.gdoStats.length} GDO attivi
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-white text-ash-500 border-b border-ash-200 text-xs uppercase">
                                                    <tr>
                                                        <th className="px-6 py-3 font-semibold">GDO</th>
                                                        <th className="px-4 py-3 font-semibold text-right" title="Lead presi in carico dal singolo GDO">Presi in carico</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Fissati</th>
                                                        <th className="px-4 py-3 font-semibold text-right" title="App fissati / Lead presi in carico">% Fiss su presi</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Confermati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Conferma</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Presenziati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Presenziati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">Closed</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Closed</th>
                                                        <th className="px-4 py-3 font-semibold text-right text-emerald-700">Fatturato</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-ash-100">
                                                    {funnelItem.gdoStats.map((row, idx) => (
                                                        <tr key={idx} className="hover:bg-ash-50">
                                                            <td className="px-6 py-3 font-medium text-ash-900">{row.gdoName}</td>
                                                            <td className="px-4 py-3 text-right text-ash-600 font-medium">{row.leadAssegnati}</td>
                                                            <td className="px-4 py-3 text-right text-ash-600 font-medium">{row.appsFissati}</td>
                                                            <td className="px-4 py-3 text-right font-semibold text-orange-600">{formatPercent(row.fissaggioPerc)}</td>
                                                            <td className="px-4 py-3 text-right text-ash-600 font-medium">{row.appsConfermati}</td>
                                                            <td className="px-4 py-3 text-right text-ash-500">{formatPercent(row.confermePerc)}</td>
                                                            <td className="px-4 py-3 text-right text-ash-600 font-medium">{row.appsPresenziati}</td>
                                                            <td className="px-4 py-3 text-right text-ash-500">{formatPercent(row.presenziatiPerc)}</td>
                                                            <td className="px-4 py-3 text-right font-semibold text-orange-700">{row.closed}</td>
                                                            <td className="px-4 py-3 text-right text-ash-500 font-medium">{formatPercent(row.closedPerc)}</td>
                                                            <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatCurrency(row.fatturato)}</td>
                                                        </tr>
                                                    ))}
                                                    {/* TOTALE ROW */}
                                                    <tr className="bg-ash-50 border-t-2 border-ash-200">
                                                        <td className="px-6 py-4 font-bold text-ash-900 uppercase">Totale</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-900">{tLeadAssegnati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-900">{tAppsFissati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-orange-600">{formatPercent(tFissPerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-900">{tAppsConfermati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-700">{formatPercent(tConfPerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-900">{tAppsPresenziati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-ash-700">{formatPercent(tPresPerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-orange-700">{tClosed}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-orange-700">{formatPercent(tClosePerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-emerald-700">{formatCurrency(tFatturato)}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
