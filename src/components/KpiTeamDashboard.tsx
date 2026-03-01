"use client"

import { useState, useEffect } from "react"
import { getTeamKpiDashboard, KpiPeriod } from "@/app/actions/kpiTeamActions"
import { Phone, PhoneIncoming, PhoneOutgoing, UserPlus, Target, Clock, Trophy, BarChart3, Search, Calendar, ChevronRight } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'

export function KpiTeamDashboard() {
    const [period, setPeriod] = useState<KpiPeriod>('oggi')
    const [funnelFilter, setFunnelFilter] = useState('ALL')
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)
    const [selectedGdoId, setSelectedGdoId] = useState<string | null>(null) // Per eventuale Drawer

    useEffect(() => {
        let isMounted = true
        setLoading(true)

        getTeamKpiDashboard(period, funnelFilter).then(res => {
            if (isMounted) {
                setData(res)
                setLoading(false)
            }
        }).catch(err => {
            console.error(err)
            if (isMounted) setLoading(false)
        })

        return () => { isMounted = false }
    }, [period, funnelFilter])

    if (loading && !data) return <div className="p-8 text-center text-gray-500 animate-pulse">Caricamento Metriche Team...</div>

    const agg = data?.aggregate || {}
    const chartData = data?.chartData || []
    const ranking = data?.ranking || []

    const selectedGdoDetails = ranking.find((r: any) => r.userId === selectedGdoId)

    return (
        <div className="space-y-8 pb-12">

            {/* Header Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-gray-400" />
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as KpiPeriod)}
                        className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange block w-40 p-2"
                    >
                        <option value="oggi">Oggi</option>
                        <option value="ieri">Ieri</option>
                        <option value="settimana">Questa Settimana</option>
                        <option value="mese">Questo Mese</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-gray-400" />
                    <select
                        value={funnelFilter}
                        onChange={(e) => setFunnelFilter(e.target.value)}
                        className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange block w-40 p-2"
                    >
                        <option value="ALL">Tutti i Funnel</option>
                        <option value="Inbound">Inbound</option>
                        <option value="Outbound">Outbound</option>
                        <option value="Sconosciuto">Sconosciuto</option>
                    </select>
                </div>
            </div>

            {/* Top 6 KPI Cards (Aggregate) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <KpiCard title="Chiamate (Team)" value={agg.totalCalls} icon={PhoneOutgoing} color="text-amber-600" bg="bg-amber-50" />
                <KpiCard title="Risposte (Team)" value={agg.totalAnswers} icon={PhoneIncoming} color="text-green-600" bg="bg-green-50" />
                <KpiCard title="Tasso di Risposta" value={`${agg.teamAnswerRate}%`} icon={BarChart3} color="text-emerald-600" bg="bg-emerald-50" />
                <KpiCard title="Appuntamenti (Team)" value={agg.totalAppointments} icon={UserPlus} color="text-brand-orange" bg="bg-orange-50" />
                <KpiCard title="% Fissaggio Team" value={`${agg.teamConversionRate}%`} icon={Target} color="text-pink-600" bg="bg-pink-50" />
                <KpiCard title="Chiamate / Ora (Media)" value={agg.teamCallsPerHour} icon={Clock} color="text-blue-600" bg="bg-blue-50" />
            </div>

            {/* Trend Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-gray-400" />
                    Andamento Chiamate e Appuntamenti
                </h3>
                <div className="h-80 w-full">
                    {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis dataKey="timeLabel" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                <RechartsTooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Line type="monotone" name="Chiamate" dataKey="chiamate" stroke="#FFBE82" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                <Line type="monotone" name="Appuntamenti" dataKey="appuntamenti" stroke="#10B981" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400">Nessun dato di log nel periodo selezionato</div>
                    )}
                </div>
            </div>

            {/* Ranking GDO */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-amber-500" />
                        Classifica GDO (Ranking)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operatore GDO</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Chiamate</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Tasso Risp.</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Appuntamenti</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">% Fissaggio</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Azione</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {ranking.length > 0 ? (
                                ranking.map((r: any, idx: number) => (
                                    <tr key={r.userId} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setSelectedGdoId(r.userId)}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-400">
                                            {idx + 1}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange font-bold text-xs ring-1 ring-brand-orange/20">
                                                    {r.displayName.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div className="ml-3">
                                                    <div className="text-sm font-bold text-gray-900">{r.displayName}</div>
                                                    <div className="text-xs text-gray-500">Codice: {r.gdoCode || '??'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{r.calls}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{r.answerRate}%</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-600">{r.appointments}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-pink-600 font-medium">{r.conversionRate}%</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button className="text-brand-orange hover:text-orange-700 bg-orange-50 p-2 rounded-lg" title="Esamina Analitiche">
                                                <Search className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">Nessun dato disponibile nel periodo selezionato.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Quick Analytics Modal overlay (Lightweight) */}
            {selectedGdoDetails && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm" onClick={() => setSelectedGdoId(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="absolute top-0 right-0 p-4">
                            <button onClick={() => setSelectedGdoId(null)} className="text-gray-400 hover:text-gray-600">
                                <span className="sr-only">Close</span>
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-16 w-16 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange text-xl font-bold ring-2 ring-brand-orange/20">
                                {selectedGdoDetails.displayName.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">{selectedGdoDetails.displayName}</h3>
                                <p className="text-sm text-gray-500">Account GDO {selectedGdoDetails.gdoCode || ''}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Volumi</div>
                                <div className="font-bold text-2xl text-gray-900">{selectedGdoDetails.calls} <span className="text-sm font-normal text-gray-500">chiamate</span></div>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Conversioni</div>
                                <div className="font-bold text-2xl text-green-600">{selectedGdoDetails.appointments} <span className="text-sm font-normal text-gray-500">fissati</span></div>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Qualità</div>
                                <div className="font-bold text-2xl text-brand-orange">{selectedGdoDetails.conversionRate}% <span className="text-sm font-normal text-gray-500">fissaggio</span></div>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Ritmo</div>
                                <div className="font-bold text-2xl text-blue-600">{selectedGdoDetails.callsPerHour} <span className="text-sm font-normal text-gray-500">all'ora</span></div>
                            </div>
                        </div>

                        <div className="mt-6 pt-6 border-t border-gray-100 text-center">
                            <p className="text-xs text-gray-400">Questa è una vista aggregata isolata. Per analizzare i lead specifici, utilizza <br />il pannello di "Analisi Qualità" incrociando i filtri.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function KpiCard({ title, value, icon: Icon, color, bg }: { title: string, value: string | number, icon: any, color: string, bg: string }) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex justify-between items-center hover:shadow-md transition-shadow">
            <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">{title}</h3>
                <p className="text-3xl font-bold text-gray-900">{value}</p>
            </div>
            <div className={`p-4 rounded-full ${bg} ${color}`}>
                <Icon className="h-6 w-6" />
            </div>
        </div>
    )
}
