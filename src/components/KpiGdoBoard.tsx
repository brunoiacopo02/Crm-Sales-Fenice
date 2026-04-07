"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect } from "react"
import { getAdvancedKpi, KpiFilters, getGdoTargetsProgress } from "@/app/actions/kpiAdvancedActions"
import dynamic from "next/dynamic"
import { Filter, PhoneCall, Headphones, CalendarCheck, Clock, Percent, Target, TrendingUp, ArrowUpDown } from "lucide-react"
// Lazy load Recharts heavy components
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false })
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false })
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false })
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), { ssr: false })
const Tooltip = dynamic(() => import("recharts").then((mod) => mod.Tooltip), { ssr: false })
const ResponsiveContainer = dynamic(() => import("recharts").then((mod) => mod.ResponsiveContainer), { ssr: false })
const PieChart = dynamic(() => import("recharts").then((mod) => mod.PieChart), { ssr: false })
const Pie = dynamic(() => import("recharts").then((mod) => mod.Pie), { ssr: false })
import { Cell } from "recharts"

export function KpiGdoBoard() {
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const status = isLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const isAdminOrManager = session?.user?.role === 'ADMIN' || session?.user?.role === 'MANAGER'

    // Default filters
    const [dateRange, setDateRange] = useState("0") // Default Oggi per operatività GDO
    const [customStart, setCustomStart] = useState("")
    const [customEnd, setCustomEnd] = useState("")

    const [funnelFilter, setFunnelFilter] = useState("ALL")
    // Default: Singolo GDO loggato. Se Admin, forziamo ugualmente a ID loggato, ma permettiamo la scelta
    const [gdoFilter, setGdoFilter] = useState(session?.user?.id || "ALL")

    const [data, setData] = useState<any>(null)
    const [targetsData, setTargetsData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [sortBy, setSortBy] = useState<'productivityCoeff' | 'calls' | 'appointments' | 'apptRate'>('productivityCoeff')

    useEffect(() => {
        // If session not ready or gdoFilter still not set on mount
        if (!session?.user?.id) return
        if (gdoFilter === "ALL" && !isAdminOrManager) {
            setGdoFilter(session.user.id)
            return
        }

        async function fetchKpi() {
            setLoading(true)
            try {
                const now = new Date()
                let start = new Date()
                let end = new Date()

                if (dateRange === "0") {
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

                if (gdoFilter !== "ALL") {
                    const tRes = await getGdoTargetsProgress(gdoFilter)
                    setTargetsData(tRes)
                } else {
                    setTargetsData(null)
                }
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        }

        if (dateRange === "CUSTOM" && (!customStart || !customEnd)) return

        fetchKpi()

        // Supabase Real-time Trigger in ascolto dal custom event del Topbar
        const handleRealtimeUpdate = () => fetchKpi()
        window.addEventListener('realtime_update', handleRealtimeUpdate)

        return () => window.removeEventListener('realtime_update', handleRealtimeUpdate)
    }, [dateRange, customStart, customEnd, funnelFilter, gdoFilter, session?.user?.id, isAdminOrManager])

    if (!data && loading) {
        return (
            <div className="space-y-6 max-w-7xl mx-auto animate-pulse">
                <div className="bg-white p-4 h-24 rounded-xl border border-ash-200/60 shadow-soft"></div>
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-white p-5 h-32 rounded-xl border border-ash-200/60 shadow-soft"></div>
                    ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-5 h-80 rounded-xl border border-ash-200/60 shadow-soft"></div>
                    <div className="bg-white p-5 h-80 rounded-xl border border-ash-200/60 shadow-soft"></div>
                </div>
            </div>
        )
    }

    if (!data) return null

    let totalCalls = 0
    let totalAnswers = 0
    let totalAppointments = 0
    let totalContactedLeads = 0

    if (gdoFilter === "ALL") {
        data.gdoStats.forEach((s: any) => {
            totalCalls += s.calls
            totalAnswers += s.answers
            totalAppointments += s.appointments
        })
        totalContactedLeads = data.funnelConversion.called
    } else {
        data.gdoStats.forEach((s: any) => {
            totalCalls += s.calls
            totalAnswers += s.answers
            totalAppointments += s.appointments
        })
        totalContactedLeads = totalCalls
    }

    const preciseApptRate = data.gdoStats.length === 1 ? data.gdoStats[0].apptRate :
        (totalContactedLeads > 0 ? Math.round((totalAppointments / totalContactedLeads) * 100) : 0)

    const responseRate = totalCalls > 0 ? Math.round((totalAnswers / totalCalls) * 100) : 0

    const mockTrend = [
        { name: 'Lun', chiamate: totalCalls > 10 ? Math.floor(totalCalls * 0.2) : 0, appuntamenti: totalAppointments > 2 ? 1 : 0 },
        { name: 'Mar', chiamate: totalCalls > 10 ? Math.floor(totalCalls * 0.3) : Math.floor(totalCalls / 2), appuntamenti: totalAppointments > 2 ? 2 : 0 },
        { name: 'Mer', chiamate: totalCalls > 10 ? Math.floor(totalCalls * 0.25) : 0, appuntamenti: totalAppointments > 0 ? 1 : 0 },
        { name: 'Oggi', chiamate: totalCalls > 10 ? Math.floor(totalCalls * 0.25) : Math.ceil(totalCalls / 2), appuntamenti: totalAppointments > 2 ? totalAppointments - 3 : totalAppointments },
    ]

    const mockPie = [
        { name: 'Non Risposto', value: totalCalls - totalAnswers },
        { name: 'Risposte (Richiami/Scarti)', value: totalAnswers - totalAppointments },
        { name: 'Appuntamenti', value: totalAppointments },
    ]
    const PIE_COLORS = ['#E8523F', '#C9A13C', '#22c55e']

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Toolbar Filtri Core */}
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl border border-ash-200/60 shadow-soft flex flex-wrap gap-4 items-end">
                <div className="flex items-center gap-2 w-full text-brand-charcoal font-semibold mb-2">
                    <Filter className="h-4 w-4 text-brand-orange" />
                    Filtri Operativi
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-ash-500 font-medium">Periodo</label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-ash-200/60 rounded-lg bg-ash-50/50 text-ash-700 focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-all"
                    >
                        <option value="0">Oggi (Turno Corrente)</option>
                        <option value="7">Ultimi 7 Giorni</option>
                        <option value="30">Ultimi 30 Giorni</option>
                        <option value="CUSTOM">Personalizzato</option>
                    </select>
                </div>

                {dateRange === "CUSTOM" && (
                    <div className="flex gap-2">
                        <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-1.5 text-sm border border-ash-200/60 rounded-lg bg-ash-50/50 focus:ring-2 focus:ring-brand-orange/30" />
                        <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-ash-200/60 rounded-lg bg-ash-50/50 focus:ring-2 focus:ring-brand-orange/30" />
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-ash-500 font-medium">Funnel</label>
                    <select value={funnelFilter} onChange={(e) => setFunnelFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-ash-200/60 rounded-lg bg-ash-50/50 text-ash-700 focus:ring-2 focus:ring-brand-orange/30">
                        <option value="ALL">Tutti</option>
                        {data.filtersData.funnels.map((f: string) => <option key={f} value={f}>{f}</option>)}
                    </select>
                </div>

                {isAdminOrManager && (
                    <div className="flex flex-col gap-1 ml-auto">
                        <label className="text-xs text-brand-orange font-bold uppercase tracking-wide">Modalità Manager</label>
                        <select
                            value={gdoFilter}
                            onChange={(e) => setGdoFilter(e.target.value)}
                            className="px-3 py-1.5 text-sm border-2 border-brand-orange/30 rounded-lg bg-brand-orange-50/30 text-brand-charcoal font-semibold shadow-soft focus:ring-2 focus:ring-brand-orange/30"
                        >
                            <option value={session?.user?.id}>I miei dati (Tu)</option>
                            <optgroup label="Team GDO">
                                {data.filtersData.gdos.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </optgroup>
                            <option value="ALL">🔥 Team Intero (Aggregato)</option>
                        </select>
                    </div>
                )}
            </div>

            {/* TARGETS WIDGETS */}
            {targetsData && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex items-center gap-4 relative overflow-hidden group hover:shadow-card transition-all duration-200">
                        <div className="h-full absolute left-0 top-0 w-1 bg-gradient-to-b from-brand-orange to-brand-orange-600"></div>
                        <div className="h-12 w-12 rounded-xl bg-brand-orange-50 flex items-center justify-center shrink-0">
                            <Target className="h-6 w-6 text-brand-orange" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-xs font-bold text-ash-500 uppercase tracking-wider">Target Appuntamenti (Oggi)</h3>
                            <div className="flex items-end gap-2 mt-1">
                                <div className="text-3xl font-black text-brand-charcoal">{targetsData.todayAppointments}</div>
                                <div className="text-xl font-bold text-ash-400 mb-0.5">/ {targetsData.dailyApptTarget}</div>
                            </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end">
                            <div className={`text-sm font-bold ${targetsData.todayAppointments >= targetsData.dailyApptTarget ? 'text-emerald-600' : 'text-brand-orange-500'}`}>
                                {targetsData.todayAppointments >= targetsData.dailyApptTarget ? 'Raggiunto!' : 'In Corso'}
                            </div>
                            <div className="w-24 h-2.5 bg-ash-100 rounded-full mt-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${targetsData.todayAppointments >= targetsData.dailyApptTarget ? 'bg-emerald-500' : 'bg-brand-orange'}`}
                                    style={{ width: `${Math.min((targetsData.todayAppointments / (targetsData.dailyApptTarget || 1)) * 100, 100)}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex items-center gap-4 relative overflow-hidden group hover:shadow-card transition-all duration-200">
                        <div className="h-full absolute left-0 top-0 w-1 bg-gradient-to-b from-emerald-500 to-emerald-600"></div>
                        <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                            <CalendarCheck className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-xs font-bold text-ash-500 uppercase tracking-wider">Target Confermati (Settimanali)</h3>
                            <div className="flex items-end gap-2 mt-1">
                                <div className="text-3xl font-black text-brand-charcoal">{targetsData.weeklyConfirmed}</div>
                                <div className="text-xl font-bold text-ash-400 mb-0.5">/ {targetsData.weeklyConfirmedTarget}</div>
                            </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end">
                            <div className={`text-sm font-bold ${targetsData.weeklyConfirmed >= targetsData.weeklyConfirmedTarget ? 'text-emerald-600' : 'text-emerald-500/70'}`}>
                                {targetsData.weeklyConfirmed >= targetsData.weeklyConfirmedTarget ? 'Raggiunto!' : 'In Corso'}
                            </div>
                            <div className="w-24 h-2.5 bg-ash-100 rounded-full mt-2 overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                                    style={{ width: `${Math.min((targetsData.weeklyConfirmed / (targetsData.weeklyConfirmedTarget || 1)) * 100, 100)}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* BIG CARDS ROW */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex flex-col items-center justify-center text-center group hover:shadow-card transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-ash-100 flex items-center justify-center mb-2 group-hover:bg-ash-200 transition-colors">
                        <PhoneCall className="h-5 w-5 text-ash-500" />
                    </div>
                    <div className="text-sm text-ash-500 font-medium">Chiamate</div>
                    <div className="text-3xl font-black text-brand-charcoal mt-1">{totalCalls}</div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex flex-col items-center justify-center text-center group hover:shadow-card transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-2 group-hover:bg-blue-100 transition-colors">
                        <Headphones className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="text-sm text-ash-500 font-medium">Risposte</div>
                    <div className="text-3xl font-black text-blue-600 mt-1">{totalAnswers}</div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex flex-col items-center justify-center text-center group hover:shadow-card transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-ash-100 flex items-center justify-center mb-2 group-hover:bg-ash-200 transition-colors">
                        <Percent className="h-5 w-5 text-ash-500" />
                    </div>
                    <div className="text-sm text-ash-500 font-medium">Tasso Risposta</div>
                    <div className="text-3xl font-black text-brand-charcoal mt-1">{responseRate}%</div>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/30 p-5 rounded-xl border border-emerald-200/50 shadow-soft flex flex-col items-center justify-center text-center group hover:shadow-card transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mb-2">
                        <CalendarCheck className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="text-sm text-emerald-700 font-bold">Appuntamenti</div>
                    <div className="text-3xl font-black text-emerald-700 mt-1">{totalAppointments}</div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-ash-200/60 shadow-soft flex flex-col items-center justify-center text-center group hover:shadow-card transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center mb-2 group-hover:bg-purple-100 transition-colors">
                        <Clock className="h-5 w-5 text-purple-500" />
                    </div>
                    <div className="text-sm text-ash-500 font-medium">Chiamate/Ora</div>
                    <div className="text-3xl font-black text-purple-600 mt-1">{(totalCalls / 6.5).toFixed(1)}</div>
                    <div className="text-xs text-ash-400 mt-0.5">su 6.5h</div>
                </div>

                <div className="bg-gradient-to-br from-brand-charcoal to-ash-900 p-5 rounded-xl border border-ash-800 shadow-elevated flex flex-col items-center justify-center text-center">
                    <div className="w-10 h-10 rounded-xl bg-brand-orange/20 flex items-center justify-center mb-2">
                        <Target className="h-5 w-5 text-brand-orange" />
                    </div>
                    <div className="text-sm text-ash-400 font-medium">% Fissaggio (Su Lead)</div>
                    <div className="text-3xl font-black text-white mt-1">{preciseApptRate}%</div>
                </div>
            </div>

            {/* GRAPHS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                <div className="bg-white p-5 border border-ash-200/60 rounded-xl shadow-soft h-80 flex flex-col group hover:shadow-card transition-all duration-200">
                    <h3 className="font-bold text-ash-800 border-b border-ash-200/60 pb-2 mb-4">Trend Appuntamenti VS Chiamate</h3>
                    <div className="flex-1 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={mockTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8E4E0" />
                                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#8A7F76' }} />
                                <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#8A7F76' }} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#8A7F76' }} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E8E4E0', boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)' }} />
                                <Line yAxisId="left" type="monotone" dataKey="chiamate" stroke="#B09E92" strokeWidth={2} name="Totale Chiamate" dot={false} />
                                <Line yAxisId="right" type="monotone" dataKey="appuntamenti" stroke="#22c55e" strokeWidth={3} name="Appuntamenti Fissati" activeDot={{ r: 6, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-5 border border-ash-200/60 rounded-xl shadow-soft h-80 flex flex-col group hover:shadow-card transition-all duration-200">
                    <h3 className="font-bold text-ash-800 border-b border-ash-200/60 pb-2 mb-4">Breakdown Esiti Chiamata</h3>
                    <div className="flex-1 w-full flex items-center justify-center">
                        {totalCalls === 0 ? (
                            <div className="text-ash-400 text-sm">Nessun dato relativo ad esiti da visualizzare</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={mockPie} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                                        {mockPie.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E8E4E0' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    {totalCalls > 0 && (
                        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-ash-600">
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-ember-400"></div> Non Risp.</div>
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-gold-400"></div> Risposte Call</div>
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Fissati</div>
                        </div>
                    )}
                </div>

            </div>

            {/* CLASSIFICA PRODUTTIVITÀ GDO */}
            {data.gdoStats.length > 0 && (
                <div className="bg-white p-5 border border-ash-200/60 rounded-xl shadow-soft">
                    <div className="flex items-center justify-between mb-4 border-b border-ash-200/60 pb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-brand-orange" />
                            <h3 className="font-bold text-ash-800">Classifica Produttività GDO</h3>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-ash-500">
                            <ArrowUpDown className="h-3 w-3" />
                            <div>Ordina per:</div>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                                className="px-2 py-1 text-xs border border-ash-200/60 rounded-lg bg-ash-50/50 text-ash-700 focus:ring-2 focus:ring-brand-orange/30"
                            >
                                <option value="productivityCoeff">Coefficiente</option>
                                <option value="calls">Chiamate</option>
                                <option value="appointments">Appuntamenti</option>
                                <option value="apptRate">% Fissaggio</option>
                            </select>
                        </div>
                    </div>
                    <div className="text-xs text-ash-400 mb-3">
                        Formula: (Chiamate / 6.5h) × (% Fissaggio / 100) — Ore lavorate fisse: 6.5h (13:30-20:00)
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ash-200/60 text-left">
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold">#</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold">GDO</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Chiamate</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Lead Contattati</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Appuntamenti</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">% Fissaggio</th>
                                    <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Chiamate/Ora</th>
                                    <th className="pb-2 text-ash-500 font-semibold text-right">Coefficiente</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.gdoStats]
                                    .sort((a: any, b: any) => b[sortBy] - a[sortBy])
                                    .map((gdo: any, idx: number) => {
                                        const isTop = idx === 0 && data.gdoStats.length > 1
                                        return (
                                            <tr key={gdo.name} className={`border-b border-ash-100/60 transition-all duration-200 hover:bg-brand-orange-50/20 ${isTop ? 'bg-brand-orange-50/30' : ''}`}>
                                                <td className="py-2.5 pr-3 font-bold text-ash-400">
                                                    {idx === 0 && data.gdoStats.length > 1 ? (
                                                        <div className="text-brand-orange font-black">1</div>
                                                    ) : idx + 1}
                                                </td>
                                                <td className="py-2.5 pr-3 font-semibold text-brand-charcoal">
                                                    {gdo.name}
                                                </td>
                                                <td className="py-2.5 pr-3 text-right text-ash-700">{gdo.calls}</td>
                                                <td className="py-2.5 pr-3 text-right text-ash-700">{gdo.contactedLeads}</td>
                                                <td className="py-2.5 pr-3 text-right text-emerald-700 font-semibold">{gdo.appointments}</td>
                                                <td className="py-2.5 pr-3 text-right text-ash-700">{gdo.apptRate}%</td>
                                                <td className="py-2.5 pr-3 text-right text-ash-700">{gdo.callsPerHour}</td>
                                                <td className="py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <div className="w-16 h-2.5 bg-ash-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-700 ${gdo.productivityCoeff >= 2 ? 'bg-emerald-500' : gdo.productivityCoeff >= 1 ? 'bg-gold-500' : 'bg-ember-400'}`}
                                                                style={{ width: `${Math.min((gdo.productivityCoeff / (Math.max(...data.gdoStats.map((s: any) => s.productivityCoeff), 1))) * 100, 100)}%` }}
                                                            ></div>
                                                        </div>
                                                        <div className={`font-black ${gdo.productivityCoeff >= 2 ? 'text-emerald-600' : gdo.productivityCoeff >= 1 ? 'text-gold-600' : 'text-ember-500'}`}>
                                                            {gdo.productivityCoeff.toFixed(2)}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

        </div>
    )
}
