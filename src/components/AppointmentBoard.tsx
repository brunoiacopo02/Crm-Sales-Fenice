"use client"

import { useState } from "react"
import { Phone, Mail, CalendarCheck, Clock, CheckCircle2 } from "lucide-react"

type LeadList = any[]

export function AppointmentBoard({
    upcoming,
    past
}: {
    upcoming: LeadList
    past: LeadList
}) {
    const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')
    const currentList = activeTab === 'upcoming' ? upcoming : past

    const renderCard = (lead: any, isUpcoming: boolean) => (
        <div key={lead.id} className={`bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-all flex items-center justify-between gap-4 group relative overflow-hidden ${isUpcoming ? 'border-green-200 hover:border-green-400' : 'border-gray-200 hover:border-gray-300'}`}>
            {/* Visual Highlight indicator left */}
            {isUpcoming && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>}

            {/* 1. Nome & Contatti */}
            <div className="flex-1 min-w-[220px] pl-2 flex flex-col justify-center">
                <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                    {lead.name}
                    {isUpcoming ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <CalendarCheck className="h-4 w-4 text-gray-400" />}
                </h3>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
                        {lead.funnel}
                    </span>
                ) : <span className="text-[10px] text-gray-300 italic">No funnel</span>}
            </div>

            {/* 3. Appointment Note */}
            <div className="flex-1 hidden xl:flex flex-col justify-center">
                {lead.appointmentNote ? (
                    <div className="text-xs text-gray-600 line-clamp-2 italic pr-4" title={lead.appointmentNote}>
                        "{lead.appointmentNote}"
                    </div>
                ) : <span className="text-xs text-gray-300 italic">Nessuna nota</span>}
            </div>

            {/* 4. Dates & Action */}
            <div className="flex flex-col items-end gap-1.5 shrink-0 w-48 text-right">
                <div className={`text-xs font-bold px-2 py-1 rounded inline-flex items-center justify-end gap-1 w-full ${isUpcoming ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    <CalendarCheck className="h-3 w-3" />
                    {lead.appointmentDate ? new Date(lead.appointmentDate).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'N/D'}
                </div>
                <div className="text-[10px] text-gray-400 flex items-center gap-1 w-full justify-end">
                    <Clock className="h-3 w-3" /> Generato il: {lead.appointmentCreatedAt ? new Date(lead.appointmentCreatedAt).toLocaleDateString() : 'N/D'}
                </div>
            </div>
        </div>
    )

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-5xl mx-auto">

            {/* STICKY HEADER & TAB BAR */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="flex space-x-1 bg-gray-100/80 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('upcoming')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'upcoming' ? 'bg-green-50 text-green-700 ring-1 ring-green-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <CheckCircle2 className={`h-4 w-4 ${activeTab === 'upcoming' ? 'text-green-600' : ''}`} />
                            In Programma <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{upcoming.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('past')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'past' ? 'bg-white text-gray-900 ring-1 ring-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <CalendarCheck className={`h-4 w-4 ${activeTab === 'past' ? 'text-gray-500' : ''}`} />
                            Archivio Storico <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full">{past.length}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* LIST AREA */}
            <div className="flex-1 overflow-y-auto bg-gray-50/30 p-4">
                <div className="flex flex-col gap-3 max-w-5xl mx-auto">
                    {currentList.map((lead) => renderCard(lead, activeTab === 'upcoming'))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-dashed border-gray-300 rounded-xl">
                            <span className="text-5xl mb-4">{activeTab === 'upcoming' ? '📭' : '📜'}</span>
                            <h3 className="text-lg font-medium text-gray-900">
                                {activeTab === 'upcoming' ? 'Nessun appuntamento in programma' : 'Nessun appuntamento passato'}
                            </h3>
                            <p className="text-gray-500 mt-1 max-w-sm">
                                {activeTab === 'upcoming' ? 'Continua a chiamare lead per fissare appuntamenti.' : 'Le anagrafiche degli appuntamenti scorsi appariranno qui.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
