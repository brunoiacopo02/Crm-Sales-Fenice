"use client"

import { useState, useEffect } from "react"
import { getConfermeKpiStats, getConfermeSalesList } from "@/app/actions/confermeKpiActions"
import { CalendarDays, Target, TrendingUp, Filter, AlertCircle, ArrowUpRight, ArrowDownRight, Users } from "lucide-react"

export function ConfermeKpiBoard({ currentUser }: { currentUser: any }) {
    const [monthDate, setMonthDate] = useState(new Date())
    const [stats, setStats] = useState<any>(null)
    const [salesList, setSalesList] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [todayStr, setTodayStr] = useState("")

    useEffect(() => {
        setTodayStr(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }))
    }, [])

    // Option to view specific operator or 'ALL' if Admin/Manager
    const [selectedUser, setSelectedUser] = useState<string>(
        currentUser.role === 'CONFERME' ? currentUser.id : 'ALL'
    )

    const fetchDashboardData = async () => {
        setIsLoading(true)
        try {
            const userIdParam = selectedUser === 'ALL' ? undefined : selectedUser
            const [kpiData, salesData] = await Promise.all([
                getConfermeKpiStats(monthDate, userIdParam),
                getConfermeSalesList(monthDate)
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

    const formatPct = (val: number, target: number) => {
        if (!target) return '0%'
        return `${Math.round((val / target) * 100)}%`
    }

    const renderProgressBar = () => {
        if (!stats) return null
        const act = stats.weekly.confirmedAct
        const wT1 = stats.weekly.targetTier1
        const wT2 = stats.weekly.targetTier2

        return (
            <div className="bg-white rounded-2xl shadow-sm border border-ash-200 p-6 mb-6">
                <div className="flex justify-between items-end mb-4">
                    <div>
                        <h2 className="text-xl font-black text-ash-800 tracking-tight flex items-center gap-2">
                            <Target className="w-5 h-5 text-brand-orange" />
                            Progresso Settimanale
                        </h2>
                        <p className="text-sm text-ash-500 font-medium">Obiettivi Appuntamenti Confermati (Corrente)</p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-black text-ash-900">{act} <span className="text-sm font-semibold text-ash-400">/ {wT2} MAX</span></div>
                    </div>
                </div>

                <div className="relative h-6 bg-ash-100 rounded-full overflow-hidden shadow-inner flex">
                    {/* TIER 1 BAR */}
                    <div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-[width] duration-1000 ease-out relative"
                        style={{ width: `${(Math.min(wT1, act) / wT2) * 100}%` }}
                    >
                        {act >= wT1 && <div className="absolute inset-0 bg-white/20 animate-pulse"></div>}
                    </div>
                    {/* TIER 2 SUPPLEMENTARY BAR */}
                    <div
                        className="h-full bg-gradient-to-r from-brand-orange to-orange-400 transition-[width] duration-1000 ease-out relative"
                        style={{ width: `${(Math.max(0, act - wT1) / wT2) * 100}%` }}
                    ></div>

                    <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-ash-400 z-10" style={{ left: `${(wT1 / wT2) * 100}%` }}></div>
                </div>

                <div className="flex justify-between mt-2 text-xs font-bold text-ash-500 relative">
                    <span style={{ position: 'absolute', left: `${(wT1 / wT2) * 100}%`, transform: 'translateX(-50%)' }}>
                        T1 ({wT1})
                    </span>
                    <span className="w-full text-right">T2 ({wT2})</span>
                </div>

                {/* Storico Settimanale */}
                {stats.weeklyHistory && stats.weeklyHistory.length > 0 && (
                    <div className="mt-8 pt-4 border-t border-ash-100">
                        <h3 className="text-xs font-bold text-ash-500 uppercase tracking-wider mb-3">Storico Mensile Obiettivi</h3>
                        <div className="flex flex-wrap gap-2">
                            {stats.weeklyHistory.map((w: any, idx: number) => (
                                <div key={idx} className={`text-[10px] sm:text-xs px-2.5 py-1.5 rounded-md border flex items-center gap-2 ${w.isCurrent ? 'border-brand-orange bg-orange-50/30' : 'border-ash-200 bg-ash-50'}`}>
                                    <span className="font-bold text-ash-700">{w.weekName}</span>
                                    <span className="text-ash-400">({w.dateRange})</span>
                                    <span className="font-black ml-1 border-l pl-2 border-ash-300 flex items-center gap-1 text-ash-800">
                                        {w.act} <span className="font-normal text-[10px]">app.</span>
                                        {w.hitT2 ? <span className="text-green-600 bg-green-100 px-1 rounded ml-1">✅ T2</span> : w.hitT1 ? <span className="text-blue-600 bg-blue-100 px-1 rounded ml-1">✅ T1</span> : <span className="text-red-500 ml-1">❌</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const renderBlockGrid = () => {
        if (!stats) return null
        const dailyStats = stats.dailyStats

        // Group days into Mon-Sun calendar weeks
        const weeks: (typeof dailyStats[0] | null)[][] = []
        let currentWeek: (typeof dailyStats[0] | null)[] = []

        // Pad the first week with nulls before the first day
        if (dailyStats.length > 0) {
            // dayOfWeek: 0=Sun, 1=Mon. Convert to Mon-based index: Mon=0, Tue=1, ..., Sun=6
            const firstDayIdx = dailyStats[0].dayOfWeek === 0 ? 6 : dailyStats[0].dayOfWeek - 1
            for (let i = 0; i < firstDayIdx; i++) {
                currentWeek.push(null)
            }
        }

        for (const day of dailyStats) {
            currentWeek.push(day)
            if (currentWeek.length === 7) {
                weeks.push(currentWeek)
                currentWeek = []
            }
        }
        // Pad the last week with nulls after the last day
        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) currentWeek.push(null)
            weeks.push(currentWeek)
        }

        const weekdayHeaders = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

        return (
            <div className="bg-white rounded-2xl shadow-sm border border-ash-200 mb-6 flex flex-col w-full">
                <div className="p-4 border-b border-ash-100 bg-ash-50/50 flex items-center justify-between">
                    <h3 className="font-bold text-ash-800 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-brand-orange" /> Calendario Mese</h3>
                </div>
                <div className="p-4 flex flex-col gap-4 overflow-x-auto w-full">
                    {/* Weekday headers */}
                    <div className="flex gap-2 min-w-[700px] md:min-w-0">
                        {weekdayHeaders.map(h => (
                            <div key={h} className="flex-1 text-center text-[10px] font-bold text-ash-400 uppercase tracking-wider">{h}</div>
                        ))}
                    </div>
                    {weeks.map((week, idx) => (
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
        )
    }

    const renderMonthlyTabular = () => {
        if (!stats) return null
        const tableData: any[] = stats.tableData || []

        return (
            <div className="flex flex-col gap-6 mt-auto">
                {/* Prima Tabella: NUMERI MENSILI */}
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

                                        {/* ACT */}
                                        <td className="px-3 py-2 text-center font-black text-blue-700 bg-blue-50/20">{row.actAbs}</td>
                                        <td className="px-3 py-2 text-center font-semibold border-r border-ash-200 bg-blue-50/20">{row.actPct.toFixed(1)}%</td>

                                        {/* TARGET PREV */}
                                        <td className="px-3 py-2 text-center font-bold text-ash-800 bg-ash-50/50">{row.prevAbs}</td>
                                        <td className="px-3 py-2 text-center font-semibold border-r border-ash-200 bg-ash-50/50">{row.prevPct.toFixed(1)}%</td>

                                        {/* TARGET/DAY */}
                                        <td className="px-3 py-2 text-center text-ash-500 border-r border-ash-200">{row.targetDay.toFixed(2)}</td>

                                        {/* TODAY */}
                                        <td className="px-3 py-2 text-center font-black text-brand-orange bg-orange-50/20">{row.today}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Seconda Tabella: SCOSTAMENTO */}
                <div className="bg-white rounded-xl shadow-sm border border-ash-200 overflow-hidden mt-2 border-t-4 border-t-red-400">
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
        )
    }

    const renderSalesList = () => {
        return (
            <div className="bg-white flex flex-col rounded-2xl shadow-sm border border-ash-200 h-full overflow-hidden">
                <div className="p-4 border-b border-ash-100 bg-ash-50/50 flex flex-col gap-1">
                    <h3 className="font-bold text-ash-800 flex items-center gap-2 text-sm"><Users className="w-4 h-4 text-brand-orange" /> Bilanciamento Venditori</h3>
                    <p className="text-xs text-ash-500 leading-tight">Distribuzione delle assegnazioni confermate in questo mese. Uso suggerito: assegna nuovo traffico a chi è più scarico.</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {salesList.length === 0 ? (
                        <div className="text-center p-6 text-sm text-ash-400">Nessun Closer rilevato o lista vuota.</div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {salesList.map((sales, idx) => (
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
        )
    }

    if (isLoading) {
        return <div className="flex items-center justify-center h-[50vh]"><div className="animate-spin w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full"></div></div>
    }

    return (
        <div className="max-w-[1600px] w-full mx-auto h-[calc(100vh-80px)] flex flex-col gap-6">
            <div className="flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-2xl font-black text-ash-800 tracking-tight">Dashboard Conferme</h1>
                    <p className="text-sm font-medium text-ash-500">Monitoraggio KPI e Traiettorie Mensili</p>
                </div>

                <div className="flex items-center gap-3">
                    {(currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER') && (
                        <select
                            value={selectedUser}
                            onChange={(e) => setSelectedUser(e.target.value)}
                            className="text-sm border-ash-300 rounded-lg shadow-sm font-medium text-ash-700 bg-white"
                        >
                            <option value="ALL">Tutto il Team</option>
                            {/* In a real app we'd fetch the list of Conferme users to populate this dropdown */}
                            <option value="team_view_only" disabled>-- Filtro per Utente (WIP) --</option>
                        </select>
                    )}
                    <label className="text-sm border flex items-center gap-2 border-ash-300 rounded-lg shadow-sm font-medium text-ash-700 bg-white px-3 py-1.5 cursor-pointer">
                        <Filter className="w-4 h-4" /> Mese:
                        <input type="month" value={monthDate.toISOString().slice(0, 7)} onChange={e => setMonthDate(new Date(e.target.value))} className="bg-transparent outline-none cursor-pointer border-none p-0 focus:ring-0 text-sm" />
                    </label>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto w-full pb-10">
                {/* Main KPI Flow */}
                <div className="flex-1 flex flex-col min-w-0 overflow-x-auto w-full">
                    {renderProgressBar()}
                    {renderBlockGrid()}
                    {renderMonthlyTabular()}
                </div>

                {/* Sales Distribution Sidebar */}
                <div className="w-full lg:w-[350px] shrink-0 min-h-[400px]">
                    {renderSalesList()}
                </div>
            </div>
        </div>
    )
}
