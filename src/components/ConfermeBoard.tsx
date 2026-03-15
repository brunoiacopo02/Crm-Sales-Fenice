"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, AlertCircle, PhoneOff } from "lucide-react"
import { getConfermeAppointments, updateLeadDataConferme } from "@/app/actions/confermeActions"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { ConfermeDrawer } from "@/components/ConfermeDrawer"
import { GlobalAlertListener } from "@/components/GlobalAlertListener"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"
import { createClient } from "@/utils/supabase/client"

type LeadData = any;

type ViewMode = 'pomeriggio' | 'mattina' | 'da_definire' | 'table';

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [viewMode, setViewMode] = useState<ViewMode>('pomeriggio')

    // Dataset
    const [kanbanData, setKanbanData] = useState<{ flatList: LeadData[], daDefinire: LeadData[] }>({ flatList: [], daDefinire: [] })
    const [tableData, setTableData] = useState<LeadData[]>([])

    // Derived Data for Views
    const [oggiLeads, setOggiLeads] = useState<LeadData[]>([])
    const [domaniLeads, setDomaniLeads] = useState<LeadData[]>([])
    const [oggiHours, setOggiHours] = useState<string[]>([])
    const [domaniHours, setDomaniHours] = useState<string[]>([])

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

    const fetchLeads = async (showSpinner = true) => {
        if (showSpinner) setLoading(true)
        try {
            if (viewMode !== 'table') {
                const data = await getConfermeAppointments({
                    fetchMode: "strict_kanban" // Automatically ignores dates
                })
                setKanbanData({ flatList: data.flatList, daDefinire: data.daDefinire })

                // Process Data Split
                const now = new Date();
                const todayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
                const romeDayOfWeekStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(now);
                const romeDayOfWeek = romeDayOfWeekStr.substring(0, 3).toLowerCase();

                const oLeads = data.flatList.filter(l => {
                    if (!l.lead.appointmentDate) return false;
                    const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(l.lead.appointmentDate));
                    return dateStr === todayStr;
                });

                const dLeads = data.flatList.filter(l => {
                    if (!l.lead.appointmentDate) return false;
                    const dateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(l.lead.appointmentDate));
                    return dateStr !== todayStr;
                });

                setOggiLeads(oLeads);
                setDomaniLeads(dLeads);

                // Set Dynamic Hours based on Day of Week rules
                if (romeDayOfWeek === 'sat') {
                    setOggiHours(Array.from({ length: 9 }, (_, i) => `${(i + 13).toString().padStart(2, '0')}:00`)); // 13-21
                } else {
                    setOggiHours(Array.from({ length: 7 }, (_, i) => `${(i + 15).toString().padStart(2, '0')}:00`)); // 15-21
                }
                setDomaniHours(Array.from({ length: 6 }, (_, i) => `${(i + 9).toString().padStart(2, '0')}:00`)); // 09-14

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
            if (showSpinner) setLoading(false)
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
            fetchLeads(true)
        }, 400)
        return () => clearTimeout(timer)
    }, [viewMode, searchQuery, dateRange])

    useEffect(() => {
        const supabase = createClient();
        const channel = supabase.channel('conferme_realtime_board');

        // Listen for ANY change on the leads table (insert or update)
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
            // Silently refetch when a change occurs to avoid stale data
            if (viewMode !== 'table') fetchLeads(false);
        });

        // Listen for presence state changes (colleagues opening a drawer)
        channel.on('presence', { event: 'sync' }, () => {
            const newState = channel.presenceState();
            const presenceArray: any[] = [];

            for (const id in newState) {
                const presenceGroup = newState[id];
                presenceGroup.forEach((p: any) => p.leadId && presenceArray.push(p));
            }
            // Update global presence for those locked cards
            setGlobalPresence(presenceArray);
        });

        channel.subscribe();

        // Initial setup for presence right after mount
        loadPresence();
        const initialLoadInterval = setInterval(loadPresence, 30000); // 30s slow catch-all fallback

        return () => {
            supabase.removeChannel(channel);
            clearInterval(initialLoadInterval);
        };
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
        // We open the drawer so the user can quickly confirm the NR there, OR we can execute API here directly.
        // Actually, the user expects the fast NR to happen on the card. Wait, let's just trigger the fast NR action directly!
        // Importing recordConfermeNoAnswer at the top to fix this correctly.
        setIsDrawerOpen(false);
        try {
            const { recordConfermeNoAnswer } = await import('@/app/actions/confermeActions');
            const res = await recordConfermeNoAnswer(leadItem.lead.id, leadItem.lead.version);
            if (res.success) {
                fetchLeads(false);
            } else {
                alert(res.error);
            }
        } catch (e: any) {
            alert(e.message);
        }
    }

    // --- RENDER LEAD CARD (100% WIDTH) ---
    const renderLeadCard = (item: LeadData) => {
        const lead = item.lead
        const isLocked = globalPresence.some(p => p.leadId === lead.id && p.user.id !== currentUser.id)

        return (
            <div
                key={lead.id}
                onClick={() => { setSelectedLead(item); setIsDrawerOpen(true); }}
                className={`bg-white rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer transition-all hover:shadow-md ${isLocked ? 'border-amber-400 bg-amber-50/20' : 'border-gray-200 hover:border-brand-blue-light'} group mb-3 w-full`}
            >
                {/* Left side: Info */}
                <div className="flex flex-col gap-1.5 flex-1 w-full min-w-0">
                    <div className="flex items-center gap-3">
                        <h4 className="font-bold text-gray-900 text-lg sm:text-lg truncate">{lead.name}</h4>
                        {isLocked && (
                            <span className="flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded uppercase animate-pulse shrink-0 border border-amber-200">
                                <Users className="w-4 h-4" /> In Lavorazione
                            </span>
                        )}
                        {!lead.confirmationsOutcome && (
                            <div className="flex gap-1 ml-2" title="Tentativi di chiamata">
                                <div className={`w-3 h-3 rounded-full ${lead.confCall1At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                <div className={`w-3 h-3 rounded-full ${lead.confCall2At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                <div className={`w-3 h-3 rounded-full ${lead.confCall3At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                        <span className="font-medium">{lead.phone}</span>
                        <div className="w-1 h-1 bg-gray-300 rounded-full" />
                        <span className="font-semibold text-brand-orange">
                            GDO: {item.gdo?.displayName || item.gdo?.name || "N/A"}
                        </span>
                    </div>
                </div>

                {/* Right side: Actions */}
                <div className="flex items-center gap-3 shrink-0 sm:ml-auto">
                    {/* Urgency Status */}
                    <div className="flex items-center">
                        {lead.confirmationsOutcome === "confermato" ? (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 shadow-sm">
                                <CheckCircle2 className="w-5 h-5 mr-1.5" /> Confermato
                            </span>
                        ) : lead.confirmationsOutcome === "scartato" ? (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/10 shadow-sm">
                                <XCircle className="w-5 h-5 mr-1.5" /> Scartato
                            </span>
                        ) : (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-600/20 shadow-sm">
                                Da lavorare
                            </span>
                        )}
                    </div>

                    {!isLocked && !lead.confirmationsOutcome && (
                        <button
                            onClick={(e) => handleQuickNR(e, item)}
                            className="flex items-center justify-center bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-rose-200 text-gray-500 hover:text-rose-600 h-9 w-9 sm:h-auto sm:w-auto sm:px-4 sm:py-1.5 rounded-lg transition-colors shadow-sm font-bold shadow-sm"
                            title="Segna Non Risponde Veloce"
                        >
                            <PhoneOff className="w-4 h-4 sm:mr-1.5" />
                            <span className="hidden sm:inline">NR</span>
                        </button>
                    )}
                    <div className="w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-brand-blue group-hover:text-white transition-colors duration-200 border border-gray-200 cursor-pointer">
                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                    </div>
                </div>
            </div>
        )
    }

    const renderEmptyState = (message: string) => (
        <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl border border-gray-100 shadow-sm mb-6">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-3">
                <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Tutto Pulito!</h3>
            <p className="text-gray-500 text-sm font-medium">{message}</p>
        </div>
    )

    const renderHourSection = (hours: string[], leadsList: LeadData[]) => {
        return (
            <div className="flex flex-col w-full max-w-5xl mx-auto space-y-8 pb-12">
                {hours.map(hourKey => {
                    const targetHour = parseInt(hourKey.split(':')[0], 10);
                    const leadsInThisHour = leadsList.filter(l => {
                        const h = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(l.lead.appointmentDate)), 10);
                        return h === targetHour;
                    });

                    return (
                        <div key={hourKey} className="flex flex-col w-full">
                            {/* Giant Hour Divider */}
                            <div className="flex items-center mb-4 sticky top-0 bg-gray-50/95 backdrop-blur z-10 py-2">
                                <div className="flex items-center gap-3 bg-white border border-gray-200 shadow-sm rounded-xl px-4 py-2 text-brand-blue-dark font-black tracking-widest text-lg">
                                    <Clock className="w-6 h-6 text-brand-orange" />
                                    ORE {hourKey}
                                </div>
                                <div className="h-0.5 bg-gray-200 flex-1 ml-4 rounded-full" />
                            </div>

                            {/* Cards Container */}
                            <div className="flex flex-col w-full">
                                {leadsInThisHour.length === 0 ? (
                                    <div className="flex items-center gap-2 text-emerald-600 px-4 py-2 font-medium">
                                        <CheckCircle2 className="w-5 h-5" /> Nessun appuntamento
                                    </div>
                                ) : (
                                    leadsInThisHour.map(renderLeadCard)
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] relative">
            <GlobalAlertListener currentUser={currentUser} />

            {/* MEGA TOGGLES NAVIGATION */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 sticky top-0 z-20 bg-gray-50 pt-2 pb-4 border-b border-gray-200">
                <div className="flex p-1 bg-gray-200/80 rounded-2xl w-full lg:w-3/4 max-w-4xl shadow-inner border border-gray-300">
                    <button
                        onClick={() => setViewMode('pomeriggio')}
                        className={`flex-1 py-3 px-2 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${viewMode === 'pomeriggio' ? 'bg-white text-brand-blue-dark shadow-md scale-[1.02] border border-gray-200 z-10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50'}`}
                    >
                        <Clock className="w-5 h-5 opacity-70" />
                        App Pomeriggio
                    </button>
                    <button
                        onClick={() => setViewMode('mattina')}
                        className={`flex-1 py-3 px-2 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${viewMode === 'mattina' ? 'bg-white text-brand-blue-dark shadow-md scale-[1.02] border border-gray-200 z-10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50'}`}
                    >
                        <Calendar className="w-5 h-5 opacity-70" />
                        App Mattina
                    </button>
                    <button
                        onClick={() => setViewMode('da_definire')}
                        className={`flex-1 py-3 px-2 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${viewMode === 'da_definire' ? 'bg-white text-brand-blue-dark shadow-md scale-[1.02] border border-gray-200 z-10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50'}`}
                    >
                        <AlertCircle className="w-5 h-5 opacity-70" />
                        Da Definire
                        {kanbanData.daDefinire.length > 0 && (
                            <span className="bg-amber-500 text-white px-2 py-0.5 rounded-full text-xs font-bold ml-1">{kanbanData.daDefinire.length}</span>
                        )}
                    </button>
                </div>

                <div className="w-full lg:w-auto">
                    <button
                        onClick={() => setViewMode('table')}
                        className={`w-full lg:w-auto px-6 py-3.5 rounded-2xl font-bold transition-all text-sm uppercase tracking-wider flex items-center justify-center border ${viewMode === 'table' ? 'bg-slate-800 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 hover:bg-slate-50 border-gray-300 shadow-sm'}`}
                    >
                        <Search className="w-4 h-4 mr-2" />
                        Vista Globale
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-auto bg-gray-50 px-2 sm:px-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-brand-blue">
                        <div className="animate-spin w-10 h-10 border-4 border-brand-orange border-t-transparent rounded-full mb-4 mx-auto"></div>
                    </div>
                ) : (
                    <>
                        {viewMode === 'pomeriggio' && (
                            <div className="w-full h-full flex flex-col items-center pt-2">
                                {renderHourSection(oggiHours, oggiLeads)}
                            </div>
                        )}

                        {viewMode === 'mattina' && (
                            <div className="w-full h-full flex flex-col items-center pt-2">
                                {renderHourSection(domaniHours, domaniLeads)}
                            </div>
                        )}

                        {viewMode === 'da_definire' && (
                            <div className="w-full max-w-5xl mx-auto flex flex-col items-center pt-2 pb-12">
                                <div className="w-full mb-6 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
                                    <h2 className="text-xl font-black text-amber-800 uppercase tracking-widest mb-1">Richiami Parcheggiati</h2>
                                    <p className="text-amber-700/80 font-medium">Lead da ricollocare con urgenza nei buchi di agenda.</p>
                                </div>
                                <div className="w-full flex flex-col gap-3">
                                    {kanbanData.daDefinire.length === 0 ? (
                                        renderEmptyState("La coda dei richiami Ãš perfettamente pulita.")
                                    ) : (
                                        kanbanData.daDefinire.map(renderLeadCard)
                                    )}
                                </div>
                            </div>
                        )}

                        {viewMode === 'table' && (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-8 max-w-[1400px] mx-auto w-full">
                                <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-4 items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <div className="flex items-center bg-white border border-gray-300 rounded-xl px-3 py-2 shrink-0 shadow-sm">
                                            <Search className="w-4 h-4 text-gray-400 mr-2" />
                                            <input
                                                type="text"
                                                placeholder="Cerca per nome, email o telefono..."
                                                className="bg-transparent border-none outline-none text-sm w-64"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex bg-white border border-gray-300 rounded-xl p-1 shrink-0 shadow-sm">
                                            <button onClick={() => handleDatePreset("today")} className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === "today" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Oggi</button>
                                            <button onClick={() => handleDatePreset("tomorrow")} className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === "tomorrow" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Domani</button>
                                            <button onClick={() => handleDatePreset("7days")} className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === "7days" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Ultimi 7 gg</button>
                                            <button onClick={() => handleDatePreset("all")} className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === "all" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Tutti</button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto bg-white p-0">
                                    {tableData.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-10">
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
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">
                                                                {item.gdo?.displayName || item.gdo?.name || "Sconosciuto"}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="flex flex-col gap-2 items-start">
                                                                {globalPresence.find(p => p.leadId === item.lead.id) && (
                                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800 animate-pulse border border-amber-200 shadow-sm">
                                                                        <Users className="w-3 h-3" /> In Uso
                                                                    </span>
                                                                )}
                                                                {item.lead.confirmationsOutcome === "confermato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 shadow-sm">
                                                                        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confermato
                                                                    </span>
                                                                ) : item.lead.confirmationsOutcome === "scartato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/10 shadow-sm">
                                                                        <XCircle className="w-4 h-4 mr-1.5" /> Scartato
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-600/20 shadow-sm">
                                                                        Da lavorare
                                                                    </span>
                                                                )}

                                                                {(!item.lead.confirmationsOutcome) && (
                                                                    <div className="flex gap-1.5 mt-1" title="Tentativi NR">
                                                                        <div className={`w-2.5 h-2.5 rounded-full shadow-inner ${item.lead.confCall1At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full shadow-inner ${item.lead.confCall2At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full shadow-inner ${item.lead.confCall3At ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-slate-200'}`} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-right align-middle">
                                                            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center ml-auto group-hover:bg-brand-blue group-hover:border-brand-blue group-hover:text-white transition-all duration-200 shadow-sm">
                                                                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
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
                    </>
                )}
            </div>

            {isDrawerOpen && selectedLead && (
                <ConfermeDrawer
                    isOpen={true}
                    item={selectedLead}
                    currentUser={currentUser}
                    onRefresh={() => fetchLeads(false)}
                    onClose={() => {
                        setIsDrawerOpen(false)
                        fetchLeads(false)
                    }}
                />
            )}
        </div>
    )
}
