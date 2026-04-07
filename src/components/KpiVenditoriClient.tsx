"use client"

import { useState, useEffect } from "react"
import { getVenditoriKpi } from "@/app/actions/kpiVenditoriActions"
import { Trophy, TrendingUp, DollarSign, Target, CalendarDays, Award, Crown, Medal } from "lucide-react"

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

    const top3 = kpiData.slice(0, 3)
    const hasTop3 = top3.length >= 3

    return (
        <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
            {/* Toolbar */}
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-soft border border-ash-200/60 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-ash-400" />
                    <div className="text-sm font-medium text-ash-600">Seleziona Periodo:</div>
                </div>
                <div className="flex bg-ash-100/80 p-1 rounded-lg text-sm font-medium">
                    {(['oggi', 'settimana', 'mese'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 rounded-md capitalize transition-all ${period === p ? 'bg-white shadow-soft text-brand-orange' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Podium for top 3 */}
            {!isLoading && hasTop3 && (
                <div className="flex items-end justify-center gap-4 py-6 animate-fade-in">
                    {/* 2nd place */}
                    <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '100ms', animationFillMode: 'backwards' }}>
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-ash-200 to-ash-300 flex items-center justify-center shadow-card border-2 border-ash-300 mb-2">
                            <Medal className="w-7 h-7 text-ash-600" />
                        </div>
                        <div className="text-sm font-bold text-ash-700 text-center max-w-[100px] truncate">{isManager || top3[1].id === currentUserId ? top3[1].name : 'Venditore'}</div>
                        <div className="text-xs text-ash-500 mt-0.5">€ {top3[1].fatturato.toLocaleString('it-IT')}</div>
                        <div className="w-20 h-20 bg-gradient-to-t from-ash-200 to-ash-100 rounded-t-lg mt-2 flex items-center justify-center">
                            <div className="text-2xl font-black text-ash-500">2°</div>
                        </div>
                    </div>
                    {/* 1st place */}
                    <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '0ms', animationFillMode: 'backwards' }}>
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gold-300 to-brand-orange-400 flex items-center justify-center shadow-glow-orange border-2 border-gold-400 mb-2">
                            <Crown className="w-9 h-9 text-white" />
                        </div>
                        <div className="text-sm font-bold text-ash-800 text-center max-w-[120px] truncate">{isManager || top3[0].id === currentUserId ? top3[0].name : 'Venditore'}</div>
                        <div className="text-xs font-semibold text-gold-600 mt-0.5">€ {top3[0].fatturato.toLocaleString('it-IT')}</div>
                        <div className="w-24 h-28 bg-gradient-to-t from-gold-200 to-gold-100 rounded-t-lg mt-2 flex items-center justify-center shadow-soft">
                            <div className="text-3xl font-black text-gold-600">1°</div>
                        </div>
                    </div>
                    {/* 3rd place */}
                    <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '200ms', animationFillMode: 'backwards' }}>
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-orange-200 to-brand-orange-300 flex items-center justify-center shadow-card border-2 border-brand-orange-300 mb-2">
                            <Medal className="w-7 h-7 text-brand-orange-700" />
                        </div>
                        <div className="text-sm font-bold text-ash-700 text-center max-w-[100px] truncate">{isManager || top3[2].id === currentUserId ? top3[2].name : 'Venditore'}</div>
                        <div className="text-xs text-ash-500 mt-0.5">€ {top3[2].fatturato.toLocaleString('it-IT')}</div>
                        <div className="w-20 h-16 bg-gradient-to-t from-brand-orange-100 to-brand-orange-50 rounded-t-lg mt-2 flex items-center justify-center">
                            <div className="text-2xl font-black text-brand-orange-500">3°</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Results Table */}
            <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-64 text-ash-400 gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange"></div>
                        <div className="text-sm">Calcolo KPI in corso...</div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-ash-200/60 text-sm text-left">
                            <thead className="bg-gradient-to-r from-ash-50 to-ash-100/50 font-medium text-ash-500 uppercase tracking-wider text-xs">
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
                            <tbody className="bg-white divide-y divide-ash-100/60">
                                {kpiData.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-ash-400">
                                            Nessun dato disponibile nel periodo.
                                        </td>
                                    </tr>
                                ) : (
                                    kpiData.map((row, idx) => {
                                        const isMe = row.id === currentUserId
                                        const showName = isManager || isMe

                                        return (
                                            <tr
                                                key={row.id}
                                                className={`transition-all duration-200 animate-fade-in ${isMe ? 'bg-brand-orange-50/30' : 'hover:bg-brand-orange-50/20'}`}
                                                style={{ animationDelay: `${Math.min(idx * 40, 400)}ms`, animationFillMode: 'backwards' }}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center gap-2 font-bold">
                                                        {row.position === 1 && <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold-300 to-gold-500 flex items-center justify-center shadow-glow-gold"><Trophy className="w-4 h-4 text-white" /></div>}
                                                        {row.position === 2 && <div className="w-7 h-7 rounded-full bg-gradient-to-br from-ash-300 to-ash-400 flex items-center justify-center shadow-soft"><Trophy className="w-4 h-4 text-white" /></div>}
                                                        {row.position === 3 && <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-orange-300 to-brand-orange-500 flex items-center justify-center shadow-soft"><Trophy className="w-4 h-4 text-white" /></div>}
                                                        {row.position > 3 && <div className="w-7 text-center text-ash-400 font-semibold">{row.position}°</div>}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap font-medium text-ash-800">
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            {showName ? row.name : `Venditore Misterioso`}
                                                            {isMe && <div className="text-[10px] bg-brand-orange-100 text-brand-orange-700 px-2 py-0.5 rounded-full font-bold border border-brand-orange-200/50">TU</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <div className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full text-base border border-emerald-200/50">
                                                        € {row.fatturato.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-ash-500">
                                                    {row.salesTargetEur != null
                                                        ? `€ ${row.salesTargetEur.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
                                                        : <div className="text-ash-300">—</div>
                                                    }
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    {row.salesTargetEur != null && row.salesTargetEur > 0 ? (
                                                        (() => {
                                                            const pct = Math.round((row.fatturato / row.salesTargetEur) * 100)
                                                            const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-gold-500' : 'bg-ember-500'
                                                            const textColor = pct >= 100 ? 'text-emerald-700' : pct >= 70 ? 'text-gold-700' : 'text-ember-600'
                                                            return (
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-24 h-2.5 bg-ash-100 rounded-full overflow-hidden">
                                                                            <div
                                                                                className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                                                                style={{ width: `${Math.min(pct, 100)}%` }}
                                                                            />
                                                                        </div>
                                                                        <div className={`text-xs font-bold ${textColor}`}>{pct}%</div>
                                                                    </div>
                                                                    {pct >= 100 && (
                                                                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200/50 animate-fade-in">
                                                                            <Award className="w-3 h-3" />
                                                                            BONUS RAGGIUNTO
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })()
                                                    ) : (
                                                        <div className="text-ash-300">—</div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-ash-800 font-bold">{row.chiusi}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-ash-500">{row.nonChiusi}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-ash-400">{row.sparito}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <div className="flex items-center justify-center gap-1.5 font-bold text-ash-800">
                                                        <Target className={`w-4 h-4 ${row.closingRate >= 20 ? 'text-emerald-500' : 'text-brand-orange-500'}`} />
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
