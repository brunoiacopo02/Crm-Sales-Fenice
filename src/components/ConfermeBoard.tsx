"use client"

import { useState, useEffect } from "react"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users } from "lucide-react"
import { getConfermeAppointments } from "@/app/actions/confermeActions"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { ConfermeDrawer } from "@/components/ConfermeDrawer"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"

type LeadData = any;

export function ConfermeBoard({ currentUser }: { currentUser: any }) {
    const [leads, setLeads] = useState<LeadData[]>([])
    const [loading, setLoading] = useState(true)

    // Filters
    const [dateRange, setDateRange] = useState<{ start?: Date, end?: Date }>({
        start: new Date(new Date().setHours(0, 0, 0, 0)), // default today
        end: new Date(new Date().setHours(23, 59, 59, 999)),
    })
    const [datePreset, setDatePreset] = useState("today")

    const [timeSlot, setTimeSlot] = useState<"mattina" | "pomeriggio" | "tutto">("tutto")
    const [searchQuery, setSearchQuery] = useState("")
    const [status, setStatus] = useState<"da_lavorare" | "confermati" | "scartati" | "tutti">("da_lavorare")

    const [selectedLead, setSelectedLead] = useState<LeadData | null>(null)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    // Presence
    const [globalPresence, setGlobalPresence] = useState<any[]>([])

    const fetchLeads = async () => {
        setLoading(true)
        try {
            const data = await getConfermeAppointments({
                startDate: dateRange.start,
                endDate: dateRange.end,
                timeSlot,
                searchQuery,
                confermeStatus: status
            })
            setLeads(data)
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

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads()
        }, 400)
        return () => clearTimeout(timer)
    }, [searchQuery, timeSlot, status, dateRange])

    // Background polling for presence
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

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-4 items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 py-2 shrink-0">
                        <Search className="w-4 h-4 text-gray-400 mr-2" />
                        <input
                            type="text"
                            placeholder="Cerca per nome, email o telefono..."
                            className="bg-transparent border-none outline-none text-sm w-64"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Pre-set data */}
                    <div className="flex bg-white border border-gray-300 rounded-lg p-1 shrink-0">
                        <button onClick={() => handleDatePreset("today")} className={`px-3 py-1 text-xs font-medium rounded-md ${datePreset === "today" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Oggi</button>
                        <button onClick={() => handleDatePreset("tomorrow")} className={`px-3 py-1 text-xs font-medium rounded-md ${datePreset === "tomorrow" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Domani</button>
                        <button onClick={() => handleDatePreset("7days")} className={`px-3 py-1 text-xs font-medium rounded-md ${datePreset === "7days" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Ultimi 7 gg</button>
                        <button onClick={() => handleDatePreset("all")} className={`px-3 py-1 text-xs font-medium rounded-md ${datePreset === "all" ? "bg-brand-orange text-white" : "text-gray-600 hover:bg-gray-100"}`}>Tutti</button>
                    </div>

                    <select
                        value={timeSlot}
                        onChange={(e) => setTimeSlot(e.target.value as any)}
                        className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange shrink-0"
                    >
                        <option value="tutto">Tutta la giornata</option>
                        <option value="mattina">Mattina (08:00 - 14:00)</option>
                        <option value="pomeriggio">Pomeriggio (15:00 - 23:00)</option>
                    </select>
                </div>

                <div className="flex gap-1 bg-white p-1 rounded-lg border border-gray-300 shrink-0">
                    <button onClick={() => setStatus("da_lavorare")} className={`px-4 py-1.5 text-sm font-medium rounded-md ${status === "da_lavorare" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Da lavorare</button>
                    <button onClick={() => setStatus("confermati")} className={`px-4 py-1.5 text-sm font-medium rounded-md ${status === "confermati" ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Confermati</button>
                    <button onClick={() => setStatus("scartati")} className={`px-4 py-1.5 text-sm font-medium rounded-md ${status === "scartati" ? "bg-red-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>Scartati</button>
                    <button onClick={() => setStatus("tutti")} className={`px-4 py-1.5 text-sm font-medium rounded-md ${status === "tutti" ? "bg-gray-200 text-gray-800" : "text-gray-600 hover:bg-gray-100"}`}>Tutti</button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto bg-gray-50/50">
                {loading ? (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                        <div className="animate-spin w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full mb-4 mx-auto"></div>
                    </div>
                ) : leads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <Filter className="w-12 h-12 text-gray-300 mb-2" />
                        <p>Nessun appuntamento trovato per i filtri correnti.</p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-100 border-b border-gray-200 text-sm text-gray-600">
                                <th className="p-4 font-semibold">Data / Ora</th>
                                <th className="p-4 font-semibold">Lead</th>
                                <th className="p-4 font-semibold">GDO</th>
                                <th className="p-4 font-semibold">Stato</th>
                                <th className="p-4 font-semibold">Fissato il</th>
                                <th className="p-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {leads.map((item) => (
                                <tr
                                    key={item.lead.id}
                                    className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                                    onClick={() => {
                                        setSelectedLead(item)
                                        setIsDrawerOpen(true)
                                    }}
                                >
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-gray-400" />
                                            <span className="font-medium text-gray-900">
                                                {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "dd MMM yyyy", { locale: it }) : "N/D"}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                                            <Clock className="w-4 h-4" />
                                            <span>
                                                {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "HH:mm") : "N/D"}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <p className="font-semibold text-gray-900">{item.lead.name}</p>
                                        <p className="text-xs text-gray-500">{item.lead.phone}</p>
                                    </td>
                                    <td className="p-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                            {item.gdo?.displayName || item.gdo?.name || "Sconosciuto"}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            {globalPresence.find(p => p.leadId === item.lead.id) && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800 animate-pulse border border-yellow-200">
                                                    <Users className="w-3 h-3" /> In Lavoro
                                                </span>
                                            )}
                                        </div>
                                        {item.lead.confirmationsOutcome === "confermato" ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20">
                                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                                            </span>
                                        ) : item.lead.confirmationsOutcome === "scartato" ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10">
                                                <XCircle className="w-3.5 h-3.5 mr-1" /> Scartato
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
                                                Da lavorare
                                            </span>
                                        )}
                                        {item.lead.salespersonAssigned && (
                                            <p className="text-xs text-gray-500 mt-1">
                                                Ass: {item.lead.salespersonAssigned}
                                            </p>
                                        )}
                                        {item.lead.salespersonOutcome && (
                                            <p className="text-[10px] font-bold text-brand-orange uppercase mt-1">
                                                {item.lead.salespersonOutcome}
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-4 text-sm text-gray-500">
                                        {item.lead.appointmentCreatedAt ? format(new Date(item.lead.appointmentCreatedAt), "dd/MM/yy HH:mm") : ""}
                                    </td>
                                    <td className="p-4 text-right">
                                        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-brand-orange ml-auto transition-colors" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <ConfermeDrawer
                isOpen={isDrawerOpen}
                onClose={() => {
                    setIsDrawerOpen(false)
                    fetchLeads() // refresh su close se c'è stato un update
                }}
                item={selectedLead}
                currentUser={currentUser}
                onRefresh={fetchLeads}
            />
        </div>
    )
}
