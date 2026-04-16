"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect, useCallback } from "react"
import { getManagerPauseReport, getWeeklyPauseReport, getMonthlyPauseReport, type PauseAggregateReport } from "@/app/actions/pauseActions"
import { getLocalDateRome } from "@/lib/pauseUtils"
import { Search, Clock, AlertTriangle, RefreshCw, CalendarDays, CalendarRange, BarChart3 } from "lucide-react"

type Tab = 'giornaliero' | 'settimanale' | 'mensile'

export function ManagerPauseView() {
    const { user: authUser, isLoading: isAuthLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const authStatus = isAuthLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const [tab, setTab] = useState<Tab>('giornaliero')
    const [report, setReport] = useState<any>(null)
    const [aggReport, setAggReport] = useState<PauseAggregateReport | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [targetDate, setTargetDate] = useState(getLocalDateRome())
    const [searchQuery, setSearchQuery] = useState("")

    const fetchReport = useCallback(async () => {
        setIsLoading(true)
        try {
            if (tab === 'giornaliero') {
                const data = await getManagerPauseReport(targetDate)
                setReport(data)
                setAggReport(null)
            } else if (tab === 'settimanale') {
                const data = await getWeeklyPauseReport()
                setAggReport(data)
                setReport(null)
            } else {
                const data = await getMonthlyPauseReport()
                setAggReport(data)
                setReport(null)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }, [targetDate, tab])

    useEffect(() => {
        fetchReport()
        const poller = setInterval(fetchReport, 60000)
        return () => clearInterval(poller)
    }, [fetchReport])

    if (authStatus === "loading" || (isLoading && !report && !aggReport)) {
        return <div className="p-8 text-center text-gray-500">Avvio cruscotto di sorveglianza...</div>
    }

    if (session?.user?.role !== "ADMIN" && session?.user?.role !== "MANAGER") {
        return <div className="p-8 text-center text-red-500 font-bold">Accesso Negato: Ruolo insufficiente.</div>
    }

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        if (h > 0) return `${h}h ${m}m ${s}s`
        return `${m}m ${s}s`
    }

    const formatTime = (ts: Date) => {
        if (!ts) return "-"
        return new Date(ts).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    }

    const tabClass = (t: Tab) => `px-4 py-2 text-sm font-bold rounded-lg transition-all ${tab === t ? 'bg-brand-orange text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold border-b-2 border-brand-orange inline-block pb-1 text-gray-900">
                        Monitoraggio Pause Team
                    </h1>
                    <p className="text-sm text-gray-500 mt-2">
                        Budget giornaliero: max 30 min/giorno per GDO. Sforamenti segnalati automaticamente.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={fetchReport} className="p-2 border border-gray-200 text-gray-400 bg-white hover:text-brand-orange hover:bg-orange-50 rounded shadow-sm transition-colors">
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-brand-orange' : ''}`} />
                    </button>
                    {tab === 'giornaliero' && (
                        <input
                            type="date"
                            value={targetDate}
                            onChange={(e) => setTargetDate(e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-700 bg-white shadow-sm"
                        />
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200 w-fit">
                <button onClick={() => setTab('giornaliero')} className={tabClass('giornaliero')}>
                    <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Giornaliero</span>
                </button>
                <button onClick={() => setTab('settimanale')} className={tabClass('settimanale')}>
                    <span className="flex items-center gap-1.5"><CalendarRange className="w-3.5 h-3.5" /> Settimanale</span>
                </button>
                <button onClick={() => setTab('mensile')} className={tabClass('mensile')}>
                    <span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Mensile</span>
                </button>
            </div>

            {/* Giornaliero tab */}
            {tab === 'giornaliero' && report && (
                <DailyView
                    report={report}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    formatDuration={formatDuration}
                    formatTime={formatTime}
                />
            )}

            {/* Settimanale / Mensile tab */}
            {(tab === 'settimanale' || tab === 'mensile') && aggReport && (
                <AggregateView
                    report={aggReport}
                    label={tab === 'settimanale' ? 'Settimana Corrente' : 'Mese Corrente'}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    formatDuration={formatDuration}
                />
            )}
        </div>
    )
}

function DailyView({ report, searchQuery, setSearchQuery, formatDuration, formatTime }: {
    report: any; searchQuery: string; setSearchQuery: (v: string) => void;
    formatDuration: (s: number) => string; formatTime: (ts: Date) => string;
}) {
    const { kpi, gdoRows } = report
    const filteredRows = gdoRows.filter((g: any) =>
        g.userName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <>
            {/* KPI */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Clock className="h-6 w-6" /></div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Pause Totali</div>
                        <div className="text-2xl font-bold text-gray-900">{kpi?.totalPauses || 0}</div>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-brand-orange/10 text-brand-orange rounded-lg"><Clock className="h-6 w-6" /></div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Minuti Totali</div>
                        <div className="text-2xl font-bold text-gray-900">{kpi ? formatDuration(kpi.totalSeconds) : '0m 0s'}</div>
                    </div>
                </div>
                <div className={`p-6 rounded-xl border shadow-sm flex items-center gap-4 ${kpi?.exceededCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                    <div className={`p-3 rounded-lg ${kpi?.exceededCount > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-50 text-gray-400'}`}>
                        <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Sforamenti (30 min)</div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-gray-900">{kpi?.exceededCount || 0}</span>
                            {kpi?.exceededCount > 0 && <span className="text-sm font-mono text-red-600 font-bold">(+{formatDuration(kpi.totalExceededSeconds)})</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex items-center gap-4 bg-gray-50">
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <input type="text" placeholder="Cerca GDO..." value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:ring-brand-orange focus:border-brand-orange" />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-gray-500 font-medium">
                            <tr>
                                <th className="px-6 py-3 text-left uppercase tracking-wider">GDO</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Pause</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Totale Giorno</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Sforamento</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Stato</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredRows.length === 0 ? (
                                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">Nessuna pausa per questa data.</td></tr>
                            ) : (
                                filteredRows.map((row: any) => {
                                    const exceeded = row.totalSecondsDay > 30 * 60
                                    return (
                                        <tr key={row.gdoId} className={`hover:bg-gray-50 transition-colors ${exceeded ? 'bg-red-50/30' : ''}`}>
                                            <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{row.userName}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">{row.pausesUsed}</td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-center font-mono ${exceeded ? 'text-red-700 font-bold' : 'text-gray-700'}`}>
                                                {formatDuration(row.totalSecondsDay)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                {exceeded ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                                        <AlertTriangle className="h-3 w-3" /> +{formatDuration(row.dailyExceededSeconds || (row.totalSecondsDay - 30 * 60))}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                <div className="flex flex-col items-center gap-1">
                                                    {row.lastStatus === 'in_corso' ? (
                                                        <span className="bg-orange-100 text-orange-800 px-2.5 py-0.5 text-xs font-bold rounded animate-pulse">IN PAUSA</span>
                                                    ) : exceeded ? (
                                                        <span className="bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-bold rounded">SFORATA</span>
                                                    ) : (
                                                        <span className="bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-bold rounded">OK</span>
                                                    )}
                                                    <span className="text-xs text-gray-500">Last: {formatTime(row.lastStart)}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    )
}

function AggregateView({ report, label, searchQuery, setSearchQuery, formatDuration }: {
    report: PauseAggregateReport; label: string; searchQuery: string; setSearchQuery: (v: string) => void;
    formatDuration: (s: number) => string;
}) {
    const { rows, summary } = report
    const filtered = rows.filter(r =>
        r.gdoName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <>
            {/* Summary KPI */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><CalendarDays className="h-6 w-6" /></div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">GDO nel periodo</div>
                        <div className="text-2xl font-bold text-gray-900">{summary.totalGdos}</div>
                    </div>
                </div>
                <div className={`p-6 rounded-xl border shadow-sm flex items-center gap-4 ${summary.totalExceededDays > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                    <div className={`p-3 rounded-lg ${summary.totalExceededDays > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-50 text-gray-400'}`}>
                        <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Giorni sforati (totale)</div>
                        <div className="text-2xl font-bold text-gray-900">{summary.totalExceededDays}</div>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-brand-orange/10 text-brand-orange rounded-lg"><Clock className="h-6 w-6" /></div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Tempo sforato totale</div>
                        <div className="text-2xl font-bold text-gray-900">{formatDuration(summary.totalExceededSeconds)}</div>
                    </div>
                </div>
            </div>

            {/* Report table — one row per GDO with aggregated totals */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">{label}</h3>
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <input type="text" placeholder="Cerca GDO..." value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:ring-brand-orange focus:border-brand-orange" />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-gray-500 font-medium">
                            <tr>
                                <th className="px-6 py-3 text-left uppercase tracking-wider">GDO</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Pause totali</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Tempo totale</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Giorni lavorati</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Giorni sforati</th>
                                <th className="px-6 py-3 text-center uppercase tracking-wider">Tempo sforato</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filtered.length === 0 ? (
                                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">Nessun dato per il periodo.</td></tr>
                            ) : (
                                filtered.map((row) => (
                                    <tr key={row.gdoId} className={`hover:bg-gray-50 transition-colors ${row.daysExceeded > 0 ? 'bg-red-50/30' : ''}`}>
                                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{row.gdoName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">{row.totalPauses}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center font-mono text-gray-700">{formatDuration(row.totalSeconds)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">{row.daysWorked}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            {row.daysExceeded > 0 ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                                    <AlertTriangle className="h-3 w-3" /> {row.daysExceeded} {row.daysExceeded === 1 ? 'giorno' : 'giorni'}
                                                </span>
                                            ) : (
                                                <span className="text-emerald-600 text-xs font-bold">0</span>
                                            )}
                                        </td>
                                        <td className={`px-6 py-4 whitespace-nowrap text-center font-mono ${row.daysExceeded > 0 ? 'text-red-700 font-bold' : 'text-gray-400'}`}>
                                            {row.totalExceededSeconds > 0 ? `+${formatDuration(row.totalExceededSeconds)}` : '—'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    )
}
