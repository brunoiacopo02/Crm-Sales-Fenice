"use client"

import { useState, useEffect } from "react"
import { getVenditoreAppointments, saveVenditoreOutcome } from "@/app/actions/venditoreActions"
import { Calendar, List, Search, Filter, Phone, Mail, User, Clock, CheckCircle2, AlertCircle, HelpCircle, Trophy } from "lucide-react"
import { format, isSameDay, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns"
import { it } from "date-fns/locale"
import dynamic from "next/dynamic"

const VenditoreDrawer = dynamic(
  () => import("@/components/VenditoreDrawer").then(mod => mod.VenditoreDrawer),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { KpiVenditoriClient } from "@/components/KpiVenditoriClient"
import { getGoogleAuthUrl, checkGoogleCalendarConnection, disconnectGoogleCalendar } from "@/app/actions/calendarActions"
import { createClient } from "@/utils/supabase/client"

export function VenditoreDashboardClient({ sellerId }: { sellerId: string }) {
    const supabase = createClient()
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

        const channel = supabase
            .channel('venditore_leads_updates')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'leads',
                    filter: `salespersonUserId=eq.${sellerId}`
                },
                () => {
                    fetchAppointments()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
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
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-soft border border-ash-200/60 flex flex-col md:flex-row gap-4 items-center justify-between">

                {/* View Toggle */}
                <div className="flex bg-ash-100/80 p-1 rounded-lg">
                    <button
                        onClick={() => setView('LISTA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'LISTA' ? 'bg-white shadow-soft text-brand-charcoal' : 'text-ash-500 hover:text-ash-700'}`}
                    >
                        <List className="h-4 w-4" />
                        Lista
                    </button>
                    <button
                        onClick={() => setView('AGENDA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'AGENDA' ? 'bg-white shadow-soft text-brand-charcoal' : 'text-ash-500 hover:text-ash-700'}`}
                    >
                        <Calendar className="h-4 w-4" />
                        Agenda
                    </button>
                    <button
                        onClick={() => setView('CLASSIFICA')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'CLASSIFICA' ? 'bg-white shadow-soft text-brand-charcoal' : 'text-ash-500 hover:text-ash-700'}`}
                    >
                        <Trophy className="h-4 w-4" />
                        Team Classifica
                    </button>
                </div>

                {/* Filters */}
                {view === 'LISTA' && (
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ash-400" />
                            <input
                                type="text"
                                placeholder="Cerca nome, email, telefono..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-ash-50/50 border border-ash-200/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-all"
                            />
                        </div>
                        <select
                            value={timeSlot}
                            onChange={(e) => setTimeSlot(e.target.value)}
                            className="bg-ash-50/50 border border-ash-200/60 text-ash-700 text-sm rounded-lg focus:ring-brand-orange/30 focus:border-brand-orange p-2.5"
                        >
                            <option value="Tutto">Tutti gli orari</option>
                            <option value="Mattina">Mattina (8-14)</option>
                            <option value="Pomeriggio">Pomeriggio (14-22)</option>
                        </select>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-ash-50/50 border border-ash-200/60 text-ash-700 text-sm rounded-lg focus:ring-brand-orange/30 focus:border-brand-orange p-2.5"
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
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors shadow-soft"
                        >
                            <Calendar className="h-4 w-4" />
                            Google Calendar Connesso
                        </button>
                    ) : (
                        <button
                            onClick={handleConnectCalendar}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-brand-charcoal bg-white border border-ash-200/60 rounded-lg hover:bg-ash-50 shadow-soft transition-colors"
                        >
                            <Calendar className="h-4 w-4" />
                            Connetti Google Calendar
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 min-h-[500px]">
                {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-64 text-ash-400 gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange"></div>
                        <div className="text-sm">Caricamento appuntamenti...</div>
                    </div>
                ) : view === 'LISTA' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-ash-500">
                            <thead className="text-xs text-ash-600 uppercase bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <tr>
                                    <th scope="col" className="px-6 py-4 font-semibold">Giorno e Ora</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">Lead</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">Funnel</th>
                                    <th scope="col" className="px-6 py-4 font-semibold">GDO Fissatore</th>
                                    <th scope="col" className="px-6 py-4 font-semibold text-center">Stato Vendita</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ash-100/60">
                                {filteredAppointments.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-ash-400">Nessun appuntamento trovato.</td>
                                    </tr>
                                ) : filteredAppointments.map((app, idx) => {
                                    const isCompleted = !!app.salespersonOutcome;
                                    const apptDate = app.appointmentDate ? new Date(app.appointmentDate) : null;

                                    return (
                                        <tr
                                            key={app.id}
                                            onClick={() => setSelectedLead(app)}
                                            className="hover:bg-brand-orange-50/30 cursor-pointer transition-all duration-200 group animate-fade-in"
                                            style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-ash-800">
                                                    {apptDate ? format(apptDate, "dd MMM yyyy", { locale: it }) : '-'}
                                                </div>
                                                <div className="text-ash-500 flex items-center gap-1 mt-1">
                                                    <Clock className="w-3 h-3" />
                                                    {apptDate ? format(apptDate, "HH:mm") : '-'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-ash-800">{app.name}</div>
                                                <div className="text-ash-400 text-xs mt-1 flex flex-col gap-0.5">
                                                    <div>{app.phone}</div>
                                                    <div>{app.email}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="inline-flex items-center px-2.5 py-1 rounded-lg bg-brand-orange-50 text-brand-orange-700 text-xs font-medium border border-brand-orange-200/50">
                                                    {app.funnel || 'Non spec.'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-ash-800">{app.gdoName || `GDO ${app.gdoCode}`}</div>
                                                <div className="text-xs text-ash-400">
                                                    il {app.appointmentCreatedAt ? format(new Date(app.appointmentCreatedAt), "dd/MM") : '-'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {isCompleted ? (
                                                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${app.salespersonOutcome === 'Chiuso' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200/50' :
                                                        app.salespersonOutcome === 'Sparito' ? 'bg-ash-100 text-ash-600 border border-ash-200/50' :
                                                            'bg-ember-50 text-ember-700 border border-ember-200/50'
                                                        }`}>
                                                        {app.salespersonOutcome === 'Chiuso' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                                                            app.salespersonOutcome === 'Sparito' ? <HelpCircle className="w-3.5 h-3.5" /> :
                                                                <AlertCircle className="w-3.5 h-3.5" />}
                                                        {app.salespersonOutcome}
                                                    </div>
                                                ) : (
                                                    <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200/50">
                                                        Da Esitare
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : view === 'AGENDA' ? (
                    <div className="p-6 bg-gradient-to-b from-ash-50/50 to-white">
                        {/* Agenda View */}
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
                                    <div key={day} className="animate-fade-in">
                                        <h3 className="text-lg font-bold text-ash-800 border-b border-ash-200/60 pb-2 mb-4 capitalize">
                                            {format(parseISO(day), 'EEEE d MMMM yyyy', { locale: it })}
                                        </h3>
                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                            {(dayApps as any[]).sort((a, b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime()).map((app, idx) => (
                                                <div
                                                    key={app.id}
                                                    onClick={() => setSelectedLead(app)}
                                                    className="border border-ash-200/60 p-4 rounded-xl shadow-soft hover:shadow-card hover:border-brand-orange/30 transition-all duration-200 cursor-pointer bg-white group flex flex-col animate-fade-in"
                                                    style={{ animationDelay: `${Math.min(idx * 50, 300)}ms`, animationFillMode: 'backwards' }}
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="font-bold text-brand-orange text-lg">
                                                            {format(new Date(app.appointmentDate), 'HH:mm')}
                                                        </div>
                                                        <div className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full ${app.salespersonOutcome ? (app.salespersonOutcome === 'Chiuso' ? 'bg-emerald-100 text-emerald-700' : 'bg-ash-100 text-ash-600') : 'bg-brand-orange-50 text-brand-orange-700'}`}>
                                                            {app.salespersonOutcome || 'In programma'}
                                                        </div>
                                                    </div>
                                                    <div className="font-bold text-ash-800 mt-1 line-clamp-1">{app.name}</div>
                                                    <div className="text-sm text-ash-500 line-clamp-1 mt-0.5">{app.phone}</div>
                                                    <div className="mt-auto pt-3 text-xs text-ash-400 flex items-center justify-between border-t border-ash-100/60">
                                                        <div className="mt-2">{app.funnel || 'No funnel'}</div>
                                                        <div className="mt-2">GDO {app.gdoCode || '-'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                            {filteredAppointments.length === 0 && (
                                <div className="text-center text-ash-400 py-12">Nessun appuntamento in agenda.</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="p-2 sm:p-6 bg-gradient-to-b from-ash-50/50 to-white">
                        <KpiVenditoriClient currentUserRole="VENDITORE" currentUserId={sellerId} />
                    </div>
                )}
            </div>


            {/* Drawer */}
            {selectedLead && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                        onClick={() => setSelectedLead(null)}
                    />

                    {/* Drawer Content */}
                    <div className="relative w-full max-w-2xl bg-white h-full shadow-elevated flex flex-col pt-[72px] animate-slide-in-right">
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
