"use client"

/**
 * Dashboard /kpi-conferme — versione semplificata.
 *
 * In testa SOLO le chiusure settimanali del Conferme che guarda (l'obiettivo
 * resta settimanale: T1=30 chiusure → €145, T2=38 chiusure → €290) + storico
 * delle ultime 8 settimane chiuse con bonus maturato.
 *
 * Per Admin/Manager resta sotto la sidebar "Bilanciamento Venditori"
 * (utile per la ridistribuzione del traffico). Le tabelle mensili
 * "Numeri / Scostamento" e il calendario sono stati rimossi: erano
 * rumore visivo e ridondanti rispetto alla metrica core.
 */

import { useState, useEffect } from "react"
import { getConfermeKpiStats, getConfermeSalesList } from "@/app/actions/confermeKpiActions"
import { Target, Users, Filter, Trophy, Gift, CheckCircle2, History } from "lucide-react"

export function ConfermeKpiBoard({ currentUser }: { currentUser: any }) {
    const [monthDate, setMonthDate] = useState(new Date())
    const [stats, setStats] = useState<any>(null)
    const [salesList, setSalesList] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const isManager = currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER'

    // GDO/Conferme operativi vedono SOLO i propri dati. Admin/Manager
    // possono switchare via dropdown — ma se Conferme è "ALL" il backend
    // aggrega tutto il team per tier.
    const [selectedUser, setSelectedUser] = useState<string>(
        currentUser.role === 'CONFERME' ? currentUser.id : 'ALL'
    )

    const fetchDashboardData = async () => {
        setIsLoading(true)
        try {
            const userIdParam = selectedUser === 'ALL' ? undefined : selectedUser
            const [kpiData, salesData] = await Promise.all([
                getConfermeKpiStats(monthDate, userIdParam),
                isManager ? getConfermeSalesList(monthDate) : Promise.resolve([] as any[]),
            ])
            setStats(kpiData)
            setSalesList(salesData)
        } catch (error) {
            console.error("Failed to load Conferme KPI", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchDashboardData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthDate, selectedUser])

    const formatEur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)

    if (isLoading || !stats) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <div className="animate-spin w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full"></div>
            </div>
        )
    }

    const closedWeek = stats.weekly.closedCount || 0
    const t1 = stats.weekly.targetTier1
    const t2 = stats.weekly.targetTier2
    const reward1 = stats.weekly.rewardTier1 ?? 145
    const reward2 = stats.weekly.rewardTier2 ?? 290
    const revenueWeek = stats.weekly.revenueEur || 0

    const tier1Reached = closedWeek >= t1
    const tier2Reached = closedWeek >= t2
    const progress = Math.min((closedWeek / (t2 || 1)) * 100, 100)
    const tier1Pos = Math.min((t1 / (t2 || 1)) * 100, 100)

    const closedHistory: any[] = stats.closedHistory || []
    const totalBonus = closedHistory.reduce((s, h) => s + (h.bonusEur || 0), 0)

    return (
        <div className="max-w-[1400px] w-full mx-auto flex flex-col gap-6">
            <div className="flex justify-between items-center shrink-0 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-black text-ash-800 tracking-tight">Dashboard Conferme</h1>
                    <p className="text-sm font-medium text-ash-500">Chiusure settimanali e bonus maturati</p>
                </div>

                <div className="flex items-center gap-3">
                    {isManager && (
                        <select
                            value={selectedUser}
                            onChange={(e) => setSelectedUser(e.target.value)}
                            className="text-sm border border-ash-300 rounded-lg shadow-sm font-medium text-ash-700 bg-white px-3 py-1.5"
                        >
                            <option value="ALL">Tutto il Team</option>
                            <option value="team_view_only" disabled>-- Filtro per Utente (WIP) --</option>
                        </select>
                    )}
                    <label className="text-sm border flex items-center gap-2 border-ash-300 rounded-lg shadow-sm font-medium text-ash-700 bg-white px-3 py-1.5 cursor-pointer">
                        <Filter className="w-4 h-4" /> Mese:
                        <input
                            type="month"
                            value={monthDate.toISOString().slice(0, 7)}
                            onChange={e => setMonthDate(new Date(e.target.value))}
                            className="bg-transparent outline-none cursor-pointer border-none p-0 focus:ring-0 text-sm"
                        />
                    </label>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 w-full pb-10">
                <div className="flex-1 flex flex-col gap-6 min-w-0">

                    {/* HERO CARD — Chiusure settimanali */}
                    <div className={`relative overflow-hidden rounded-2xl border shadow-elevated p-6 ${tier2Reached
                        ? 'bg-gradient-to-br from-gold-700 via-gold-600 to-emerald-700 border-gold-400 text-white'
                        : tier1Reached
                            ? 'bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-800 border-emerald-500 text-white'
                            : 'bg-gradient-to-br from-brand-charcoal via-ash-900 to-emerald-900/40 border-ash-700 text-white'
                        }`}>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

                        <div className="relative z-10">
                            <div className="flex items-start justify-between flex-wrap gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-1.5 rounded-lg bg-emerald-500/20">
                                            <Target className="h-5 w-5 text-emerald-300" />
                                        </div>
                                        <h2 className="text-xl font-bold tracking-tight">Chiusure Settimanali</h2>
                                    </div>
                                    <div className="text-sm text-ash-300 font-medium">
                                        Settimana corrente (lun-dom Europe/Rome)
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-5xl font-black leading-none">{closedWeek}</div>
                                    <div className="text-xs uppercase tracking-wider mt-1 opacity-80">
                                        chiusure / {t2} max
                                    </div>
                                    {revenueWeek > 0 && (
                                        <div className="mt-2 text-sm font-semibold text-emerald-200">
                                            Fatturato: {formatEur(revenueWeek)}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Progress bar with tiers */}
                            <div className="mt-6">
                                <div className="relative w-full h-9 bg-black/30 rounded-full border border-white/10 shadow-inner">
                                    <div
                                        className={`absolute top-0 left-0 h-full rounded-full transition-[width] duration-1000 ease-out ${tier2Reached
                                            ? 'bg-gradient-to-r from-gold-400 via-gold-300 to-gold-200 shadow-[0_0_20px_rgba(201,161,60,0.6)]'
                                            : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300 shadow-[0_0_15px_rgba(50,200,120,0.4)]'
                                            }`}
                                        style={{ width: `${progress}%` }}
                                    />

                                    {/* Tier 1 marker */}
                                    <div
                                        className="absolute top-1/2 -translate-y-1/2 -ml-3.5 z-10"
                                        style={{ left: `${tier1Pos}%` }}
                                    >
                                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-black bg-ash-900 transition-all
                                            ${tier1Reached ? 'border-emerald-300 text-emerald-300' : 'border-white/40 text-white/60'}`}>
                                            {t1}
                                        </div>
                                    </div>

                                    {/* Tier 2 marker */}
                                    <div className="absolute top-1/2 -translate-y-1/2 -ml-4 z-10" style={{ left: '100%' }}>
                                        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-ash-900 transition-all
                                            ${tier2Reached ? 'border-gold-400' : 'border-white/40'}`}>
                                            <Trophy className={`h-4 w-4 ${tier2Reached ? 'text-gold-400' : 'text-white/60'}`} />
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <div className={`rounded-xl border px-3 py-2.5 ${tier1Reached ? 'bg-emerald-500/20 border-emerald-300' : 'bg-white/5 border-white/10'}`}>
                                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80 font-bold">
                                            <Gift className="h-3 w-3" /> Tier 1
                                        </div>
                                        <div className="font-black text-lg">
                                            {t1} chiusure → €{reward1}
                                        </div>
                                        <div className="text-[10px] opacity-70 mt-0.5">
                                            {tier1Reached ? '✓ Sbloccato' : `Mancano ${Math.max(0, t1 - closedWeek)}`}
                                        </div>
                                    </div>
                                    <div className={`rounded-xl border px-3 py-2.5 ${tier2Reached ? 'bg-gold-500/20 border-gold-300' : 'bg-white/5 border-white/10'}`}>
                                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80 font-bold">
                                            <Trophy className="h-3 w-3" /> Tier 2
                                        </div>
                                        <div className="font-black text-lg">
                                            {t2} chiusure → €{reward2}
                                        </div>
                                        <div className="text-[10px] opacity-70 mt-0.5">
                                            {tier2Reached ? '✓ Sbloccato' : `Mancano ${Math.max(0, t2 - closedWeek)}`}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* STORICO CHIUSURE SETTIMANE PRECEDENTI */}
                    <div className="bg-white p-5 rounded-2xl border border-ash-200/60 shadow-soft">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-ash-200/60 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <History className="h-5 w-5 text-brand-orange" />
                                <h3 className="font-bold text-ash-800">Storico Chiusure Settimanali</h3>
                            </div>
                            <div className="text-xs text-ash-500">
                                Bonus maturati ultime 8 settimane:&nbsp;
                                <span className="font-bold text-emerald-700">€{totalBonus.toLocaleString('it-IT')}</span>
                            </div>
                        </div>

                        <div className="text-xs text-ash-400 mb-3">
                            Una chiusura conta nella settimana indicata dalla data di esito venditore (lead chiuso = importo + data obbligatori).
                            {selectedUser === 'ALL' && isManager && (
                                <span className="ml-1 italic">Vista aggregata team.</span>
                            )}
                        </div>

                        {closedHistory.length === 0 ? (
                            <div className="text-center text-ash-400 italic py-6 text-sm">
                                Nessuna settimana chiusa nello storico.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs sm:text-sm">
                                    <thead>
                                        <tr className="border-b border-ash-200/60 text-left">
                                            <th className="pb-2 pr-3 text-ash-500 font-semibold">Settimana</th>
                                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Chiusure</th>
                                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Fatturato</th>
                                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Tier 1</th>
                                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Tier 2</th>
                                            <th className="pb-2 text-ash-500 font-semibold text-right">Bonus</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {closedHistory.map((h, idx) => {
                                            const status = h.tier2Reached ? 'tier2' : h.tier1Reached ? 'tier1' : 'miss';
                                            const denom = t2 || 1;
                                            const progPerc = Math.min((h.closedCount / denom) * 100, 100);
                                            return (
                                                <tr key={idx} className="border-b border-ash-100/60 hover:bg-brand-orange-50/20 transition-colors">
                                                    <td className="py-2.5 pr-3 font-semibold text-brand-charcoal">
                                                        <div className="flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4 text-emerald-500/70" />
                                                            {h.weekLabel}
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right">
                                                        <div className="flex flex-col items-end gap-1">
                                                            <div className="font-bold text-ash-800">{h.closedCount} <span className="text-ash-400 font-normal">/ {t2}</span></div>
                                                            <div className="w-20 h-1.5 bg-ash-100 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full ${status === 'tier2' ? 'bg-gold-500' : status === 'tier1' ? 'bg-emerald-500' : 'bg-ash-300'}`}
                                                                    style={{ width: `${progPerc}%` }}
                                                                ></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right text-ash-700 font-medium tabular-nums">
                                                        {h.revenueEur > 0 ? formatEur(h.revenueEur) : '—'}
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right">
                                                        <span className={`text-xs font-bold ${h.tier1Reached ? 'text-emerald-700' : 'text-ash-400'}`}>
                                                            {h.tier1Reached ? `✓ €${reward1}` : `${t1} (€${reward1})`}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right">
                                                        <span className={`text-xs font-bold ${h.tier2Reached ? 'text-gold-700' : 'text-ash-400'}`}>
                                                            {h.tier2Reached ? `✓ €${reward2}` : `${t2} (€${reward2})`}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 text-right">
                                                        <span className={`font-black ${h.bonusEur > 0 ? (h.tier2Reached ? 'text-gold-700' : 'text-emerald-700') : 'text-ash-400'}`}>
                                                            €{h.bonusEur.toLocaleString('it-IT')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar venditori — solo per Admin/Manager */}
                {isManager && (
                    <div className="w-full lg:w-[330px] shrink-0">
                        <div className="bg-white rounded-2xl shadow-sm border border-ash-200 overflow-hidden sticky top-4">
                            <div className="p-4 border-b border-ash-100 bg-ash-50/50 flex flex-col gap-1">
                                <h3 className="font-bold text-ash-800 flex items-center gap-2 text-sm">
                                    <Users className="w-4 h-4 text-brand-orange" /> Bilanciamento Venditori
                                </h3>
                                <p className="text-xs text-ash-500 leading-tight">Distribuzione assegnazioni confermate (mese).</p>
                            </div>
                            <div className="p-2 max-h-[60vh] overflow-y-auto">
                                {salesList.length === 0 ? (
                                    <div className="text-center p-6 text-sm text-ash-400">Nessun closer rilevato.</div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {salesList.map((sales: any) => (
                                            <div key={sales.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-ash-50 border border-transparent hover:border-ash-100 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange font-bold text-xs shrink-0">
                                                        {sales.displayName?.charAt(0) || 'S'}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-[13px] text-ash-800">{sales.displayName || sales.name}</span>
                                                        <span className="text-[10px] text-ash-400 font-medium">Closer</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-black text-lg text-brand-blue leading-none">{sales.confirmedAssigned}</div>
                                                    <div className="text-[10px] text-ash-400 font-bold uppercase tracking-wider">Assgn</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
