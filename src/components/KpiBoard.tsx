"use client"

import { useState, useEffect } from "react"
import { getDailyKpi, KpiData } from "@/app/actions/kpiActions"
import { BarChart3, PhoneCall, PhoneForwarded, Target, Ban, Clock } from "lucide-react"

export function KpiBoard() {
    const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0])
    const [data, setData] = useState<KpiData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function loadKpi() {
            setLoading(true)
            try {
                const result = await getDailyKpi(dateStr)
                setData(result)
            } catch (e) {
                console.error("Failed to load KPI", e)
            } finally {
                setLoading(false)
            }
        }
        loadKpi()
    }, [dateStr])

    const renderSkeleton = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-6 h-32">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
                    <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
            ))}
        </div>
    )

    return (
        <div className="space-y-8 max-w-6xl mx-auto">

            {/* Header and Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-orange/10 rounded-lg">
                        <BarChart3 className="h-6 w-6 text-brand-orange" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Performance Overview</h2>
                        <p className="text-sm text-gray-500">Statistiche calcolate in base ai log esiti salvati nel sistema.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-gray-600">Seleziona Data:</label>
                    <input
                        type="date"
                        value={dateStr}
                        onChange={(e) => setDateStr(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-brand-orange focus:border-brand-orange text-sm text-gray-700"
                    />
                </div>
            </div>

            {loading || !data ? renderSkeleton() : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    {/* Card 1: Chiamate Totali */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm relative overflow-hidden group">
                        <div className="absolute right-0 top-0 w-24 h-24 bg-blue-50 rounded-bl-[100px] -z-10 transition-transform group-hover:scale-110"></div>
                        <div className="flex justify-between items-start mb-4">
                            <p className="text-sm font-medium text-gray-500">Chiamate Effettuate</p>
                            <PhoneCall className="h-5 w-5 text-blue-500" />
                        </div>
                        <p className="text-3xl font-bold text-gray-800">{data.totalCalls}</p>
                        <p className="text-xs text-blue-600 font-medium mt-2">Volume totale tentativi</p>
                    </div>

                    {/* Card 2: Risposte */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm relative overflow-hidden group">
                        <div className="absolute right-0 top-0 w-24 h-24 bg-purple-50 rounded-bl-[100px] -z-10 transition-transform group-hover:scale-110"></div>
                        <div className="flex justify-between items-start mb-4">
                            <p className="text-sm font-medium text-gray-500">Risposte Ricevute</p>
                            <PhoneForwarded className="h-5 w-5 text-purple-500" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-bold text-gray-800">{data.totalAnswers}</p>
                            <span className="text-sm font-semibold text-gray-400">
                                ({data.totalCalls > 0 ? Math.round((data.totalAnswers / data.totalCalls) * 100) : 0}%)
                            </span>
                        </div>
                        <p className="text-xs text-purple-600 font-medium mt-2">Esclusi i "Non risposto"</p>
                    </div>

                    {/* Card 3: Appuntamenti */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm relative overflow-hidden group border-b-4 border-b-green-500">
                        <div className="absolute right-0 top-0 w-24 h-24 bg-green-50 rounded-bl-[100px] -z-10 transition-transform group-hover:scale-110"></div>
                        <div className="flex justify-between items-start mb-4">
                            <p className="text-sm font-medium text-gray-500">Appuntamenti Presi</p>
                            <Target className="h-5 w-5 text-green-500" />
                        </div>
                        <p className="text-3xl font-bold text-gray-800">{data.totalAppointments}</p>
                        <p className="text-xs text-green-600 font-medium mt-2">Obiettivo primario raggiunto</p>
                    </div>

                    {/* Card 4: Conversion Rate */}
                    <div className="bg-brand-charcoal rounded-xl border border-gray-800 p-6 shadow-sm relative overflow-hidden">
                        <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-bl-[100px] pointer-events-none"></div>
                        <p className="text-sm font-medium text-gray-400 mb-4">Tasso di Conversione</p>
                        <p className="text-4xl font-black text-brand-orange">{data.conversionRate}</p>
                        <p className="text-xs text-gray-400 mt-2">Appuntamenti / Chiamate Totali</p>
                    </div>

                    {/* Card 5: Scartati */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-center">
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-sm font-medium text-gray-500">Lead Scartati</p>
                                <p className="text-2xl font-bold text-gray-800 mt-1">{data.totalRejected}</p>
                            </div>
                            <div className="p-3 bg-red-50 rounded-full">
                                <Ban className="h-6 w-6 text-red-500" />
                            </div>
                        </div>
                    </div>

                    {/* Card 6: Tempo Lavorato */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-center">
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-sm font-medium text-gray-500">Tempo Attivo (stima)</p>
                                <p className="text-2xl font-bold text-gray-800 mt-1">{data.hoursWorked}</p>
                            </div>
                            <div className="p-3 bg-gray-100 rounded-full">
                                <Clock className="h-6 w-6 text-gray-600" />
                            </div>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-3 text-right">Calcolato da 1ª ad ultima call</p>
                    </div>

                </div>
            )}

        </div>
    )
}
