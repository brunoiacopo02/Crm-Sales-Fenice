"use client"

import { useState, useEffect } from "react"
import { getTeamKpiDashboard, KpiPeriod } from "@/app/actions/kpiTeamActions"
import { PhoneIncoming, PhoneOutgoing, UserPlus, Target, Clock, BarChart3, Calendar } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'

export function KpiTeamDashboard() {
    const [period, setPeriod] = useState<KpiPeriod>('oggi')
    const [funnelFilter, setFunnelFilter] = useState('ALL')
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

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

    if (loading && !data) return <div className="p-8 text-center text-ash-500 animate-pulse">Caricamento Metriche Team...</div>

    const agg = data?.aggregate || {}
    const chartData = data?.chartData || []

    return (
        <div className="space-y-8 pb-12">

            {/* Header Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-ash-100">
                <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-ash-400" />
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as KpiPeriod)}
                        className="bg-ash-50 border border-ash-200 text-ash-900 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange block w-full sm:w-40 p-2"
                    >
                        <option value="oggi">Oggi</option>
                        <option value="ieri">Ieri</option>
                        <option value="settimana">Questa Settimana</option>
                        <option value="mese">Questo Mese</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-ash-400" />
                    <select
                        value={funnelFilter}
                        onChange={(e) => setFunnelFilter(e.target.value)}
                        className="bg-ash-50 border border-ash-200 text-ash-900 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange block w-full sm:w-40 p-2"
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
            <div className="bg-white p-6 rounded-xl shadow-sm border border-ash-100">
                <h3 className="text-lg font-bold text-ash-900 mb-6 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-ash-400" />
                    Andamento Chiamate e Appuntamenti
                </h3>
                <div className="h-80 w-full">
                    {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8E2DB" />
                                <XAxis dataKey="timeLabel" stroke="#8C857D" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#8C857D" fontSize={12} tickLine={false} axisLine={false} />
                                <RechartsTooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Line type="monotone" name="Chiamate" dataKey="chiamate" stroke="#FFBE82" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                <Line type="monotone" name="Appuntamenti" dataKey="appuntamenti" stroke="#4A9D5B" strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-ash-400">Nessun dato di log nel periodo selezionato</div>
                    )}
                </div>
            </div>

        </div>
    )
}

function KpiCard({ title, value, icon: Icon, color, bg }: { title: string, value: string | number, icon: any, color: string, bg: string }) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-ash-100 p-4 sm:p-6 flex justify-between items-center hover:shadow-md transition-shadow">
            <div>
                <h3 className="text-sm font-medium text-ash-500 mb-1">{title}</h3>
                <p className="text-3xl font-bold text-ash-900">{value}</p>
            </div>
            <div className={`p-4 rounded-full ${bg} ${color}`}>
                <Icon className="h-6 w-6" />
            </div>
        </div>
    )
}
