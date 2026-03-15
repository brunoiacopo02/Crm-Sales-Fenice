"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, AlertCircle, CheckCircle } from "lucide-react"
import { getConfermeAppointments } from "@/app/actions/confermeActions"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { ConfermeDrawer } from "@/components/ConfermeDrawer"
import { GlobalAlertListener } from "@/components/GlobalAlertListener"
import { TeamRadarWidget } from "@/components/TeamRadarWidget"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"

type LeadData = any;

const WORK_HOURS = Array.from({ length: 11 }, (_, i) => `${(i + 8).toString().padStart(2, '0')}:00`); /* 08:00 to 18:00 */

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [leadsResponse, setLeadsResponse] = useState<{ groupedByHour: Record<string, LeadData[]>, daDefinire: LeadData[], flatList: LeadData[] }>({
        groupedByHour: {},
        daDefinire: [],
        flatList: []
    })
    const [loading, setLoading] = useState(true)

    const [dateRange, setDateRange] = useState<{ start?: Date, end?: Date }>({
        start: new Date(new Date().setHours(0, 0, 0, 0)),
        end: new Date(new Date().setHours(23, 59, 59, 999)),
    })
    const [datePreset, setDatePreset] = useState("today")
    const [searchQuery, setSearchQuery] = useState("")

    const [selectedSlot, setSelectedSlot] = useState<string | "da_definire">("tutti")

    const [selectedLead, setSelectedLead] = useState<LeadData | null>(null)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    const [globalPresence, setGlobalPresence] = useState<any[]>([])

    const fetchLeads = async () => {
        setLoading(true)
        try {
            const data = await getConfermeAppointments({
                startDate: dateRange.start,
                endDate: dateRange.end,
                timeSlot: "tutto",
                searchQuery,
                confermeStatus: "tutti"
            })
            // @ts-ignore
            setLeadsResponse(data)
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
    }, [searchQuery, dateRange])

    useEffect(() => {
        const interval = setInterval(() => {
            loadPresence()
        }, 5000)
        return () => clearInterval(interval)
    }, [])

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

    const getHourStatus = (leadsInHour: LeadData[]) => {
        if (!leadsInHour || leadsInHour.length === 0) return 'green'
        const now = new Date()

        for (const item of leadsInHour) {
            const lead = item.lead
            const isWithoutOutcome = !lead.confirmationsOutcome
            const hasLessThan3Calls = !lead.confCall1At || !lead.confCall2At || !lead.confCall3At
            const mappedApptDate = lead.appointmentDate ? new Date(lead.appointmentDate) : now
            const mappedRecallDate = lead.recallDate ? new Date(lead.recallDate) : null

            if (isWithoutOutcome) {
                if (hasLessThan3Calls) return 'red'
                if (mappedRecallDate && mappedRecallDate <= mappedApptDate) return 'red'
            }
        }
        return 'green'
    }

    const displayedLeads = selectedSlot === "tutti"
        ? leadsResponse.flatList
        : selectedSlot === "da_definire"
            ? leadsResponse.daDefinire
            : leadsResponse.groupedByHour[selectedSlot] || []

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <GlobalAlertListener currentUser={currentUser} />
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

            <div className="flex flex-1 overflow-hidden">
                <div className="w-72 border-r border-gray-200 bg-slate-50 overflow-y-auto p-4 flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1 mb-1">Torre di Controllo</h3>

                    <button
                        onClick={() => setSelectedSlot("tutti")}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${selectedSlot === "tutti" ? "bg-brand-blue-dark text-white shadow ring-2 ring-brand-blue-dark border-transparent" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:shadow-sm"}`}
                    >
                        <span className="font-semibold text-sm">Tutti gli Orari</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${selectedSlot === "tutti" ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>{leadsResponse.flatList.length}</span>
                    </button>

                    <div className="h-px bg-gray-200 my-1 mx-2" />

                    {WORK_HOURS.map(hourStr => {
                        const leadsInHour = leadsResponse.groupedByHour[hourStr] || []
                        const status = getHourStatus(leadsInHour)

                        return (
                            <button
                                key={hourStr}
                                onClick={() => setSelectedSlot(hourStr)}
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${selectedSlot === hourStr ? "bg-brand-blue-dark text-white ring-2 ring-brand-blue shadow border-transparent" : "bg-white text-gray-700 border-gray-200 hover:border-brand-blue hover:shadow-sm"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <Clock className={`w-4 h-4 ${selectedSlot === hourStr ? "text-brand-orange" : "text-gray-400"}`} />
                                    <span className="font-semibold">{hourStr}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${selectedSlot === hourStr ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>{leadsInHour.length}</span>
                                    {status === 'red' ? (
                                        <AlertCircle className="w-5 h-5 text-red-500 bg-red-50 rounded-full" />
                                    ) : (
                                        <CheckCircle className="w-5 h-5 text-green-500 bg-green-50 rounded-full" />
                                    )}
                                </div>
                            </button>
                        )
                    })}

                    <div className="h-px bg-gray-200 my-1 mx-2" />

                    <button
                        onClick={() => setSelectedSlot("da_definire")}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${selectedSlot === "da_definire" ? "bg-amber-500 text-white shadow ring-2 ring-amber-600 border-transparent" : "bg-amber-50 text-amber-900 border-amber-200 hover:border-amber-400 hover:shadow-sm"}`}
                    >
                        <span className="font-semibold text-sm">Da Definire</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${selectedSlot === "da_definire" ? "bg-black/10" : "bg-amber-100 text-amber-800"}`}>{leadsResponse.daDefinire.length}</span>
                    </button>

                    <div className="mt-4">
                        <TeamRadarWidget currentUser={currentUser} />
                    </div>
                </div>

                <div className="flex-1 overflow-auto bg-white">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-brand-blue">
                            <div className="animate-spin w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full mb-4 mx-auto"></div>
                        </div>
                    ) : displayedLeads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                                <Filter className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="text-sm font-medium">Nessun appuntamento in questo slot orario.</p>
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
                                {displayedLeads.map((item) => (
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

            <ConfermeDrawer
                isOpen={isDrawerOpen}
                onClose={() => {
                    setIsDrawerOpen(false)
                    fetchLeads()
                }}
                item={selectedLead}
                currentUser={currentUser}
                onRefresh={fetchLeads}
            />
        </div>
    )
}
