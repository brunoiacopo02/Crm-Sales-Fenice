"use client"

import { useState, useEffect } from "react"
import { getVenditoreAppointments, saveVenditoreOutcome } from "@/app/actions/venditoreActions"
import { Calendar, List, Search, Filter, Phone, Mail, User, Clock, CheckCircle2, AlertCircle, HelpCircle, Trophy } from "lucide-react"
import { format, isSameDay, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns"
import { it } from "date-fns/locale"
import { VenditoreDrawer } from "@/components/VenditoreDrawer"
import { KpiVenditoriClient } from "@/components/KpiVenditoriClient"
import { getGoogleAuthUrl, checkGoogleCalendarConnection, disconnectGoogleCalendar } from "@/app/actions/calendarActions"

export function VenditoreDashboardClient({ sellerId }: { sellerId: string }) {
    const [view, setView] = useState<'LISTA' | 'AGENDA' | 'CLASSIFICA'>('LISTA')
    const [appointments, setAppointments] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isCalendarConnected, setIsCalendarConnected] = useState(false)

    // Filters
    const [search, setSearch] = useState("")
    const [timeSlot, setTimeSlot] = useState("Tutto") // Mattina, Pomeriggio, Tutto
    const [statusFilter, setStatusFilter] = useState("Da fare") // Da fare, Completati, Con follow-up, Tutti

    // Drawer state
    const [selectedLead, setSelectedLead] = useState<any>(null)

    const fetchAppointments = async () => {
        setIsLoading(true)
        try {
            const data = await getVenditoreAppointments(sellerId)
            setAppointments(data)
            const calendarStatus = await checkGoogleCalendarConnection(sellerId)
            setIsCalendarConnected(calendarStatus)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleConnectCalendar = async () => {
        try {
            const url = await getGoogleAuthUrl(sellerId)
            if (url) window.location.href = url
        } catch (error) {
            alert("Errore durante la connessione al calendario")
        }
    }

    const handleDisconnectCalendar = async () => {
        if (confirm("Sei sicuro di voler disconnettere il calendario? Le nuove modifiche non vi verranno più sincronizzate.")) {
            await disconnectGoogleCalendar(sellerId)
            setIsCalendarConnected(false)
        }
    }

    useEffect(() => {
        fetchAppointments()
    }, [sellerId])

    const filteredAppointments = appointments.filter(app => {
        // Search
        const searchLower = search.toLowerCase()
        if (search && !((app.name?.toLowerCase().includes(searchLower)) ||
            (app.email?.toLowerCase().includes(searchLower)) ||
            (app.phone?.includes(searchLower)))) return false

        // Status
        if (statusFilter === "Da fare" && app.salespersonOutcome) return false
        if (statusFilter === "Completati" && !app.salespersonOutcome) return false
        if (statusFilter === "Con follow-up" && (!app.followUp1Date && !app.followUp2Date)) return false

        // Time slot
        if (timeSlot !== "Tutto" && app.appointmentDate) {
            const hour = new Date(app.appointmentDate).getHours()
            if (timeSlot === "Mattina" && (hour < 8 || hour >= 14)) return false
            if (timeSlot === "Pomeriggio" && (hour < 14 || hour >= 22)) return false
        }

        return true
    })

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Toolbar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-4 items-center justify-between">

                {/* View Toggle */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setView('LISTA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'LISTA' ? 'bg-white shadow-sm text-brand-charcoal' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <List className="h-4 w-4" />
                        Lista
                    </button>
                    <button
                        onClick={() => setView('AGENDA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'AGENDA' ? 'bg-white shadow-sm text-brand-charcoal' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Calendar className="h-4 w-4" />
                        Agenda
                    </button>
                    <button
                        onClick={() => setView('CLASSIFICA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'CLASSIFICA' ? 'bg-white shadow-sm text-brand-charcoal' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Trophy className="h-4 w-4" />
                        Team Classifica
                    </button>
                </div>

                {/* Filters */}
                {view === 'LISTA' && (
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Cerca nome, email, telefono..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-brand-orange transition-all"
                            />
                        </div>
                        <select
                            value={timeSlot}
                            onChange={(e) => setTimeSlot(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange p-2.5"
                        >
                            <option value="Tutto">Tutti gli orari</option>
                            <option value="Mattina">Mattina (8-14)</option>
                            <option value="Pomeriggio">Pomeriggio (14-22)</option>
                        </select>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-brand-orange focus:border-brand-orange p-2.5"
                        >
                            <option value="Tutti">Tutti gli stati</option>
                            <option value="Da fare">Da chiudere</option>
                            <option value="Completati">Chiusi/Esitati</option>
                            <option value="Con follow-up">In Follow-up</option>
                        </select>
                    </div>
                )}

                {/* Calendar Connect Button */}
                <div className="ml-auto">
                    {isCalendarConnected ? (
                        <button
                            onClick={handleDisconnectCalendar}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
                        >
                            <Calendar className="h-4 w-4" />
                            Google Calendar Connesso
                        </button>
                    ) : (
                        <button
                            onClick={handleConnectCalendar}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-brand-charcoal bg-white border border-gray-300 rounded-md hover:bg-gray-50 shadow-sm transition-colors"
                        >
                            <Calendar className="h-4 w-4" />
                            Connetti Google Calendar
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
                {isLoading ? (
                    <div className="flex justify-center items-center h-64 text-gray-500">Caricamento appuntamenti...</div>
                ) : view === 'LISTA' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th scope="col" className="px-6 py-4 font-semibold">Giorno e Ora</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">Lead</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">Funnel</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">GDO Fissatore</th>
                                    <th scope="col" className="px-6 py-4 font-semibold text-center">Stato Vendita</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredAppointments.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-gray-500">Nessun appuntamento trovato.</td>
                                    </tr>
                                ) : filteredAppointments.map(app => {
                                    const isCompleted = !!app.salespersonOutcome;
                                    const apptDate = app.appointmentDate ? new Date(app.appointmentDate) : null;

                                    return (
                                        <tr
                                            key={app.id}
                                            onClick={() => setSelectedLead(app)}
                                            className="hover:bg-brand-orange/5 cursor-pointer transition-colors group"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-gray-900">
                                                    {apptDate ? format(apptDate, "dd MMM yyyy", { locale: it }) : '-'}
                                                </div>
                                                <div className="text-gray-500 flex items-center gap-1 mt-1">
                                                    <Clock className="w-3 h-3" />
                                                    {apptDate ? format(apptDate, "HH:mm") : '-'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-gray-900">{app.name}</div>
                                                <div className="text-gray-500 text-xs mt-1 flex flex-col gap-0.5">
                                                    <span>{app.phone}</span>
                                                    <span>{app.email}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium">
                                                    {app.funnel || 'Non spec.'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-gray-900">{app.gdoName || `GDO ${app.gdoCode}`}</div>
                                                <div className="text-xs text-gray-400">
                                                    il {app.appointmentCreatedAt ? format(new Date(app.appointmentCreatedAt), "dd/MM") : '-'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {isCompleted ? (
                                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${app.salespersonOutcome === 'Chiuso' ? 'bg-green-100 text-green-700' :
                                                        app.salespersonOutcome === 'Sparito' ? 'bg-gray-100 text-gray-700' :
                                                            'bg-orange-100 text-orange-700'
                                                        }`}>
                                                        {app.salespersonOutcome === 'Chiuso' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                                                            app.salespersonOutcome === 'Sparito' ? <HelpCircle className="w-3.5 h-3.5" /> :
                                                                <AlertCircle className="w-3.5 h-3.5" />}
                                                        {app.salespersonOutcome}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                                                        Da Esitare
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : view === 'AGENDA' ? (
                    <div className="p-6">
                        {/* Agenda View Simple Implementation */}
                        <div className="space-y-8">
                            {Object.entries(
                                filteredAppointments.reduce((groups, app) => {
                                    if (!app.appointmentDate) return groups;
                                    const day = format(new Date(app.appointmentDate), 'yyyy-MM-dd');
                                    if (!groups[day]) groups[day] = [];
                                    groups[day].push(app);
                                    return groups;
                                }, {} as Record<string, any[]>)
                            ).sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
                                .map(([day, dayApps]) => (
                                    <div key={day}>
                                        <h3 className="text-lg font-bold text-gray-800 border-b border-gray-200 pb-2 mb-4 capitalize">
                                            {format(parseISO(day), 'EEEE d MMMM yyyy', { locale: it })}
                                        </h3>
                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                            {(dayApps as any[]).sort((a, b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime()).map(app => (
                                                <div
                                                    key={app.id}
                                                    onClick={() => setSelectedLead(app)}
                                                    className="border border-gray-200 p-4 rounded-xl shadow-sm hover:border-brand-orange hover:shadow-md transition-all cursor-pointer bg-white group flex flex-col"
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="font-bold text-brand-orange text-lg">
                                                            {format(new Date(app.appointmentDate), 'HH:mm')}
                                                        </div>
                                                        <span className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full ${app.salespersonOutcome ? (app.salespersonOutcome === 'Chiuso' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600') : 'bg-blue-100 text-blue-700'}`}>
                                                            {app.salespersonOutcome || 'In programma'}
                                                        </span>
                                                    </div>
                                                    <div className="font-bold text-gray-900 mt-1 line-clamp-1">{app.name}</div>
                                                    <div className="text-sm text-gray-500 line-clamp-1 mt-0.5">{app.phone}</div>
                                                    <div className="mt-auto pt-3 text-xs text-gray-400 flex items-center justify-between">
                                                        <span>{app.funnel || 'No funnel'}</span>
                                                        <span>GDO {app.gdoCode || '-'}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                            {filteredAppointments.length === 0 && (
                                <div className="text-center text-gray-500 py-12">Nessun appuntamento in agenda.</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="p-2 sm:p-6 bg-gray-50">
                        <KpiVenditoriClient currentUserRole="VENDITORE" currentUserId={sellerId} />
                    </div>
                )}
            </div>


            {/* Drawer */}
            {/* Drawer */}
            {selectedLead && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/40 transition-opacity"
                        onClick={() => setSelectedLead(null)}
                    />

                    {/* Drawer Content */}
                    <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col pt-[72px]">
                        <VenditoreDrawer
                            lead={selectedLead}
                            onClose={() => setSelectedLead(null)}
                            onSaved={() => {
                                setSelectedLead(null)
                                fetchAppointments()
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
