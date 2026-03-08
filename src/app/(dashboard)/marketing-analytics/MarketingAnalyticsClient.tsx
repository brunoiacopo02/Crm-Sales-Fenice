"use client";

import { useState } from "react";
import { getMarketingStats, saveMarketingBudget, getMarketingStatsByGdo } from "@/app/actions/marketingActions";
import { Loader2, TrendingUp, Save, Filter, Users } from "lucide-react";

type Stat = {
    funnel: string;
    leads: number;
    apps: number;
    conferme: number;
    trattative: number;
    close: number;
    fatturato: number;
    appsPerc: number;
    confermePerc: number;
    trattativePerc: number;
    closePerc: number;
    spentAmountEur: number;
    roas: number;
};

type GdoStatTableRow = {
    gdoName: string;
    appsFissati: number;
    appsConfermati: number;
    confermePerc: number;
    appsPresenziati: number;
    presenziatiPerc: number;
    closed: number;
    closedPerc: number;
}

type FunnelGdoStats = {
    funnel: string;
    gdoStats: GdoStatTableRow[]
};

export default function MarketingAnalyticsClient({
    initialStats,
    initialStatsByGdo,
    initialMonth
}: {
    initialStats: Stat[],
    initialStatsByGdo: FunnelGdoStats[],
    initialMonth: string
}) {
    const [month, setMonth] = useState(initialMonth);
    const [stats, setStats] = useState<Stat[]>(initialStats);
    const [statsByGdo, setStatsByGdo] = useState<FunnelGdoStats[]>(initialStatsByGdo);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form states
    const [selectedFunnel, setSelectedFunnel] = useState("");
    const [spentAmount, setSpentAmount] = useState("");

    const fetchStats = async (m: string) => {
        setIsLoading(true);
        try {
            const [data, gdoData] = await Promise.all([
                getMarketingStats(m),
                getMarketingStatsByGdo(m)
            ]);
            setStats(data);
            setStatsByGdo(gdoData);
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
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
                            <TrendingUp className="h-8 w-8 text-brand-orange" />
                            Marketing Analytics
                        </h1>
                        <p className="text-gray-500 mt-1">
                            Monitora le performance e il ROAS per ogni campagna marketing.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
                        <Filter className="w-5 h-5 text-gray-400 ml-2" />
                        <input
                            type="month"
                            value={month}
                            onChange={handleMonthChange}
                            className="bg-transparent border-none focus:ring-0 text-gray-700 font-medium cursor-pointer"
                        />
                    </div>
                </div>

                {/* Budget Form */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Gestione Budget mensile</h2>
                    <form onSubmit={handleSaveBudget} className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1 flex-1 min-w-[200px]">
                            <label className="text-sm font-medium text-gray-700">Funnel</label>
                            <select
                                value={selectedFunnel}
                                onChange={e => setSelectedFunnel(e.target.value)}
                                className="w-full h-10 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent"
                                required
                            >
                                <option value="">Seleziona funnel...</option>
                                {uniqueFunnels.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1 flex-1 min-w-[200px]">
                            <label className="text-sm font-medium text-gray-700">Spesa Effettuata (€)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Es. 1500"
                                value={spentAmount}
                                onChange={e => setSpentAmount(e.target.value)}
                                className="w-full h-10 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent"
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
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        {isLoading ? (
                            <div className="flex justify-center items-center p-12">
                                <Loader2 className="w-8 h-8 animate-spin text-brand-orange" />
                            </div>
                        ) : stats.length === 0 ? (
                            <div className="p-12 text-center text-gray-500">
                                Nessun dato disponibile per questo mese.
                            </div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-4 font-semibold">Funnel Globali</th>
                                        <th className="px-4 py-4 font-semibold text-right">Lead</th>
                                        <th className="px-4 py-4 font-semibold text-right">App</th>
                                        <th className="px-4 py-4 font-semibold text-right text-gray-500">App %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Conferme</th>
                                        <th className="px-4 py-4 font-semibold text-right text-gray-500">Conf %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Trattative</th>
                                        <th className="px-4 py-4 font-semibold text-right text-gray-500">Tratt %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Close</th>
                                        <th className="px-4 py-4 font-semibold text-right text-green-600">Close %</th>
                                        <th className="px-4 py-4 font-semibold text-right">Fatturato</th>
                                        <th className="px-4 py-4 font-semibold text-right text-red-600">Spesa</th>
                                        <th className="px-4 py-4 font-semibold text-right text-brand-orange">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {stats.map((row) => (
                                        <tr key={row.funnel} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-gray-900">{row.funnel}</td>
                                            <td className="px-4 py-3 text-right">{row.leads}</td>
                                            <td className="px-4 py-3 text-right">{row.apps}</td>
                                            <td className="px-4 py-3 text-right text-gray-500 bg-gray-50/50">{formatPercent(row.appsPerc)}</td>
                                            <td className="px-4 py-3 text-right font-medium">{row.conferme}</td>
                                            <td className="px-4 py-3 text-right text-gray-500 bg-gray-50/50">{formatPercent(row.confermePerc)}</td>
                                            <td className="px-4 py-3 text-right">{row.trattative}</td>
                                            <td className="px-4 py-3 text-right text-gray-500 bg-gray-50/50">{formatPercent(row.trattativePerc)}</td>
                                            <td className="px-4 py-3 text-right font-bold text-gray-900">{row.close}</td>
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
                <div className="space-y-6 pt-8 border-t border-gray-200 mt-8">
                    <div className="flex items-center gap-2 mb-6">
                        <Users className="w-7 h-7 text-indigo-600" />
                        <h2 className="text-2xl font-bold text-gray-900">Drill-Down per GDO</h2>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center items-center p-12">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                        </div>
                    ) : statsByGdo.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 bg-white rounded-xl border border-gray-200">
                            Nessun dato GDO disponibile.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-8">
                            {statsByGdo.map((funnelItem) => {
                                // Calculate Totals for the bottom row
                                const tAppsFissati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsFissati, 0);
                                const tAppsConfermati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsConfermati, 0);
                                const tAppsPresenziati = funnelItem.gdoStats.reduce((acc, row) => acc + row.appsPresenziati, 0);
                                const tClosed = funnelItem.gdoStats.reduce((acc, row) => acc + row.closed, 0);

                                const tConfPerc = tAppsFissati > 0 ? (tAppsConfermati / tAppsFissati) * 100 : 0;
                                const tPresPerc = tAppsConfermati > 0 ? (tAppsPresenziati / tAppsConfermati) * 100 : 0;
                                const tClosePerc = tAppsPresenziati > 0 ? (tClosed / tAppsPresenziati) * 100 : 0;

                                return (
                                    <div key={funnelItem.funnel} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                        <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-4 flex items-center justify-between">
                                            <h3 className="text-lg font-bold text-indigo-900 uppercase tracking-wider">{funnelItem.funnel}</h3>
                                            <span className="text-sm font-medium text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full">
                                                {funnelItem.gdoStats.length} GDO attivi
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-white text-gray-500 border-b border-gray-200 text-xs uppercase">
                                                    <tr>
                                                        <th className="px-6 py-3 font-semibold">GDO</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Fissati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Confermati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Conferma</th>
                                                        <th className="px-4 py-3 font-semibold text-right">App Presenziati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Presenziati</th>
                                                        <th className="px-4 py-3 font-semibold text-right">Closed</th>
                                                        <th className="px-4 py-3 font-semibold text-right">% Closed</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {funnelItem.gdoStats.map((row, idx) => (
                                                        <tr key={idx} className="hover:bg-gray-50">
                                                            <td className="px-6 py-3 font-medium text-gray-900">{row.gdoName}</td>
                                                            <td className="px-4 py-3 text-right text-gray-600 font-medium">{row.appsFissati}</td>
                                                            <td className="px-4 py-3 text-right text-gray-600 font-medium">{row.appsConfermati}</td>
                                                            <td className="px-4 py-3 text-right text-gray-500">{formatPercent(row.confermePerc)}</td>
                                                            <td className="px-4 py-3 text-right text-gray-600 font-medium">{row.appsPresenziati}</td>
                                                            <td className="px-4 py-3 text-right text-gray-500">{formatPercent(row.presenziatiPerc)}</td>
                                                            <td className="px-4 py-3 text-right font-semibold text-indigo-700">{row.closed}</td>
                                                            <td className="px-4 py-3 text-right text-gray-500 font-medium">{formatPercent(row.closedPerc)}</td>
                                                        </tr>
                                                    ))}
                                                    {/* TOTALE ROW */}
                                                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                                                        <td className="px-6 py-4 font-bold text-gray-900 uppercase">Totale</td>
                                                        <td className="px-4 py-4 text-right font-bold text-gray-900">{tAppsFissati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-gray-900">{tAppsConfermati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-gray-700">{formatPercent(tConfPerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-gray-900">{tAppsPresenziati}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-gray-700">{formatPercent(tPresPerc)}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-indigo-700">{tClosed}</td>
                                                        <td className="px-4 py-4 text-right font-bold text-indigo-700">{formatPercent(tClosePerc)}</td>
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
