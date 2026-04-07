"use client"

import { useState } from "react"
import { Phone, Mail, CalendarCheck, Clock, CheckCircle2, Pencil } from "lucide-react"
import dynamic from "next/dynamic"

const EditAppointmentModal = dynamic(
  () => import("./EditAppointmentModal").then(mod => mod.EditAppointmentModal),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { updateGdoAppointment } from "@/app/actions/appointmentActions"
import { useRouter } from "next/navigation"

type LeadList = any[]

export function AppointmentBoard({
    upcoming,
    past
}: {
    upcoming: LeadList
    past: LeadList
}) {
    const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')
    const [editingLead, setEditingLead] = useState<any>(null)
    const router = useRouter()
    
    // Sort chronologically
    const sortedUpcoming = [...upcoming].sort((a,b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime())
    const sortedPast = [...past].sort((a,b) => new Date(b.appointmentDate).getTime() - new Date(a.appointmentDate).getTime()) // Past descending
    const currentList = activeTab === 'upcoming' ? sortedUpcoming : sortedPast

    const renderCard = (lead: any, isUpcoming: boolean) => (
        <div key={lead.id} className={`bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-x-4 sm:gap-y-2 group relative overflow-hidden ${isUpcoming ? 'border-green-200 hover:border-green-400' : 'border-ash-200 hover:border-ash-300'}`}>
            {/* Visual Highlight indicator left */}
            {isUpcoming && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>}
            
            {/* Pulsante Modifica Veloce */}
            {isUpcoming && (
                <button 
                    onClick={() => setEditingLead(lead)}
                    className="absolute right-2 top-2 p-1.5 text-ash-400 hover:text-brand-orange hover:bg-orange-50 rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10 bg-white shadow-sm border border-ash-100"
                    title="Modifica Orario/Note Appuntamento"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
            )}

            {/* 1. Nome & Contatti */}
            <div className="flex-1 min-w-0 sm:min-w-[220px] pl-2 flex flex-col justify-center">
                <h3 className="font-bold text-ash-900 text-sm flex items-center gap-2">
                    {lead.name}
                    {isUpcoming ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <CalendarCheck className="h-4 w-4 text-ash-400" />}
                </h3>
                <div className="flex items-center gap-3 text-xs text-ash-500 mt-1">
                    <span className="flex items-center gap-1 hover:text-brand-orange cursor-copy transition-colors">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                    </span>
                    {lead.email && (
                        <span className="flex items-center gap-1 truncate max-w-[140px]" title={lead.email}>
                            <Mail className="h-3 w-3" />
                            {lead.email}
                        </span>
                    )}
                </div>
            </div>

            {/* 2. Funnel Pill */}
            <div className="w-32 hidden md:flex flex-col items-start justify-center">
                {lead.funnel ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-ash-100 text-ash-600 border border-ash-200">
                        {lead.funnel}
                    </span>
                ) : <span className="text-[10px] text-ash-300 italic">No funnel</span>}
            </div>

            {/* 3. Appointment Note */}
            <div className="flex-1 hidden xl:flex flex-col justify-center">
                {lead.appointmentNote ? (
                    <div className="text-xs text-ash-600 line-clamp-2 italic pr-4" title={lead.appointmentNote}>
                        "{lead.appointmentNote}"
                    </div>
                ) : <span className="text-xs text-ash-300 italic">Nessuna nota</span>}
            </div>

            {/* 4. Dates & Action */}
            <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0 w-full sm:w-48 text-left sm:text-right">
                <div className={`text-xs font-bold px-2 py-1 rounded inline-flex items-center justify-end gap-1 w-full ${isUpcoming ? 'bg-green-100 text-green-700' : 'bg-ash-100 text-ash-600'}`}>
                    <CalendarCheck className="h-3 w-3" />
                    {lead.appointmentDate ? new Date(lead.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : 'N/D'}
                </div>
                <div className="text-[10px] text-ash-400 flex items-center gap-1 w-full justify-end">
                    <Clock className="h-3 w-3" /> Fissato il: {lead.appointmentCreatedAt ? new Date(lead.appointmentCreatedAt).toLocaleDateString() : 'N/D'}
                </div>
            </div>

            {/* 5. GDO Feedback Loop (Conferme & Vendita) */}
            {(lead.confirmationsOutcome || lead.salespersonOutcome) && (
                <div className="w-full mt-3 pt-3 border-t border-dashed border-ash-200 flex flex-wrap items-start gap-3 col-span-full">
                    
                    {/* Conferme Badge */}
                    {lead.confirmationsOutcome === 'confermato' && (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Conferme: OK
                        </div>
                    )}
                    {lead.confirmationsOutcome === 'scartato' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-rose-50 text-rose-700 px-2 py-1 rounded border border-rose-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                Conferme: Scartato
                            </div>
                            {lead.confirmationsDiscardReason && (
                                <span className="font-normal italic text-rose-600 ml-3">"{lead.confirmationsDiscardReason}"</span>
                            )}
                        </div>
                    )}

                    {/* Salesperson Badge */}
                    {lead.salespersonOutcome === 'Chiuso' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-gold-50 text-gold-700 px-2 py-1 rounded border border-gold-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gold-500"></span>
                                Esito Finale: CHIUSO
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-gold-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}
                    {lead.salespersonOutcome === 'Non chiuso' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-ash-50 text-ash-700 px-2 py-1 rounded border border-ash-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-ash-500"></span>
                                Esito Finale: Non Chiuso
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-ash-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}
                    {lead.salespersonOutcome === 'Lead non presenziato' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                Esito Finale: Buca (No Show)
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-amber-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}

                </div>
            )}
        </div>
    )

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-ash-200 shadow-sm overflow-hidden max-w-5xl mx-auto">

            {/* STICKY HEADER & TAB BAR */}
            <div className="sticky top-0 z-20 bg-white border-b border-ash-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="flex space-x-1 bg-ash-100/80 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('upcoming')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'upcoming' ? 'bg-green-50 text-green-700 ring-1 ring-green-200 shadow-sm' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            <CheckCircle2 className={`h-4 w-4 ${activeTab === 'upcoming' ? 'text-green-600' : ''}`} />
                            In Programma <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{upcoming.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('past')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'past' ? 'bg-white text-ash-900 ring-1 ring-ash-200 shadow-sm' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            <CalendarCheck className={`h-4 w-4 ${activeTab === 'past' ? 'text-ash-500' : ''}`} />
                            Archivio Storico <span className="text-xs bg-ash-200 text-ash-700 px-1.5 py-0.5 rounded-full">{past.length}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* LIST AREA */}
            <div className="flex-1 overflow-y-auto bg-ash-50/30 p-4">
                <div className="flex flex-col gap-3 max-w-5xl mx-auto">
                    {currentList.map((lead) => renderCard(lead, activeTab === 'upcoming'))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-dashed border-ash-300 rounded-xl">
                            <span className="text-5xl mb-4">{activeTab === 'upcoming' ? '📭' : '📜'}</span>
                            <h3 className="text-lg font-medium text-ash-900">
                                {activeTab === 'upcoming' ? 'Nessun appuntamento in programma' : 'Nessun appuntamento passato'}
                            </h3>
                            <p className="text-ash-500 mt-1 max-w-sm">
                                {activeTab === 'upcoming' ? 'Continua a chiamare lead per fissare appuntamenti.' : 'Le anagrafiche degli appuntamenti scorsi appariranno qui.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal Render */}
            <EditAppointmentModal 
                isOpen={!!editingLead}
                onClose={() => setEditingLead(null)}
                leadName={editingLead?.name || ""}
                initialDate={editingLead?.appointmentDate || null}
                initialNote={editingLead?.appointmentNote || ""}
                onSave={async (dateStr, timeStr, noteStr) => {
                    if (!editingLead) return
                    const newDate = new Date(`${dateStr}T${timeStr}:00`)
                    const result = await updateGdoAppointment(editingLead.id, newDate, noteStr, editingLead.version)
                    if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
                        alert("Questo lead è stato modificato da un altro utente. La pagina verrà aggiornata.")
                        router.refresh()
                        return
                    }
                    setEditingLead(null)
                    router.refresh()
                }}
            />
        </div>
    )
}
