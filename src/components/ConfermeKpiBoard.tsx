"use client"

/**
 * Dashboard /kpi-conferme.
 *
 * In testa: hero "Chiusure Settimanali" (T1=30 €145, T2=38 €290) + storico
 * ultime 8 settimane chiuse con bonus maturato.
 *
 * Sotto resta tutto il dettaglio mensile: calendario, tabella ACT vs TARGET,
 * tabella Scostamento. La sidebar venditori mostra appuntamenti assegnati,
 * trattative e chiusure per ogni venditore.
 */

import { useState, useEffect } from "react"
import { getConfermeKpiStats, getConfermeSalesList } from "@/app/actions/confermeKpiActions"
import { CalendarDays, Target, Filter, AlertCircle, Users, Trophy, Gift, CheckCircle2, History, TrendingUp } from "lucide-react"

export function ConfermeKpiBoard({ currentUser }: { currentUser: any }) {
    const [monthDate, setMonthDate] = useState(new Date())
    const [stats, setStats] = useState<any>(null)
    const [salesList, setSalesList] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [todayStr, setTodayStr] = useState("")

    useEffect(() => {
        setTodayStr(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }))
    }, [])

    const isManager = currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER'

    const [selectedUser, setSelectedUser] = useState<string>(
        currentUser.role === 'CONFERME' ? currentUser.id : 'ALL'
    )

    const fetchDashboardData = async () => {
        setIsLoading(true)
        try {
            const userIdParam = selectedUser === 'ALL' ? undefined : selectedUser
            const [kpiData, salesData] = await Promise.all([
                getConfermeKpiStats(monthDate, userIdParam),
                getConfermeSalesList(monthDate),
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

    // === Hero data ===
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

    // === Calendario (block grid) ===
    const dailyStats = stats.dailyStats
    const weekdayHeaders = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
    const calendarWeeks: (typeof dailyStats[0] | null)[][] = []
    if (dailyStats.length > 0) {
        let currentWeek: (typeof dailyStats[0] | null)[] = []
        const firstDayIdx = dailyStats[0].dayOfWeek === 0 ? 6 : dailyStats[0].dayOfWeek - 1
        for (let i = 0; i < firstDayIdx; i++) currentWeek.push(null)
        for (const day of dailyStats) {
            currentWeek.push(day)
            if (currentWeek.length === 7) {
                calendarWeeks.push(currentWeek)
                currentWeek = []
            }
        }
        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) currentWeek.push(null)
            calendarWeeks.push(currentWeek)
        }
    }

    const tableData: any[] = stats.tableData || []

    return (
        <div className="max-w-[1600px] w-full mx-auto flex flex-col gap-6">
            <div className="flex justify-between items-center shrink-0 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-black text-ash-800 tracking-tight">Dashboard Conferme</h1>
                    <p className="text-sm font-medium text-ash-500">Chiusure settimanali, calendario e dettaglio mensile</p>
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

                            <div className="mt-6">
                                <div className="relative w-full h-9 bg-black/30 rounded-full border border-white/10 shadow-inner">
                                    <div
                                        className={`absolute top-0 left-0 h-full rounded-full transition-[width] duration-1000 ease-out ${tier2Reached
                                            ? 'bg-gradient-to-r from-gold-400 via-gold-300 to-gold-200 shadow-[0_0_20px_rgba(201,161,60,0.6)]'
                                            : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300 shadow-[0_0_15px_rgba(50,200,120,0.4)]'
                                            }`}
                                        style={{ width: `${progress}%` }}
                                    />
                                    <div className="absolute top-1/2 -translate-y-1/2 -ml-3.5 z-10" style={{ left: `${tier1Pos}%` }}>
                                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-black bg-ash-900 transition-all
                                            ${tier1Reached ? 'border-emerald-300 text-emerald-300' : 'border-white/40 text-white/60'}`}>
                                            {t1}
                                        </div>
                                    </div>
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
                                        <div className="font-black text-lg">{t1} chiusure → €{reward1}</div>
                                        <div className="text-[10px] opacity-70 mt-0.5">
                                            {tier1Reached ? '✓ Sbloccato' : `Mancano ${Math.max(0, t1 - closedWeek)}`}
                                        </div>
                                    </div>
                                    <div className={`rounded-xl border px-3 py-2.5 ${tier2Reached ? 'bg-gold-500/20 border-gold-300' : 'bg-white/5 border-white/10'}`}>
                                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80 font-bold">
                                            <Trophy className="h-3 w-3" /> Tier 2
                                        </div>
                                        <div className="font-black text-lg">{t2} chiusure → €{reward2}</div>
                                        <div className="text-[10px] opacity-70 mt-0.5">
                                            {tier2Reached ? '✓ Sbloccato' : `Mancano ${Math.max(0, t2 - closedWeek)}`}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* STORICO CHIUSURE SETTIMANALI */}
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

                    {/* CALENDARIO MESE */}
                    <div className="bg-white rounded-2xl shadow-sm border border-ash-200 flex flex-col w-full">
                        <div className="p-4 border-b border-ash-100 bg-ash-50/50 flex items-center justify-between">
                            <h3 className="font-bold text-ash-800 flex items-center gap-2">
                                <CalendarDays className="w-5 h-5 text-brand-orange" /> Calendario Mese
                            </h3>
                        </div>
                        <div className="p-4 flex flex-col gap-4 overflow-x-auto w-full">
                            <div className="flex gap-2 min-w-[700px] md:min-w-0">
                                {weekdayHeaders.map(h => (
                                    <div key={h} className="flex-1 text-center text-[10px] font-bold text-ash-400 uppercase tracking-wider">{h}</div>
                                ))}
                            </div>
                            {calendarWeeks.map((week, idx) => (
                                <div key={idx} className="flex gap-2 min-w-[700px] md:min-w-0 pb-1">
                                    {week.map((day, colIdx) => {
                                        if (!day) {
                                            return <div key={`empty-${idx}-${colIdx}`} className="flex-1 bg-transparent border border-dashed border-ash-200 rounded-xl opacity-20"></div>
                                        }
                                        const isToday = day.date === todayStr
                                        const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6
                                        return (
                                            <div key={day.date} className={`flex-1 rounded-xl border ${isToday ? 'border-brand-orange ring-1 ring-brand-orange/50 bg-orange-50/20' : isWeekend ? 'bg-ash-50 border-ash-100' : 'border-ash-200 bg-white'} overflow-hidden transition-all hover:shadow-md`}>
                                                <div className={`text-center py-1.5 text-xs font-bold border-b ${isToday ? 'bg-brand-orange text-white border-brand-orange' : isWeekend ? 'bg-ash-100 text-ash-400 border-ash-100' : 'bg-ash-50 text-ash-600 border-ash-200'}`}>
                                                    {parseInt(day.date.split('-')[2])}
                                                </div>
                                                <div className={`p-2 flex flex-col gap-1.5 ${isWeekend ? 'opacity-50' : ''}`}>
                                                    <div className="flex justify-between items-center text-[11px]">
                                                        <span className="text-ash-500 font-medium">Fissati</span>
                                                        <span className="font-bold text-ash-900">{day.fixed}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[11px]">
                                                        <span className="text-ash-500 font-medium">Confermati</span>
                                                        <span className="font-bold text-blue-600 bg-blue-50 px-1 rounded">{day.confirmed}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[11px]">
                                                        <span className="text-ash-500 font-medium">Scartati</span>
                                                        <span className="font-bold text-red-600">{day.discarded}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* TABELLA: Numeri Mensili ACT vs TARGET */}
                    <div className="bg-white rounded-xl shadow-sm border border-ash-200 overflow-hidden">
                        <div className="bg-gradient-to-r from-ash-800 to-ash-700 px-4 py-2 border-b border-ash-900">
                            <h3 className="font-bold text-white text-xs tracking-widest uppercase flex items-center gap-2">
                                <Target className="w-4 h-4 text-brand-orange" />
                                Numeri Mensili: ACT vs TARGET
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left text-ash-700 border-collapse">
                                <thead className="bg-ash-50 text-ash-500 uppercase font-bold text-[10px] border-b border-ash-200">
                                    <tr>
                                        <th className="px-3 py-2 border-r border-ash-200 w-1/4">Nucleo Obiettivo</th>
                                        <th colSpan={2} className="px-3 py-2 border-r border-ash-200 text-center bg-blue-50/50 text-blue-800">ACT</th>
                                        <th colSpan={2} className="px-3 py-2 border-r border-ash-200 text-center bg-ash-100/50">Target Prev</th>
                                        <th className="px-3 py-2 border-r border-ash-200 text-center">Target / Day</th>
                                        <th className="px-3 py-2 text-center bg-orange-50/50 text-orange-800">Today</th>
                                    </tr>
                                    <tr className="border-b border-ash-200 bg-white">
                                        <th className="px-3 py-1 border-r border-ash-200 font-normal">Metriche operative</th>
                                        <th className="px-3 py-1 border-r border-ash-200 text-center font-semibold text-ash-900">Valore Assoluto</th>
                                        <th className="px-3 py-1 border-r border-ash-200 text-center font-semibold text-ash-900">Valore %</th>
                                        <th className="px-3 py-1 border-r border-ash-200 text-center font-semibold text-ash-900">Valore Assoluto</th>
                                        <th className="px-3 py-1 border-r border-ash-200 text-center font-semibold text-ash-900">Valore %</th>
                                        <th className="px-3 py-1 border-r border-ash-200 text-center font-semibold text-ash-900">Rate</th>
                                        <th className="px-3 py-1 text-center font-semibold text-ash-900">Attività</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.map((row, i) => (
                                        <tr key={i} className="border-b border-ash-100 hover:bg-ash-50 transition-colors">
                                            <td className="px-3 py-2 font-bold text-ash-900 border-r border-ash-200">{row.label}</td>
                                            <td className="px-3 py-2 text-center font-black text-blue-700 bg-blue-50/20">{row.actAbs}</td>
                                            <td className="px-3 py-2 text-center font-semibold border-r border-ash-200 bg-blue-50/20">{row.actPct.toFixed(1)}%</td>
                                            <td className="px-3 py-2 text-center font-bold text-ash-800 bg-ash-50/50">{row.prevAbs}</td>
                                            <td className="px-3 py-2 text-center font-semibold border-r border-ash-200 bg-ash-50/50">{row.prevPct.toFixed(1)}%</td>
                                            <td className="px-3 py-2 text-center text-ash-500 border-r border-ash-200">{row.targetDay.toFixed(2)}</td>
                                            <td className="px-3 py-2 text-center font-black text-brand-orange bg-orange-50/20">{row.today}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* TABELLA: Scostamento Mensile */}
                    <div className="bg-white rounded-xl shadow-sm border border-ash-200 overflow-hidden border-t-4 border-t-red-400">
                        <div className="bg-gradient-to-r from-red-50 to-white px-4 py-2 border-b border-ash-200">
                            <h3 className="font-bold text-red-800 text-xs tracking-widest uppercase flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-red-400" />
                                Scostamento Mensile
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left text-ash-700 border-collapse">
                                <thead className="bg-ash-50 text-ash-500 uppercase font-bold text-[10px] border-b border-ash-200">
                                    <tr>
                                        <th className="px-3 py-2 border-r border-ash-200 w-1/4">Nucleo Obiettivo</th>
                                        <th className="px-3 py-2 border-r border-ash-200 text-center">Val Assoluto (-/+)</th>
                                        <th className="px-3 py-2 border-r border-ash-200 text-center">Valore %</th>
                                        <th className="px-3 py-2 border-r border-ash-200 text-center">Data Primo -20%</th>
                                        <th className="px-3 py-2 text-center">Da Segnalare</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.map((row, i) => {
                                        const isNegative = row.scostamentoAbs < 0;
                                        return (
                                            <tr key={i} className="border-b border-ash-100 hover:bg-ash-50 transition-colors">
                                                <td className="px-3 py-2 font-bold text-ash-900 border-r border-ash-200 bg-ash-50/30">{row.label}</td>
                                                <td className={`px-3 py-2 text-center font-black border-r border-ash-200 ${isNegative ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                                    {row.scostamentoAbs > 0 ? '+' : ''}{row.scostamentoAbs}
                                                </td>
                                                <td className={`px-3 py-2 text-center font-bold border-r border-ash-200 ${isNegative ? 'text-red-600' : 'text-green-600'}`}>
                                                    {row.scostamentoPct > 0 ? '+' : ''}{row.scostamentoPct.toFixed(1)}%
                                                </td>
                                                <td className="px-3 py-2 text-center border-r border-ash-200 text-ash-500 font-mono">
                                                    {row.dataPrimo}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider
                                                        ${row.badge === 'ALLERT' ? 'bg-red-100 text-red-800 border border-red-200 shadow-sm' :
                                                            row.badge === 'PRE-RISK' ? 'bg-gold-100 text-gold-800 border border-gold-200 shadow-sm' :
                                                                'bg-green-100 text-green-800 border border-green-200 shadow-sm'}`}
                                                    >
                                                        {row.badge}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>

                {/* Sidebar venditori — assegnati / trattative / chiusure */}
                <div className="w-full lg:w-[360px] shrink-0">
                    <div className="bg-white rounded-2xl shadow-sm border border-ash-200 overflow-hidden lg:sticky lg:top-4">
                        <div className="p-4 border-b border-ash-100 bg-ash-50/50 flex flex-col gap-1">
                            <h3 className="font-bold text-ash-800 flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-brand-orange" /> Performance Venditori
                            </h3>
                            <p className="text-xs text-ash-500 leading-tight">
                                Mese: assegnati (confermati al closer), trattative presenziate e chiusure firmate.
                            </p>
                        </div>
                        <div className="p-2 max-h-[70vh] overflow-y-auto">
                            {salesList.length === 0 ? (
                                <div className="text-center p-6 text-sm text-ash-400">Nessun closer rilevato.</div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {salesList.map((sales: any) => (
                                        <div key={sales.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-ash-50 border border-transparent hover:border-ash-100 transition-colors">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange font-bold text-xs shrink-0">
                                                    {sales.displayName?.charAt(0) || sales.name?.charAt(0) || 'S'}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-bold text-[13px] text-ash-800 truncate">{sales.displayName || sales.name}</span>
                                                    <span className="text-[10px] text-ash-400 font-medium">Closer</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-center min-w-[40px]">
                                                    <div className="font-black text-base text-blue-700 leading-none">{sales.confirmedAssigned}</div>
                                                    <div className="text-[9px] text-ash-400 font-bold uppercase tracking-wider mt-0.5">Asgn</div>
                                                </div>
                                                <div className="text-center min-w-[40px]">
                                                    <div className="font-black text-base text-amber-600 leading-none">{sales.trattative ?? 0}</div>
                                                    <div className="text-[9px] text-ash-400 font-bold uppercase tracking-wider mt-0.5">Tratt</div>
                                                </div>
                                                <div className="text-center min-w-[40px]">
                                                    <div className="font-black text-base text-emerald-700 leading-none">{sales.chiusure ?? 0}</div>
                                                    <div className="text-[9px] text-ash-400 font-bold uppercase tracking-wider mt-0.5">Chius</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="px-4 py-2 border-t border-ash-100 bg-ash-50/50">
                            <div className="text-[10px] text-ash-500 leading-tight flex items-center gap-1.5">
                                <TrendingUp className="h-3 w-3 text-emerald-600" />
                                <span><strong>Asgn</strong>: lead confermati nel mese · <strong>Tratt</strong>: presenziati · <strong>Chius</strong>: contratti firmati</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
