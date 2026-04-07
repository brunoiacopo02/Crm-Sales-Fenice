"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect, useCallback } from "react"
import { getManagerPauseReport } from "@/app/actions/pauseActions"
import { getLocalDateRome } from "@/lib/pauseUtils"
import { Search, Clock, AlertTriangle, RefreshCw } from "lucide-react"

export function ManagerPauseView() {
    const { user: authUser, isLoading: isAuthLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const authStatus = isAuthLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const [report, setReport] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [targetDate, setTargetDate] = useState(getLocalDateRome())
    const [searchQuery, setSearchQuery] = useState("")

    const fetchReport = useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await getManagerPauseReport(targetDate)
            setReport(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }, [targetDate])

    useEffect(() => {
        fetchReport()
        const poller = setInterval(fetchReport, 60000) // refresh 1 min
        return () => clearInterval(poller)
    }, [fetchReport])

    if (authStatus === "loading" || (isLoading && !report)) {
        return <div className="p-8 text-center text-gray-500">Avvio cruscotto di sorveglianza...</div>
    }

    if (session?.user?.role !== "ADMIN" && session?.user?.role !== "MANAGER") {
        return <div className="p-8 text-center text-red-500 font-bold">Accesso Negato: Ruolo insufficiente.</div>
    }

    const { kpi, gdoRows } = report || { kpi: null, gdoRows: [] }

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

    const filteredRows = gdoRows.filter((g: any) =>
        g.userName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold border-b-2 border-brand-orange inline-block pb-1 text-gray-900">
                        Monitoraggio Pause Team
                    </h1>
                    <p className="text-sm text-gray-500 mt-2">
                        Supervisione in real-time dei break giornalieri dei GDO (limite {15} min).
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={fetchReport} className="p-2 border border-gray-200 text-gray-400 bg-white hover:text-brand-orange hover:bg-orange-50 rounded shadow-sm transition-colors">
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-brand-orange' : ''}`} />
                    </button>
                    <input
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                        className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-700 bg-white shadow-sm"
                    />
                </div>
            </div>

            {/* KPI Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                        <Clock className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Pause Totali</div>
                        <div className="text-2xl font-bold text-gray-900">{kpi?.totalPauses || 0}</div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-brand-orange/10 text-brand-orange rounded-lg">
                        <Clock className="h-6 w-6" />
                    </div>
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
                        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Sforamenti Odierni</div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-gray-900">{kpi?.exceededCount || 0}</span>
                            {kpi?.exceededCount > 0 && <span className="text-sm font-mono text-red-600 font-bold">(+{formatDuration(kpi.totalExceededSeconds)})</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Table Area */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4 bg-gray-50">
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Cerca GDO..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:ring-brand-orange focus:border-brand-orange"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-gray-500 font-medium">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left uppercase tracking-wider">Membro GDO</th>
                                <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Pause Usate</th>
                                <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Durata Totale</th>
                                <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Abusi/Extra</th>
                                <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Turno / Stato</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredRows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        Nessuna pausa registrata per questa data.
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.map((row: any) => (
                                    <tr key={row.gdoId} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                                            {row.userName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">
                                            {row.pausesUsed}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700 font-mono">
                                            {formatDuration(row.totalSecondsDay)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            {row.exceededCount > 0 ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                                    <AlertTriangle className="h-3 w-3" /> {row.exceededCount}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                {row.lastStatus === 'in_corso' ? (
                                                    <span className="bg-orange-100 text-orange-800 px-2.5 py-0.5 text-xs font-bold rounded animate-pulse">
                                                        IN PAUSA
                                                    </span>
                                                ) : row.lastStatus === 'sforata' ? (
                                                    <span className="bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-bold rounded">
                                                        SFORATA
                                                    </span>
                                                ) : (
                                                    <span className="bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-bold rounded">
                                                        OPERATIVO
                                                    </span>
                                                )}
                                                <span className="text-xs text-gray-500">
                                                    Last: {formatTime(row.lastStart)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
