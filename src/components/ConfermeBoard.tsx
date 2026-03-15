"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, AlertCircle, PhoneOff } from "lucide-react"
import { getConfermeAppointments, updateLeadDataConferme } from "@/app/actions/confermeActions"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { ConfermeDrawer } from "@/components/ConfermeDrawer"
import { GlobalAlertListener } from "@/components/GlobalAlertListener"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"

type LeadData = any;

const KANBAN_HOURS_OGGI = Array.from({ length: 9 }, (_, i) => `${(i + 13).toString().padStart(2, '0')}:00`); // 13:00 to 21:00
const KANBAN_HOURS_DOMANI = Array.from({ length: 6 }, (_, i) => `${(i + 9).toString().padStart(2, '0')}:00`); // 09:00 to 14:00

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')

    // Dataset
    const [kanbanData, setKanbanData] = useState<{ flatList: LeadData[], daDefinire: LeadData[] }>({ flatList: [], daDefinire: [] })
    const [tableData, setTableData] = useState<LeadData[]>([])

    const [loading, setLoading] = useState(true)

    // Table Filters
    const [searchQuery, setSearchQuery] = useState("")
    const [dateRange, setDateRange] = useState<{ start?: Date, end?: Date }>({
        start: new Date(new Date().setHours(0, 0, 0, 0)),
        end: new Date(new Date().setHours(23, 59, 59, 999)),
    })
    const [datePreset, setDatePreset] = useState("today")

    // Drawer state
    const [selectedLead, setSelectedLead] = useState<LeadData | null>(null)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    // Presence
    const [globalPresence, setGlobalPresence] = useState<any[]>([])

    const fetchLeads = async () => {
        setLoading(true)
        try {
            if (viewMode === 'kanban') {
                const data = await getConfermeAppointments({
                    fetchMode: "strict_kanban" // Automatically ignores dates
                })
                setKanbanData({ flatList: data.flatList, daDefinire: data.daDefinire })
            } else {
                const data = await getConfermeAppointments({
                    fetchMode: "all",
                    startDate: dateRange.start,
                    endDate: dateRange.end,
                    timeSlot: "tutto",
                    searchQuery,
                    confermeStatus: "tutti"
                })
                setTableData(data.flatList)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    const loadPresence = async () => {
        try {
            const data = await getGlobalPresence()
            setGlobalPresence(data)
        } catch (e) { }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads()
        }, 400)
        return () => clearTimeout(timer)
    }, [viewMode, searchQuery, dateRange])

    useEffect(() => {
        const interval = setInterval(() => {
            loadPresence()
            if (viewMode === 'kanban') fetchLeads(); // keep kanban updated lightly
        }, 10000)
        return () => clearInterval(interval)
    }, [viewMode])

    const handleDatePreset = (preset: string) => {
        setDatePreset(preset)
        const now = new Date()
        if (preset === "today") {
            setDateRange({ start: new Date(now.setHours(0, 0, 0, 0)), end: new Date(now.setHours(23, 59, 59, 999)) })
        } else if (preset === "tomorrow") {
            const tmr = addDays(now, 1)
            setDateRange({ start: new Date(tmr.setHours(0, 0, 0, 0)), end: new Date(tmr.setHours(23, 59, 59, 999)) })
        } else if (preset === "7days") {
            const start = subDays(now, 7)
            setDateRange({ start: new Date(start.setHours(0, 0, 0, 0)), end: new Date(now.setHours(23, 59, 59, 999)) })
        } else if (preset === "all") {
            setDateRange({ start: undefined, end: undefined })
        }
    }

    const handleQuickNR = async (e: React.MouseEvent, leadItem: LeadData) => {
        e.stopPropagation()
        // Here we could implement a quick NR action directly without opening drawer
        // But drawer is safer for business logic. Let's just open drawer for now or add direct server action.
        setSelectedLead(leadItem)
        setIsDrawerOpen(true)
    }

    // --- KANBAN LOGIC ---
    const renderLeadCard = (item: LeadData) => {
        const lead = item.lead
        const isLocked = globalPresence.some(p => p.leadId === lead.id && p.user.id !== currentUser.id)

        return (
            <div
                key={lead.id}
                onClick={() => { setSelectedLead(item); setIsDrawerOpen(true); }}
                className={`bg-white rounded-xl border p-3 flex flex-col gap-2 cursor-pointer transition-all hover:shadow-md ${isLocked ? 'border-amber-400 opacity-90' : 'border-gray-200 hover:border-brand-blue/30'} group`}
            >
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="font-bold text-gray-900 leading-tight">{lead.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">{lead.phone}</p>
                    </div>
                    {isLocked ? (
                        <span className="flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase animate-pulse">
                            <Users className="w-3 h-3" /> In Uso
                        </span>
                    ) : (
                        <button
                            onClick={(e) => handleQuickNR(e, item)}
                            className="text-gray-400 hover:text-rose-600 bg-gray-50 hover:bg-rose-50 p-1.5 rounded-full transition-colors"
                            title="Segna Non Risponde Veloce"
                        >
                            <PhoneOff className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <div className="flex gap-1">
                        <div className={`w-2.5 h-2.5 rounded-full ${lead.confCall1At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} title="1Â° Chiamata" />
                        <div className={`w-2.5 h-2.5 rounded-full ${lead.confCall2At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} title="2Â° Chiamata" />
                        <div className={`w-2.5 h-2.5 rounded-full ${lead.confCall3At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} title="3Â° Chiamata" />
                    </div>
                    <div className="text-[10px] font-semibold uppercase text-gray-400">
                        {item.gdo?.displayName || "Sconosciuto"}
                    </div>
                </div>
            </div>
        )
    }

    const renderKanbanColumn = (title: string, hours: string[], isToday: boolean) => {
        const todayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

        // Filter leads for this column
        const columnLeads = kanbanData.flatList.filter(l => {
            if (!l.lead.appointmentDate) return false;
            const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(l.lead.appointmentDate));
            if (isToday) return dateStr === todayStr;
            return dateStr !== todayStr;
        });

        return (
            <div className="flex-1 flex flex-col bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <div className="bg-slate-800 text-white p-4 shrink-0 shadow-sm z-10">
                    <h2 className="font-black text-lg uppercase tracking-wider">{title}</h2>
                    <p className="text-slate-300 text-xs mt-1">
                        {isToday ? "Turno Pomeridiano (Dalle 13:00 alle 21:00)" : "Turno Mattutino (Dalle 09:00 alle 14:00)"}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {hours.map(hourKey => {
                        const targetHour = parseInt(hourKey.split(':')[0], 10);
                        const leadsInThisHour = columnLeads.filter(l => {
                            const h = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(l.lead.appointmentDate)), 10);
                            return h === targetHour;
                        });

                        return (
                            <div key={hourKey} className="relative">
                                <div className="flex items-center gap-3 mb-3 sticky top-0 bg-gray-50/90 backdrop-blur pb-2 z-10">
                                    <div className="bg-white border-2 border-slate-200 text-slate-700 font-bold px-3 py-1 rounded-lg shadow-sm text-sm flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-brand-orange" />
                                        {hourKey}
                                    </div>
                                    <div className="h-px bg-gray-200 flex-1" />
                                </div>

                                {leadsInThisHour.length === 0 ? (
                                    <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50/50 px-4 py-3 rounded-xl border border-emerald-100">
                                        <CheckCircle2 className="w-5 h-5" />
                                        <span className="text-sm font-medium">Nessun appuntamento in questa fascia.</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2">
                                        {leadsInThisHour.map(renderLeadCard)}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] gap-4 relative">
            <GlobalAlertListener currentUser={currentUser} />

            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                <button
                    onClick={() => setViewMode('kanban')}
                    className={`px-6 py-2.5 rounded-t-xl font-bold transition-all text-sm uppercase tracking-wider ${viewMode === 'kanban' ? 'bg-brand-blue-dark text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                    Torre di Controllo
                </button>
                <button
                    onClick={() => setViewMode('table')}
                    className={`px-6 py-2.5 rounded-t-xl font-bold transition-all text-sm uppercase tracking-wider ${viewMode === 'table' ? 'bg-brand-blue-dark text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                    Tutti gli Appuntamenti
                </button>
            </div>

            {viewMode === 'kanban' ? (
                // --- KANBAN VIEW ---
                <div className="flex flex-1 gap-6 overflow-hidden">
                    {renderKanbanColumn("Oggi", KANBAN_HOURS_OGGI, true)}
                    {renderKanbanColumn("Prossimo Turno", KANBAN_HOURS_DOMANI, false)}

                    {/* Da Definire Panel */}
                    <div className="w-72 flex flex-col bg-amber-50/30 rounded-2xl border border-amber-200 overflow-hidden shrink-0">
                        <div className="bg-amber-500 text-white p-4 shrink-0 shadow-sm border-b border-amber-600">
                            <h2 className="font-black text-lg uppercase tracking-wider">Da Definire</h2>
                            <p className="text-amber-100 text-xs mt-1">Richiami da riprogrammare</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {kanbanData.daDefinire.length === 0 ? (
                                <div className="text-sm text-amber-700/60 font-medium italic text-center mt-10">Coda vuota. Ãš tutto in ordine!</div>
                            ) : kanbanData.daDefinire.map(renderLeadCard)}
                        </div>
                    </div>
                </div>
            ) : (
                // --- TABLE VIEW ---
                <div className="flex flex-col flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-4 items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 py-2 shrink-0 shadow-sm">
                                <Search className="w-4 h-4 text-gray-400 mr-2" />
                                <input
                                    type="text"
                                    placeholder="Cerca per nome, email o telefono..."
                                    className="bg-transparent border-none outline-none text-sm w-64"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="flex bg-white border border-gray-300 rounded-lg p-1 shrink-0 shadow-sm">
                                <button onClick={() => handleDatePreset("today")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${datePreset === "today" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Oggi</button>
                                <button onClick={() => handleDatePreset("tomorrow")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${datePreset === "tomorrow" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Domani</button>
                                <button onClick={() => handleDatePreset("7days")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${datePreset === "7days" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Ultimi 7 gg</button>
                                <button onClick={() => handleDatePreset("all")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${datePreset === "all" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Tutti</button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto bg-white">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-brand-blue">
                                <div className="animate-spin w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full mb-4 mx-auto"></div>
                            </div>
                        ) : tableData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                                    <Filter className="w-8 h-8 text-slate-300" />
                                </div>
                                <p className="text-sm font-medium">Nessun appuntamento trovato</p>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse min-w-max">
                                <thead>
                                    <tr className="bg-slate-50 sticky top-0 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-slate-500 z-10 shadow-sm">
                                        <th className="p-4 pl-6">Data / Ora</th>
                                        <th className="p-4">Lead</th>
                                        <th className="p-4">GDO</th>
                                        <th className="p-4">Stato</th>
                                        <th className="p-4"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {tableData.map((item) => (
                                        <tr
                                            key={item.lead.id}
                                            className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                                            onClick={() => {
                                                setSelectedLead(item)
                                                setIsDrawerOpen(true)
                                            }}
                                        >
                                            <td className="p-4 pl-6 align-top pt-5">
                                                {item.lead.confNeedsReschedule ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800 uppercase tracking-widest">Da Definire</span>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center gap-2">
                                                            <Calendar className="w-4 h-4 text-slate-400" />
                                                            <span className="font-semibold text-slate-900">
                                                                {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "dd MMM yyyy", { locale: it }) : "N/D"}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1.5 text-sm font-medium text-brand-orange">
                                                            <Clock className="w-4 h-4" />
                                                            <span>
                                                                {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "HH:mm") : "N/D"}
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td className="p-4 align-top pt-5">
                                                <p className="font-bold text-slate-900 text-[15px]">{item.lead.name}</p>
                                                <p className="text-sm text-slate-500 mt-0.5">{item.lead.phone}</p>
                                            </td>
                                            <td className="p-4 align-top pt-5">
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                                                    {item.gdo?.displayName || item.gdo?.name || "Sconosciuto"}
                                                </span>
                                            </td>
                                            <td className="p-4 align-top pt-5">
                                                <div className="flex flex-col gap-2 items-start">
                                                    {globalPresence.find(p => p.leadId === item.lead.id) && (
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800 animate-pulse border border-amber-200">
                                                            <Users className="w-3 h-3" /> In Lavoro
                                                        </span>
                                                    )}
                                                    {item.lead.confirmationsOutcome === "confermato" ? (
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                                                            <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confermato
                                                        </span>
                                                    ) : item.lead.confirmationsOutcome === "scartato" ? (
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/10">
                                                            <XCircle className="w-4 h-4 mr-1.5" /> Scartato
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-600/20">
                                                            Da lavorare
                                                        </span>
                                                    )}

                                                    {(!item.lead.confirmationsOutcome) && (
                                                        <div className="flex gap-1.5 mt-1" title="Tentativi NR">
                                                            <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall1At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                            <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall2At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                            <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall3At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right align-middle">
                                                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center ml-auto group-hover:bg-brand-blue group-hover:text-white transition-colors duration-200">
                                                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {isDrawerOpen && selectedLead && (
                <ConfermeDrawer
                    leadItem={selectedLead}
                    currentUser={currentUser}
                    onClose={() => {
                        setIsDrawerOpen(false)
                        fetchLeads()
                    }}
                />
            )}
        </div>
    )
}
