"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect } from "react"
import { getAdvancedKpi, KpiFilters } from "@/app/actions/kpiAdvancedActions"
import dynamic from "next/dynamic"
import { Filter, Users, Target, PhoneMissed, Handshake } from "lucide-react"

// Lazy load Recharts heavy components
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false })
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false })
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false })
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false })
const Tooltip = dynamic(() => import("recharts").then((mod) => mod.Tooltip), { ssr: false })
const ResponsiveContainer = dynamic(() => import("recharts").then((mod) => mod.ResponsiveContainer), { ssr: false })
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), { ssr: false })
import { Cell } from "recharts"
export function KpiBoardAdvanced() {
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const status = isLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const isAdminOrManager = session?.user?.role === 'ADMIN' || session?.user?.role === 'MANAGER'

    // Default filters: last 30 days
    const [dateRange, setDateRange] = useState("30")
    const [customStart, setCustomStart] = useState("")
    const [customEnd, setCustomEnd] = useState("")

    const [funnelFilter, setFunnelFilter] = useState("ALL")
    const [gdoFilter, setGdoFilter] = useState(isAdminOrManager ? "ALL" : session?.user?.id)

    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function fetchKpi() {
            setLoading(true)
            try {
                const now = new Date()
                let start = new Date()
                let end = new Date()

                if (dateRange === "0") {
                    // Oggi
                    start.setHours(0, 0, 0, 0)
                } else if (dateRange === "7") {
                    start.setDate(now.getDate() - 7)
                } else if (dateRange === "30") {
                    start.setDate(now.getDate() - 30)
                } else if (dateRange === "CUSTOM" && customStart && customEnd) {
                    start = new Date(customStart)
                    end = new Date(customEnd)
                    end.setHours(23, 59, 59, 999)
                }

                const filters: KpiFilters = {
                    startDate: start,
                    endDate: end,
                    funnel: funnelFilter !== "ALL" ? funnelFilter : undefined,
                    gdoId: gdoFilter !== "ALL" ? gdoFilter : undefined
                }

                const res = await getAdvancedKpi(filters)
                setData(res)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        }

        // Don't auto-fetch if CUSTOM is selected but dates are missing
        if (dateRange === "CUSTOM" && (!customStart || !customEnd)) return

        fetchKpi()
    }, [dateRange, customStart, customEnd, funnelFilter, gdoFilter, session?.user?.id, isAdminOrManager])

    if (!data && loading) {
        return (
            <div className="space-y-6 max-w-7xl mx-auto animate-pulse">
                <div className="bg-white p-4 h-24 rounded-xl border border-ash-200"></div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-5 h-80 rounded-xl border border-ash-200"></div>
                    <div className="bg-white p-5 h-80 rounded-xl border border-ash-200"></div>
                    <div className="bg-white p-5 h-64 rounded-xl border border-ash-200 lg:col-span-2"></div>
                </div>
            </div>
        )
    }

    if (!data) return null

    const COLORS = ['#FFBE82', '#F0A060', '#D48840', '#A06830', '#6B3F10'];

    return (
        <div className="space-y-6 max-w-7xl mx-auto">

            {/* Toolbar Filtri */}
            <div className="bg-white p-4 rounded-xl border border-ash-200 shadow-sm flex flex-wrap gap-4 items-end">
                <div className="flex items-center gap-2 w-full text-brand-charcoal font-semibold mb-2">
                    <Filter className="h-4 w-4 text-brand-orange" />
                    Filtri Analisi
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-ash-500 font-medium">Periodo</label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-ash-300 rounded-md bg-ash-50 text-ash-700 focus:outline-none focus:ring-1 focus:ring-brand-orange"
                    >
                        <option value="0">Oggi</option>
                        <option value="7">Ultimi 7 Giorni</option>
                        <option value="30">Ultimi 30 Giorni</option>
                        <option value="CUSTOM">Personalizzato</option>
                    </select>
                </div>

                {dateRange === "CUSTOM" && (
                    <div className="flex gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-ash-500 font-medium">Da</label>
                            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-1.5 text-sm border border-ash-300 rounded-md bg-ash-50" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-ash-500 font-medium">A</label>
                            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-ash-300 rounded-md bg-ash-50" />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-ash-500 font-medium">Funnel</label>
                    <select
                        value={funnelFilter}
                        onChange={(e) => setFunnelFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-ash-300 rounded-md bg-ash-50 text-ash-700"
                    >
                        <option value="ALL">Tutti i Funnel</option>
                        {data.filtersData.funnels.map((f: string) => <option key={f} value={f}>{f}</option>)}
                    </select>
                </div>

                {isAdminOrManager && (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-ash-500 font-medium">Operatore (GDO)</label>
                        <select
                            value={gdoFilter}
                            onChange={(e) => setGdoFilter(e.target.value)}
                            className="px-3 py-1.5 text-sm border border-ash-300 rounded-md bg-ash-50 text-ash-700"
                        >
                            <option value="ALL">Tutto il Team</option>
                            {data.filtersData.gdos.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* 1. Funnel Conversione */}
                <div className="bg-white p-5 border border-ash-200 rounded-xl shadow-sm">
                    <h3 className="font-bold text-ash-800 border-b pb-2 mb-4 flex items-center gap-2">
                        <Target className="h-5 w-5 text-ash-400" />
                        Funnel di Conversione Lead
                    </h3>

                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center bg-ash-50 p-3 rounded">
                            <span className="text-ash-600 text-sm">Lead Importati / In DB</span>
                            <span className="font-bold">{data.funnelConversion.imported}</span>
                        </div>
                        <div className="flex justify-between items-center bg-brand-orange/10 p-3 rounded border border-brand-orange/20">
                            <span className="text-ash-700 text-sm">Lead Contattati (≥ 1 call)</span>
                            <span className="font-bold">{data.funnelConversion.called}</span>
                        </div>
                        <div className="flex justify-between items-center bg-blue-50 p-3 rounded border border-blue-100">
                            <span className="text-ash-700 text-sm">Lead che hanno Risposto</span>
                            <span className="font-bold">{data.funnelConversion.answered}</span>
                        </div>
                        <div className="flex justify-between items-center bg-green-50 p-3 rounded border-l-4 border-green-500">
                            <span className="text-green-800 font-semibold">Appuntamenti Fissati</span>
                            <span className="font-bold text-green-700">{data.funnelConversion.appointments}</span>
                        </div>

                        <div className="mt-4 pt-4 border-t text-center">
                            <p className="text-xs text-ash-500 uppercase tracking-wide">Tasso di Conversione (Su contattati)</p>
                            <p className="text-4xl font-black text-brand-charcoal mt-1">{data.funnelConversion.conversionRate}%</p>
                        </div>
                    </div>
                </div>

                {/* 2. Bottlenecks / Qualità Chiamate */}
                <div className="bg-white p-5 border border-ash-200 rounded-xl shadow-sm">
                    <h3 className="font-bold text-ash-800 border-b pb-2 mb-4 flex items-center gap-2">
                        <PhoneMissed className="h-5 w-5 text-red-400" />
                        Analisi Dispersioni
                    </h3>

                    <div className="grid grid-cols-2 gap-4 h-full pb-6">
                        <div className="bg-red-50/50 border border-red-100 rounded-lg p-4 flex flex-col justify-center items-center text-center">
                            <span className="text-3xl font-bold text-red-600">{data.bottlenecks.nonRispostoPerc}%</span>
                            <span className="text-xs text-red-800 font-medium mt-2 leading-tight">Delle chiamate effettuate esita in "Non Risposto"</span>
                            <span className="text-[10px] text-ash-400 mt-1">Su {data.bottlenecks.totalCalls} squilli tot.</span>
                        </div>
                        <div className="bg-gold-50/50 border border-gold-100 rounded-lg p-4 flex flex-col justify-center items-center text-center">
                            <span className="text-3xl font-bold text-gold-600">{data.bottlenecks.recallUnconvertedPerc}%</span>
                            <span className="text-xs text-gold-800 font-medium mt-2 leading-tight">Dei "Richiami" creati NON si trasforma in appuntamento</span>
                            <span className="text-[10px] text-ash-400 mt-1">Su {data.bottlenecks.totalRecalls} richiami tot.</span>
                        </div>
                    </div>
                </div>

                {/* 3. Motivi di Scarto */}
                <div className="bg-white p-5 border border-ash-200 rounded-xl shadow-sm lg:col-span-2">
                    <h3 className="font-bold text-ash-800 border-b pb-2 mb-4 flex items-center gap-2">
                        Qualità Lead: Motivi di Scarto
                    </h3>

                    {data.discardReasonsChart.length === 0 ? (
                        <div className="text-center text-ash-500 py-10">Nessun lead scartato nel periodo analizzato.</div>
                    ) : (
                        <div className="w-full h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.discardReasonsChart} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" />
                                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#8C857D' }} />
                                    <Tooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: '1px solid #E8E2DB' }} />
                                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                        {data.discardReasonsChart.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* 4. Performance GDO (Only visible if records exist) */}
                <div className="bg-white p-5 border border-ash-200 rounded-xl shadow-sm lg:col-span-2 overflow-x-auto">
                    <h3 className="font-bold text-ash-800 border-b pb-2 mb-4 flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        Performance Team (GDO)
                    </h3>
                    <table className="w-full text-left text-sm border-collapse">
                        <thead>
                            <tr className="bg-ash-50 text-ash-600 border-y border-ash-200">
                                <th className="p-3 font-semibold">Operatore</th>
                                <th className="p-3 font-semibold text-center">Chiamate</th>
                                <th className="p-3 font-semibold text-center">Risposte</th>
                                <th className="p-3 font-semibold text-center">% Risposta</th>
                                <th className="p-3 font-semibold text-center">Appuntamenti</th>
                                <th className="p-3 font-semibold text-center">% Fissaggio (Su contattati)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100">
                            {data.gdoStats.length === 0 ? (
                                <tr><td colSpan={6} className="p-4 text-center text-ash-500">Nessun dato registrato nel periodo.</td></tr>
                            ) : data.gdoStats.map((stat: any, idx: number) => (
                                <tr key={idx} className="hover:bg-ash-50 transition-colors">
                                    <td className="p-3 font-medium text-ash-800">
                                        {stat.name}
                                    </td>
                                    <td className="p-3 text-center">{stat.calls}</td>
                                    <td className="p-3 text-center">{stat.answers}</td>
                                    <td className="p-3 text-center text-ash-500">{stat.responseRate}%</td>
                                    <td className="p-3 text-center font-bold text-green-600 bg-green-50/30">{stat.appointments}</td>
                                    <td className="p-3 text-center font-bold text-brand-charcoal">{stat.apptRate}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    )
}
