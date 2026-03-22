"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, AlertCircle, PhoneOff, Phone } from "lucide-react"
import { getConfermeAppointments, updateLeadDataConferme } from "@/app/actions/confermeActions"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { ConfermeDrawer } from "@/components/ConfermeDrawer"
import { ConfermeBoardRow } from "@/components/ConfermeBoardRow"
import { GlobalAlertListener } from "@/components/GlobalAlertListener"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"
import { createClient } from "@/utils/supabase/client"

type LeadData = any;

type ViewMode = 'pomeriggio' | 'mattina' | 'da_definire' | 'table';
type NrFilterMode = 'tutti' | '0' | '1' | '2' | '3';

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [viewMode, setViewMode] = useState<ViewMode>('pomeriggio')
    const [nrFilter, setNrFilter] = useState<NrFilterMode>('tutti')
    const [selectedHour, setSelectedHour] = useState<string | null>(null)

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
                    fetchMode: "strict_kanban", // Automatically ignores dates
                    searchQuery: searchQuery
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

    // Auto-select first hour when views change
    useEffect(() => {
        if (viewMode === 'pomeriggio' && oggiHours.length > 0 && !oggiHours.includes(selectedHour || '')) {
            setSelectedHour(oggiHours[0]);
        } else if (viewMode === 'mattina' && domaniHours.length > 0 && !domaniHours.includes(selectedHour || '')) {
            setSelectedHour(domaniHours[0]);
        }
    }, [viewMode, oggiHours, domaniHours, selectedHour]);

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

    // --- SNOOZE WATCHER ---
    const [alertedSnoozes, setAlertedSnoozes] = useState<Set<string>>(new Set())

    useEffect(() => {
        const interval = setInterval(() => {
            const nowTime = new Date().getTime();
            const allLeads = [...oggiLeads, ...domaniLeads];

            setAlertedSnoozes(prev => {
                const updatedSet = new Set(prev);
                let newlyAlerted = false;

                allLeads.forEach(item => {
                    const lead = item.lead;
                    if (!lead.confirmationsOutcome && lead.confSnoozeAt) {
                        const snoozeTime = new Date(lead.confSnoozeAt).getTime();
                        if (snoozeTime <= nowTime && !updatedSet.has(lead.id)) {
                            // Trigger alert!
                            alert(`⏰ SVEGLIA SNOOZE (Richiamo Programmato Odierno)\n\nÈ arrivato il momento di chiamare:\n👤 ${lead.name}\n📞 ${lead.phone}`);
                            updatedSet.add(lead.id);
                            newlyAlerted = true;
                        }
                    }
                });

                return newlyAlerted ? updatedSet : prev;
            });

        }, 30000); // Check every 30 seconds

        return () => clearInterval(interval);
    }, [oggiLeads, domaniLeads]);

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

    // --- RENDER COMPACT LEAD ROW ---
    const renderRowComponent = (item: LeadData, layoutMode: 'default' | 'snooze' | 'richiami' = 'default') => {
        const isLocked = globalPresence.some(p => p.leadId === item.lead.id && p.user.id !== currentUser.id)
        return (
            <ConfermeBoardRow
                key={item.lead.id}
                item={item}
                currentUser={currentUser}
                isLocked={isLocked}
                layoutMode={layoutMode}
                onRefresh={() => fetchLeads(false)}
                onRowClick={() => { setSelectedLead(item); setIsDrawerOpen(true); }}
            />
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

    const renderActiveTimeline = () => {
        const activeLeads = viewMode === "pomeriggio" ? oggiLeads : viewMode === "mattina" ? domaniLeads : [];
        const activeHours = viewMode === "pomeriggio" ? oggiHours : viewMode === "mattina" ? domaniHours : [];

        if (activeHours.length === 0) return null;

        return (
            <div className="flex items-center gap-2 overflow-x-auto pb-4 pt-1 px-1 mb-2 scrollbar-none w-full border-b border-gray-200/60 sticky top-0 bg-gray-50 z-10">
                {activeHours.map((hourParam) => {
                    const hNum = parseInt(hourParam.split(':')[0], 10);
                    const leadsForHour = activeLeads.filter(l => {
                        if (!l.lead.appointmentDate) return false;
                        const lHour = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(l.lead.appointmentDate)), 10);
                        return lHour === hNum && !l.lead.confNeedsReschedule;
                    });

                    const allDone = leadsForHour.length > 0 && leadsForHour.every(l => !!l.lead.confirmationsOutcome);
                    const trafficColor = leadsForHour.length === 0 ? "bg-gray-300" : allDone ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]";

                    return (
                        <button
                            key={hourParam}
                            onClick={() => { setSelectedHour(hourParam); setNrFilter('tutti'); }}
                            className={`flex items-center gap-2 shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-all duration-200 ${selectedHour === hourParam ? 'bg-white border-brand-blue ring-1 ring-brand-blue text-brand-blue-dark shadow-md scale-105' : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-600'}`}
                        >
                            {hourParam}
                            <div className={`w-2.5 h-2.5 rounded-full ${trafficColor} border border-white/50`} />
                        </button>
                    )
                })}
            </div>
        )
    }

    const renderNRFilters = (leadsForHour: LeadData[]) => {
        const counts = {
            'tutti': leadsForHour.length,
            '0': leadsForHour.filter(l => !l.lead.confCall1At).length,
            '1': leadsForHour.filter(l => l.lead.confCall1At && !l.lead.confCall2At && !l.lead.confCall3At).length,
            '2': leadsForHour.filter(l => l.lead.confCall2At && !l.lead.confCall3At).length,
            '3': leadsForHour.filter(l => l.lead.confCall3At).length,
        }

        const filterButton = (key: NrFilterMode, label: string) => (
            <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-bold cursor-pointer transition-all ${nrFilter === key ? 'bg-slate-800 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-600 border-gray-200 hover:border-gray-300 hover:bg-slate-50'}`}>
                <input type="radio" value={key} checked={nrFilter === key} onChange={() => setNrFilter(key)} className="hidden" />
                {label} <span className={`ml-1 px-1.5 rounded-full text-[11px] ${nrFilter === key ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts[key]}</span>
            </label>
        );

        return (
            <div className="flex flex-wrap items-center gap-2 mb-4 px-1 mt-4">
                {filterButton('tutti', 'Tutti')}
                {filterButton('0', '0 Chiamate')}
                {filterButton('1', '1 Chiamata')}
                {filterButton('2', '2 Chiamate')}
                {filterButton('3', '3 Chiamate')}
            </div>
        )
    }

    const renderSelectedHourLeads = () => {
        if (!selectedHour) return null;
        const activeLeads = viewMode === "pomeriggio" ? oggiLeads : viewMode === "mattina" ? domaniLeads : [];
        const hNum = parseInt(selectedHour.split(':')[0], 10);

        let targetLeads = activeLeads.filter(l => {
            if (!l.lead.appointmentDate) return false;
            const lHour = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(l.lead.appointmentDate)), 10);
            return lHour === hNum && !l.lead.confNeedsReschedule;
        });

        // Render the pill filters first
        const filtersJSX = renderNRFilters(targetLeads);

        // Apply filters
        if (nrFilter === '0') targetLeads = targetLeads.filter(l => !l.lead.confCall1At);
        if (nrFilter === '1') targetLeads = targetLeads.filter(l => l.lead.confCall1At && !l.lead.confCall2At && !l.lead.confCall3At);
        if (nrFilter === '2') targetLeads = targetLeads.filter(l => l.lead.confCall2At && !l.lead.confCall3At);
        // Calculate Snoozed logic (Global visibility across the day, regardless of selected hour views)
        const snoozedLeads = kanbanData.flatList
            .filter(l => l.lead.confSnoozeAt && !l.lead.confirmationsOutcome)
            .sort((a,b) => new Date(a.lead.confSnoozeAt).getTime() - new Date(b.lead.confSnoozeAt).getTime());
            
        const normalTargetLeads = targetLeads.filter(l => !l.lead.confSnoozeAt);

        return (
            <div className="flex flex-col xl:flex-row w-full max-w-[1400px] mx-auto pb-12 gap-6 items-start px-2">
                <div className="flex flex-col w-full xl:w-2/3">
                    {filtersJSX}
                    <div className="flex flex-col w-full bg-white border border-gray-200 rounded-xl p-2 shadow-sm">
                        {normalTargetLeads.length === 0 ? (
                            <div className="text-center py-6 text-slate-500 text-sm font-medium">Nessun lead corrispondente ai filtri in questa fascia oraria.</div>
                        ) : (
                            normalTargetLeads.map(l => renderRowComponent(l, 'default'))
                        )}
                    </div>
                </div>

                <div className="flex flex-col w-full xl:w-1/3 mt-4 xl:mt-0 pt-0 xl:pt-[72px]">
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 shadow-sm mb-4">
                        <h3 className="text-purple-800 font-bold mb-1 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Richiamati In Giornata</h3>
                        <p className="text-[12px] text-purple-700/80 leading-tight">Lead spostati temporaneamente ("Snooze"). Suonerà una sveglia all'orario stabilito.</p>
                    </div>
                    <div className="flex flex-col bg-white border border-gray-200 rounded-xl p-2 shadow-sm min-h-[150px]">
                        {snoozedLeads.length === 0 ? (
                            <div className="text-center my-auto py-6 text-slate-400 text-xs font-semibold">Nessun richiamo attivo.</div>
                        ) : (
                            snoozedLeads.map(l => renderRowComponent(l, 'snooze'))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] relative">
            <GlobalAlertListener currentUser={currentUser} />

            {/* MEGA TOGGLES NAVIGATION - Plancia Desktop Segmented Control */}
            <div className="flex items-center justify-between gap-4 mb-2 sticky top-0 z-20 bg-gray-50 pt-3 pb-3">
                <div className="flex p-1 bg-gray-200/60 rounded-xl max-w-2xl border border-gray-200 shadow-inner">
                    <button
                        onClick={() => setViewMode('pomeriggio')}
                        className={`py-2 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'pomeriggio' ? 'bg-white text-slate-800 shadow-sm border border-gray-300' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/30'}`}
                    >
                        App Pomeriggio <span className={`ml-1 px-1.5 py-0.5 rounded text-[11px] leading-none ${viewMode === 'pomeriggio' ? 'bg-slate-800 text-white' : 'bg-gray-300 text-gray-700'}`}>{oggiLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('mattina')}
                        className={`py-2 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'mattina' ? 'bg-white text-slate-800 shadow-sm border border-gray-300' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/30'}`}
                    >
                        App Mattina <span className={`ml-1 px-1.5 py-0.5 rounded text-[11px] leading-none ${viewMode === 'mattina' ? 'bg-slate-800 text-white' : 'bg-gray-300 text-gray-700'}`}>{domaniLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('da_definire')}
                        className={`py-2 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'da_definire' ? 'bg-white text-blue-700 shadow-sm border border-blue-200' : 'text-blue-600/70 hover:text-blue-700 hover:bg-blue-50/50'}`}
                    >
                        Richiami <span className={`ml-1 px-1.5 py-0.5 rounded text-[11px] leading-none ${viewMode === 'da_definire' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'}`}>{kanbanData.daDefinire.length}</span>
                    </button>
                </div>

                <div className="flex w-full lg:w-auto items-center gap-3">
                    {/* GLOBAL SEARCH INPUT */}
                    <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 py-2 w-full lg:w-64 xl:w-80 shadow-sm transition-all focus-within:ring-2 focus-within:ring-brand-blue/30 focus-within:border-brand-blue">
                        <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
                        <input
                            type="text"
                            placeholder="Cerca per nome, email o telefono..."
                            className="bg-transparent border-none outline-none text-[13px] w-full placeholder:text-gray-400"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={() => setViewMode('table')}
                        className={`px-5 py-2 rounded-lg font-bold transition-all text-xs uppercase tracking-wider flex items-center justify-center border shrink-0 ${viewMode === 'table' ? 'bg-slate-800 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-50 border-gray-300 shadow-sm'}`}
                    >
                        Vista Globale DB
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
                            <div className="w-full h-full flex flex-col pt-0">
                                {renderActiveTimeline()}
                                {renderSelectedHourLeads()}
                            </div>
                        )}

                        {viewMode === 'mattina' && (
                            <div className="w-full h-full flex flex-col pt-0">
                                {renderActiveTimeline()}
                                {renderSelectedHourLeads()}
                            </div>
                        )}

                        {viewMode === 'da_definire' && (() => {
                            const sortedDaDefinire = [...kanbanData.daDefinire].sort((a, b) => {
                                if (!a.lead.recallDate) return 1;
                                if (!b.lead.recallDate) return -1;
                                return new Date(a.lead.recallDate).getTime() - new Date(b.lead.recallDate).getTime();
                            });

                            return (
                                <div className="w-full max-w-5xl mx-auto flex flex-col items-center pt-4 pb-12">
                                    <div className="w-full mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-sm">
                                        <h2 className="text-lg font-black text-blue-800 uppercase tracking-wide mb-1 flex items-center gap-2"><Clock className="w-5 h-5" /> Richiami Programmati</h2>
                                        <p className="text-blue-700/80 font-medium text-sm">Lead parcheggiati in attesa della data prestabilita.</p>
                                    </div>
                                    <div className="w-full flex flex-col bg-white border border-gray-200 rounded-xl p-2 shadow-sm">
                                        {sortedDaDefinire.length === 0 ? (
                                            renderEmptyState("La coda dei parcheggiati è vuota.")
                                        ) : (
                                            sortedDaDefinire.map(l => renderRowComponent(l, 'richiami'))
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {viewMode === 'table' && (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-8 max-w-[1400px] mx-auto w-full">
                                <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-4 items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
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
