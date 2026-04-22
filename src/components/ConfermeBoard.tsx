"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, AlertCircle, PhoneOff, Phone, Inbox, Sun, Sunrise, Archive } from "lucide-react"
import { getConfermeAppointments, updateLeadDataConferme, setSalespersonOutcome } from "@/app/actions/confermeActions"

import dynamic from "next/dynamic"

const ConfermeDrawer = dynamic(
  () => import("@/components/ConfermeDrawer").then(mod => mod.ConfermeDrawer),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { ConfermeBoardRow } from "@/components/ConfermeBoardRow"
import { GlobalAlertListener } from "@/components/GlobalAlertListener"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"
import { createClient } from "@/utils/supabase/client"

type LeadData = any;

type ViewMode = 'pomeriggio' | 'mattina' | 'da_definire' | 'storico' | 'table';
type NrFilterMode = 'tutti' | '0' | '1' | '2' | '3';

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [viewMode, setViewMode] = useState<ViewMode>('pomeriggio')
    const [nrFilter, setNrFilter] = useState<NrFilterMode>('tutti')
    const [selectedHour, setSelectedHour] = useState<string | null>(null)

    // Dataset
    const [kanbanData, setKanbanData] = useState<{ flatList: LeadData[], daDefinire: LeadData[] }>({ flatList: [], daDefinire: [] })
    const [tableData, setTableData] = useState<LeadData[]>([])
    const [storicoData, setStoricoData] = useState<LeadData[]>([])
    const [storicoFilter, setStoricoFilter] = useState<'tutti' | 'confermati' | 'scartati'>('tutti')

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
            if (viewMode === 'storico') {
                const data = await getConfermeAppointments({
                    fetchMode: "all",
                    timeSlot: "tutto",
                    searchQuery,
                    confermeStatus: "storico"
                })
                setStoricoData(data.flatList)
            } else if (viewMode === 'table') {
                const data = await getConfermeAppointments({
                    fetchMode: "all",
                    startDate: dateRange.start,
                    endDate: dateRange.end,
                    timeSlot: "tutto",
                    searchQuery,
                    confermeStatus: "tutti"
                })
                setTableData(data.flatList)
            } else {
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
            }
        } catch (error) {
            console.error(error)
        } finally {
            if (showSpinner) setLoading(false)
        }
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
            if (viewMode !== 'table' && viewMode !== 'storico') fetchLeads(false);
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

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                // Broadcast that we are online on the CRM looking at the board
                await channel.track({
                    online_at: new Date().toISOString(),
                    leadId: null, // Not inside a specific drawer
                    user: {
                        id: currentUser.id,
                        name: currentUser.name,
                        displayName: currentUser.displayName
                    }
                });
            }
        });

        return () => {
            // Vedi commento analogo in ConfermeDrawer: untrack esplicito
            // evita presenze stale dopo che la view cambia/smonta.
            (async () => {
                try { await channel.untrack(); } catch { /* ignore */ }
                supabase.removeChannel(channel);
            })();
        };
    }, [viewMode, currentUser.id])

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
        const lockedByEntry = globalPresence.find(p => p.leadId === item.lead.id && p.user?.id !== currentUser.id)
        const lockedByName: string | null = lockedByEntry?.user?.displayName || lockedByEntry?.user?.name || null
        return (
            <ConfermeBoardRow
                key={item.lead.id}
                item={item}
                currentUser={currentUser}
                isLocked={!!lockedByEntry}
                lockedByName={lockedByName}
                layoutMode={layoutMode}
                onRefresh={() => fetchLeads(false)}
                onRowClick={() => { setSelectedLead(item); setIsDrawerOpen(true); }}
            />
        )
    }

    const renderEmptyState = (message: string) => (
        <div className="flex flex-col items-center justify-center p-10 text-center bg-gradient-to-br from-white to-ash-50 rounded-2xl border border-ash-200/60 shadow-soft mb-6 animate-fade-in">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-soft">
                <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-ash-800 mb-1">Tutto Pulito!</h3>
            <p className="text-ash-500 text-sm font-medium">{message}</p>
        </div>
    )

    const renderActiveTimeline = () => {
        const activeLeads = viewMode === "pomeriggio" ? oggiLeads : viewMode === "mattina" ? domaniLeads : [];
        const activeHours = viewMode === "pomeriggio" ? oggiHours : viewMode === "mattina" ? domaniHours : [];

        if (activeHours.length === 0) return null;

        return (
            <div className="w-full border-b border-ash-200/40 sticky top-0 bg-white/90 backdrop-blur-sm z-10 pt-3 pb-3 mb-4 shadow-soft">
                <div className="flex flex-nowrap items-center gap-2 w-full max-w-[1400px] mx-auto px-3 overflow-x-auto pb-1 scrollbar-thin">
                    {activeHours.map((hourParam) => {
                    const hNum = parseInt(hourParam.split(':')[0], 10);
                    const leadsForHour = activeLeads.filter(l => {
                        if (!l.lead.appointmentDate) return false;
                        const lHour = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(l.lead.appointmentDate)), 10);
                        return lHour === hNum && !l.lead.confNeedsReschedule;
                    });

                    const allDone = leadsForHour.length > 0 && leadsForHour.every(l => !!l.lead.confirmationsOutcome);
                    const trafficColor = leadsForHour.length === 0 ? "bg-ash-300" : allDone ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-ember-400 shadow-[0_0_6px_rgba(232,82,63,0.4)]";

                    return (
                        <button
                            key={hourParam}
                            onClick={() => { setSelectedHour(hourParam); setNrFilter('tutti'); }}
                            className={`flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all duration-200 ${selectedHour === hourParam ? 'bg-gradient-to-b from-brand-orange-50 to-white border-brand-orange/40 text-brand-orange-700 shadow-card ring-1 ring-brand-orange/20 scale-[1.03]' : 'bg-white border-ash-200 hover:bg-ash-50 hover:border-ash-300 text-ash-600'}`}
                        >
                            {hourParam}
                            <div className={`w-2.5 h-2.5 rounded-full ${trafficColor} border border-white/50`} />
                        </button>
                    )
                })}
                </div>
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
            <label className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[13px] font-bold cursor-pointer transition-all duration-200 ${nrFilter === key ? 'bg-gradient-to-b from-ash-700 to-ash-800 text-white border-ash-900 shadow-card' : 'bg-white text-ash-600 border-ash-200 hover:border-brand-orange/30 hover:bg-brand-orange-50/40'}`}>
                <input type="radio" value={key} checked={nrFilter === key} onChange={() => setNrFilter(key)} className="hidden" />
                {label} <span className={`ml-1 px-1.5 rounded-md text-[11px] ${nrFilter === key ? 'bg-ash-600 text-white' : 'bg-ash-100 text-ash-500'}`}>{counts[key]}</span>
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
            
        // Snoozed leads now stay in the main view too (F3-017)
        const normalTargetLeads = targetLeads;

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 w-full max-w-[1400px] mx-auto pb-12 gap-4 sm:gap-6 items-start px-2">
                <div className="lg:col-span-2 flex flex-col w-full min-w-0">
                    {filtersJSX}
                    <div className="flex flex-col w-full bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft">
                        {normalTargetLeads.length === 0 ? (
                            <div className="text-center py-8 text-ash-400 text-sm font-medium flex flex-col items-center gap-2">
                                <Inbox className="w-8 h-8 text-ash-300" />
                                Nessun lead corrispondente ai filtri in questa fascia oraria.
                            </div>
                        ) : (
                            normalTargetLeads.map((l, idx) => (
                                <div key={l.lead.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}>
                                    {renderRowComponent(l, 'default')}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="lg:col-span-1 flex flex-col w-full min-w-0 mt-4 lg:mt-0 pt-0 lg:pt-[72px]">
                    <div className="bg-gradient-to-br from-brand-orange-50 to-gold-50 border border-brand-orange-200/60 rounded-xl p-3.5 shadow-soft mb-4">
                        <h3 className="text-brand-orange-700 font-bold mb-1 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Richiamati In Giornata</h3>
                        <div className="text-[12px] text-brand-orange-600/80 leading-tight">Lead spostati temporaneamente (&quot;Snooze&quot;). Suonerà una sveglia all&apos;orario stabilito.</div>
                    </div>
                    <div className="flex flex-col bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft min-h-[150px]">
                        {snoozedLeads.length === 0 ? (
                            <div className="text-center my-auto py-6 text-ash-400 text-xs font-semibold">Nessun richiamo attivo.</div>
                        ) : (
                            snoozedLeads.map(l => renderRowComponent(l, 'snooze'))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-[500px] relative">
            <GlobalAlertListener currentUser={currentUser} />

            {/* MEGA TOGGLES NAVIGATION - Premium Segmented Control */}
            <div className="flex items-center justify-between gap-4 mb-2 sticky top-0 z-20 bg-white/80 backdrop-blur-md pt-3 pb-3 border-b border-ash-200/40">
                <div className="flex p-1 bg-ash-100/80 rounded-xl max-w-2xl border border-ash-200/60 shadow-soft">
                    <button
                        onClick={() => setViewMode('pomeriggio')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'pomeriggio' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Sun className="w-4 h-4" /> Pomeriggio <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'pomeriggio' ? 'bg-brand-orange text-white' : 'bg-ash-300/60 text-ash-600'}`}>{oggiLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('mattina')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'mattina' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Sunrise className="w-4 h-4" /> Mattina <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'mattina' ? 'bg-gold-400 text-white' : 'bg-ash-300/60 text-ash-600'}`}>{domaniLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('da_definire')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'da_definire' ? 'bg-white text-blue-700 shadow-card border border-blue-200/60' : 'text-blue-500/70 hover:text-blue-700 hover:bg-blue-50/40'}`}
                    >
                        <Clock className="w-4 h-4" /> Richiami <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'da_definire' ? 'bg-blue-600 text-white' : 'bg-blue-100/80 text-blue-700'}`}>{kanbanData.daDefinire.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('storico')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'storico' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Archive className="w-4 h-4" /> Storico
                    </button>
                </div>

                <div className="flex w-full lg:w-auto items-center gap-3">
                    {/* GLOBAL SEARCH INPUT */}
                    <div className="flex items-center bg-ash-50/50 border border-ash-200 rounded-lg px-3 py-2 w-full lg:w-64 xl:w-80 shadow-soft transition-all focus-within:ring-2 focus-within:ring-brand-orange/30 focus-within:border-brand-orange/40">
                        <Search className="w-4 h-4 text-ash-400 mr-2 shrink-0" />
                        <input
                            type="text"
                            placeholder="Cerca per nome, email o telefono..."
                            className="bg-transparent border-none outline-none text-[13px] w-full placeholder:text-ash-400"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={() => setViewMode('table')}
                        className={`px-5 py-2.5 rounded-lg font-bold transition-all duration-200 text-xs uppercase tracking-wider flex items-center justify-center border shrink-0 ${viewMode === 'table' ? 'bg-gradient-to-b from-ash-700 to-ash-800 text-white border-ash-900 shadow-card' : 'bg-white text-ash-600 hover:bg-ash-50 border-ash-200 shadow-soft'}`}
                    >
                        Vista Globale DB
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-auto bg-gradient-to-b from-ash-50/50 to-white px-2 sm:px-4 pb-48">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="animate-spin w-10 h-10 border-4 border-brand-orange border-t-transparent rounded-full"></div>
                        <div className="text-ash-400 text-sm font-medium">Caricamento...</div>
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
                                <div className="w-full max-w-5xl mx-auto flex flex-col items-center pt-4 pb-12 animate-fade-in">
                                    <div className="w-full mb-4 p-4 bg-gradient-to-r from-blue-50 to-brand-orange-50/30 border border-blue-200/60 rounded-xl shadow-soft">
                                        <h2 className="text-lg font-black text-blue-800 uppercase tracking-wide mb-1 flex items-center gap-2"><Clock className="w-5 h-5" /> Richiami Programmati</h2>
                                        <div className="text-blue-700/80 font-medium text-sm">Lead parcheggiati in attesa della data prestabilita.</div>
                                    </div>
                                    <div className="w-full flex flex-col bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft">
                                        {sortedDaDefinire.length === 0 ? (
                                            renderEmptyState("La coda dei parcheggiati è vuota.")
                                        ) : (
                                            sortedDaDefinire.map((l, idx) => (
                                                <div key={l.lead.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}>
                                                    {renderRowComponent(l, 'richiami')}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {viewMode === 'storico' && (() => {
                            const filteredStorico = storicoFilter === 'tutti' ? storicoData
                                : storicoFilter === 'confermati' ? storicoData.filter(i => i.lead.confirmationsOutcome === 'confermato')
                                : storicoData.filter(i => i.lead.confirmationsOutcome === 'scartato');
                            const confCount = storicoData.filter(i => i.lead.confirmationsOutcome === 'confermato').length;
                            const scarCount = storicoData.filter(i => i.lead.confirmationsOutcome === 'scartato').length;

                            const handleSetOutcome = async (leadId: string, version: number, outcome: "Chiuso" | "Non chiuso" | "Lead non presenziato", e: React.MouseEvent) => {
                                e.stopPropagation();
                                const res = await setSalespersonOutcome(leadId, version, outcome);
                                if (res.success) fetchLeads(false);
                                else alert(res.error === 'CONCURRENCY_ERROR' ? 'Qualcun altro ha modificato questo lead. Ricarica.' : res.error || 'Errore');
                            };

                            return (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-ash-200/60 shadow-card overflow-hidden mb-8 max-w-[1400px] mx-auto w-full animate-fade-in">
                                <div className="p-4 border-b border-ash-200/40 bg-gradient-to-r from-ash-50 to-white">
                                    <h2 className="text-lg font-black text-ash-800 uppercase tracking-wide flex items-center gap-2"><Archive className="w-5 h-5" /> Storico Conferme</h2>
                                    <div className="flex items-center gap-2 mt-3">
                                        {(['tutti', 'confermati', 'scartati'] as const).map(f => (
                                            <button key={f} onClick={() => setStoricoFilter(f)}
                                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${storicoFilter === f ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-ash-600 border-ash-200 hover:border-brand-orange/30'}`}>
                                                {f === 'tutti' ? `Tutti (${storicoData.length})` : f === 'confermati' ? `Confermati (${confCount})` : `Scartati (${scarCount})`}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto bg-white p-0">
                                    {filteredStorico.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-ash-400 gap-3 py-10">
                                            <div className="w-16 h-16 rounded-2xl bg-ash-50 flex items-center justify-center shadow-soft">
                                                <Archive className="w-8 h-8 text-ash-300" />
                                            </div>
                                            <div className="text-sm font-medium">Nessun lead nello storico</div>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left border-collapse min-w-max">
                                            <thead>
                                                <tr className="bg-gradient-to-r from-ash-50 to-ash-100/50 sticky top-0 border-b border-ash-200/60 text-xs font-bold uppercase tracking-wider text-ash-500 z-10">
                                                    <th className="p-4 pl-6">Lead</th>
                                                    <th className="p-4">Telefono</th>
                                                    <th className="p-4">GDO</th>
                                                    <th className="p-4">Esito Conferma</th>
                                                    <th className="p-4">Esito Vendita</th>
                                                    <th className="p-4">Azioni</th>
                                                    <th className="p-4"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-ash-100/60">
                                                {filteredStorico.map((item) => (
                                                    <tr
                                                        key={item.lead.id}
                                                        className="hover:bg-brand-orange-50/30 transition-all duration-200 cursor-pointer group"
                                                        onClick={() => {
                                                            setSelectedLead(item)
                                                            setIsDrawerOpen(true)
                                                        }}
                                                    >
                                                        <td className="p-4 pl-6 align-top pt-5">
                                                            <div className="font-bold text-ash-800 text-[15px]">{item.lead.name}</div>
                                                            <div className="text-xs text-ash-400 mt-0.5">{item.lead.funnel}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="text-sm text-ash-600 font-medium">{item.lead.phone}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-ash-100 text-ash-700 border border-ash-200/60">
                                                                {item.gdo?.displayName || item.gdo?.name || "N/A"}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            {item.lead.confirmationsOutcome === "confermato" ? (
                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                                                                </span>
                                                            ) : (
                                                                <div>
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-ember-50 text-ember-600 border border-ember-200/60">
                                                                        <XCircle className="w-3.5 h-3.5 mr-1" /> Scartato
                                                                    </span>
                                                                    {item.lead.confirmationsDiscardReason && (
                                                                        <div className="text-[11px] text-ash-400 mt-1 capitalize">{item.lead.confirmationsDiscardReason}</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            {item.lead.salespersonOutcome ? (
                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                                                    item.lead.salespersonOutcome === 'Chiuso' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' :
                                                                    item.lead.salespersonOutcome === 'Non chiuso' ? 'bg-amber-50 text-amber-700 border-amber-200/60' :
                                                                    'bg-rose-50 text-rose-600 border-rose-200/60'
                                                                }`}>
                                                                    {item.lead.salespersonOutcome === 'Chiuso' ? '✅ Chiuso' :
                                                                     item.lead.salespersonOutcome === 'Non chiuso' ? '📋 Presenziato' :
                                                                     '❌ Sparito'}
                                                                </span>
                                                            ) : item.lead.confirmationsOutcome === 'confermato' ? (
                                                                <span className="text-xs text-ash-400 italic">In attesa...</span>
                                                            ) : (
                                                                <span className="text-xs text-ash-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5" onClick={e => e.stopPropagation()}>
                                                            {item.lead.confirmationsOutcome === 'confermato' && !item.lead.salespersonOutcome && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Chiuso', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                                                                        Chiuso
                                                                    </button>
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Non chiuso', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                                                                        Presenziato
                                                                    </button>
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Lead non presenziato', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors">
                                                                        Sparito
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-right align-middle">
                                                            <div className="w-8 h-8 rounded-lg bg-ash-50 border border-ash-200 flex items-center justify-center ml-auto group-hover:bg-brand-orange group-hover:border-brand-orange group-hover:text-white transition-all duration-200 shadow-soft">
                                                                <ChevronRight className="w-4 h-4 text-ash-400 group-hover:text-white transition-colors" />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        );})()}

                        {viewMode === 'table' && (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-ash-200/60 shadow-card overflow-hidden mb-8 max-w-[1400px] mx-auto w-full animate-fade-in">
                                <div className="p-4 border-b border-ash-200/40 bg-gradient-to-r from-ash-50 to-white flex flex-wrap gap-4 items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <div className="flex bg-white border border-ash-200 rounded-xl p-1 shrink-0 shadow-soft">
                                            <button onClick={() => handleDatePreset("today")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "today" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Oggi</button>
                                            <button onClick={() => handleDatePreset("tomorrow")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "tomorrow" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Domani</button>
                                            <button onClick={() => handleDatePreset("7days")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "7days" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Ultimi 7 gg</button>
                                            <button onClick={() => handleDatePreset("all")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "all" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Tutti</button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto bg-white p-0">
                                    {tableData.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-ash-400 gap-3 py-10">
                                            <div className="w-16 h-16 rounded-2xl bg-ash-50 flex items-center justify-center shadow-soft">
                                                <Filter className="w-8 h-8 text-ash-300" />
                                            </div>
                                            <div className="text-sm font-medium">Nessun appuntamento trovato</div>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left border-collapse min-w-max">
                                            <thead>
                                                <tr className="bg-gradient-to-r from-ash-50 to-ash-100/50 sticky top-0 border-b border-ash-200/60 text-xs font-bold uppercase tracking-wider text-ash-500 z-10">
                                                    <th className="p-4 pl-6">Data / Ora</th>
                                                    <th className="p-4">Lead</th>
                                                    <th className="p-4">GDO</th>
                                                    <th className="p-4">Stato</th>
                                                    <th className="p-4"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-ash-100/60">
                                                {tableData.map((item) => (
                                                    <tr
                                                        key={item.lead.id}
                                                        className="hover:bg-brand-orange-50/30 transition-all duration-200 cursor-pointer group"
                                                        onClick={() => {
                                                            setSelectedLead(item)
                                                            setIsDrawerOpen(true)
                                                        }}
                                                    >
                                                        <td className="p-4 pl-6 align-top pt-5">
                                                            {item.lead.confNeedsReschedule ? (
                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-50 to-amber-100 text-amber-800 uppercase tracking-widest border border-amber-200/60">Da Definire</span>
                                                            ) : (
                                                                <>
                                                                    <div className="flex items-center gap-2">
                                                                        <Calendar className="w-4 h-4 text-ash-400" />
                                                                        <span className="font-semibold text-ash-800">
                                                                            {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "dd MMM yyyy", { locale: it }) : "N/D"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 mt-1.5 text-sm font-bold text-brand-orange-600">
                                                                        <Clock className="w-4 h-4" />
                                                                        <span>
                                                                            {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "HH:mm") : "N/D"}
                                                                        </span>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="font-bold text-ash-800 text-[15px]">{item.lead.name}</div>
                                                            <div className="text-sm text-ash-500 mt-0.5">{item.lead.phone}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-ash-100 text-ash-700 border border-ash-200/60">
                                                                {item.gdo?.displayName || item.gdo?.name || "Sconosciuto"}
                                                            </span>
                                                            {item.lead.funnel && <div className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ash-50 text-ash-500 uppercase truncate max-w-[120px]">{item.lead.funnel}</div>}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="flex flex-col gap-2 items-start">
                                                                {(() => {
                                                                    const p = globalPresence.find(p => p.leadId === item.lead.id);
                                                                    if (!p) return null;
                                                                    const who = p.user?.displayName || p.user?.name || 'altro utente';
                                                                    return (
                                                                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800 animate-pulse border border-amber-200 shadow-soft" title={`In uso da ${who}`}>
                                                                            <Users className="w-3 h-3" /> In uso · {who}
                                                                        </span>
                                                                    );
                                                                })()}
                                                                {item.lead.confirmationsOutcome === "confermato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 border border-emerald-200/60 shadow-soft">
                                                                        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confermato
                                                                    </span>
                                                                ) : item.lead.confirmationsOutcome === "scartato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-ember-50 to-rose-50 text-ember-600 border border-ember-200/60 shadow-soft">
                                                                        <XCircle className="w-4 h-4 mr-1.5" /> Scartato
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-50 to-brand-orange-50/30 text-blue-700 border border-blue-200/60 shadow-soft">
                                                                        Da lavorare
                                                                    </span>
                                                                )}

                                                                {(!item.lead.confirmationsOutcome) && (
                                                                    <div className="flex gap-1.5 mt-1" title="Tentativi NR">
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall1At ? 'bg-brand-orange-500 ring-2 ring-brand-orange-200' : 'bg-ash-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall2At ? 'bg-brand-orange-500 ring-2 ring-brand-orange-200' : 'bg-ash-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall3At ? 'bg-ember-400 ring-2 ring-ember-200' : 'bg-ash-200'}`} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-right align-middle">
                                                            <div className="w-8 h-8 rounded-lg bg-ash-50 border border-ash-200 flex items-center justify-center ml-auto group-hover:bg-brand-orange group-hover:border-brand-orange group-hover:text-white transition-all duration-200 shadow-soft">
                                                                <ChevronRight className="w-4 h-4 text-ash-400 group-hover:text-white transition-colors" />
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
