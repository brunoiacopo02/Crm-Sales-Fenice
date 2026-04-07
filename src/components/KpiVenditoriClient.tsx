"use client"

import { useState, useEffect } from "react"
import { getVenditoriKpi } from "@/app/actions/kpiVenditoriActions"
import { Trophy, TrendingUp, DollarSign, Target, CalendarDays, Award } from "lucide-react"

interface KpiVenditoriClientProps {
    currentUserRole: string
    currentUserId: string
}

export function KpiVenditoriClient({ currentUserRole, currentUserId }: KpiVenditoriClientProps) {
    const [period, setPeriod] = useState<'oggi' | 'settimana' | 'mese' | 'custom'>('mese')
    const [kpiData, setKpiData] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const isManager = currentUserRole === 'MANAGER' || currentUserRole === 'ADMIN'

    const fetchKpi = async () => {
        setIsLoading(true)
        try {
            const data = await getVenditoriKpi(period)
            setKpiData(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchKpi()
    }, [period])

    return (
        <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
            {/* Toolbar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Seleziona Periodo:</span>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg text-sm font-medium">
                    {(['oggi', 'settimana', 'mese'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 rounded-md capitalize transition-all ${period === p ? 'bg-white shadow-sm text-brand-orange' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {isLoading ? (
                    <div className="flex justify-center items-center h-64 text-gray-500">Calcolo KPI in corso...</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm text-left">
                            <thead className="bg-gray-50 font-medium text-gray-500 uppercase tracking-wider text-xs">
                                <tr>
                                    <th scope="col" className="px-6 py-4">Posizione</th>
                                    <th scope="col" className="px-6 py-4">Venditore</th>
                                    <th scope="col" className="px-6 py-4 text-center">Fatturato</th>
                                    <th scope="col" className="px-6 py-4 text-center">Target</th>
                                    <th scope="col" className="px-6 py-4 text-center">Progresso</th>
                                    <th scope="col" className="px-6 py-4 text-center">Chiusi</th>
                                    <th scope="col" className="px-6 py-4 text-center">Non Chiusi</th>
                                    <th scope="col" className="px-6 py-4 text-center">Spariti</th>
                                    <th scope="col" className="px-6 py-4 text-center">Closing Rate</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {kpiData.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                                            Nessun dato disponibile nel periodo.
                                        </td>
                                    </tr>
                                ) : (
                                    kpiData.map((row) => {
                                        const isMe = row.id === currentUserId
                                        const showName = isManager || isMe // Se non sei manager e non sei tu, potresti oscurarlo? Wait, requirement: "venditore vede classifica team venditori se permesso, altrimenti solo la sua + ranking anonimo: chiedi se serve". I'll show names for now.

                                        return (
                                            <tr key={row.id} className={`transition-colors ${isMe ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center gap-2 font-bold">
                                                        {row.position === 1 && <Trophy className="w-5 h-5 text-yellow-500" />}
                                                        {row.position === 2 && <Trophy className="w-5 h-5 text-gray-400" />}
                                                        {row.position === 3 && <Trophy className="w-5 h-5 text-amber-600" />}
                                                        {row.position > 3 && <span className="w-5 text-center text-gray-400">{row.position}°</span>}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                                                    <div className="flex flex-col">
                                                        <span className="flex items-center gap-2">
                                                            {showName ? row.name : `Venditore Misterioso`}
                                                            {isMe && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">TU</span>}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className="inline-flex items-center gap-1 font-bold text-green-700 bg-green-50 px-3 py-1 rounded-full text-base">
                                                        € {row.fatturato.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-500">
                                                    {row.salesTargetEur != null
                                                        ? `€ ${row.salesTargetEur.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
                                                        : <span className="text-gray-300">—</span>
                                                    }
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    {row.salesTargetEur != null && row.salesTargetEur > 0 ? (
                                                        (() => {
                                                            const pct = Math.round((row.fatturato / row.salesTargetEur) * 100)
                                                            const barColor = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                                                            const textColor = pct >= 100 ? 'text-green-700' : pct >= 70 ? 'text-yellow-700' : 'text-red-600'
                                                            return (
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-24 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                                                            <div
                                                                                className={`h-full rounded-full transition-all ${barColor}`}
                                                                                style={{ width: `${Math.min(pct, 100)}%` }}
                                                                            />
                                                                        </div>
                                                                        <span className={`text-xs font-bold ${textColor}`}>{pct}%</span>
                                                                    </div>
                                                                    {pct >= 100 && (
                                                                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                                                                            <Award className="w-3 h-3" />
                                                                            BONUS RAGGIUNTO
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })()
                                                    ) : (
                                                        <span className="text-gray-300">—</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-900 font-bold">{row.chiusi}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-600">{row.nonChiusi}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-400">{row.sparito}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <div className="flex items-center justify-center gap-1.5 font-bold text-gray-900">
                                                        <Target className={`w-4 h-4 ${row.closingRate >= 20 ? 'text-green-500' : 'text-orange-500'}`} />
                                                        {row.closingRate}%
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
