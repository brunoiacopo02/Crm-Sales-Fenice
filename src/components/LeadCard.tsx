"use client"

import { useState } from "react"
import { Phone, Mail, Calendar as CalendarIcon, Ban, Clock, CheckCircle2, MoreVertical, Copy } from "lucide-react"
import { GdoQuickActions } from "./GdoQuickActions"

type LeadProps = {
    lead: {
        id: string
        name: string
        phone: string
        email: string | null
        funnel: string | null
        callCount: number
        lastCallDate: Date | null
        status: string
        version: number
        recallDate?: Date | null
        appointmentDate?: Date | null
    }
    onOutcomeClick: (leadId: string) => void
    isRowLayout?: boolean
}

export function LeadCard({ lead, onOutcomeClick, isRowLayout = false }: LeadProps) {

    // Status badges formatting
    let statusText = "Nuovo"
    let statusColor = "bg-blue-100 text-blue-700"

    if (lead.status === 'IN_PROGRESS') {
        if (lead.callCount === 1) { statusText = "2ª Chiamata"; statusColor = "bg-amber-100 text-amber-700" }
        else if (lead.callCount === 2) { statusText = "3ª Chiamata"; statusColor = "bg-red-100 text-red-700" }

        if (lead.recallDate) {
            const isExpired = new Date(lead.recallDate) < new Date()
            statusText = isExpired ? "Richiamo Scaduto" : "Richiamo Arrivo"
            statusColor = isExpired ? "bg-red-100 text-red-700 font-bold border border-red-200" : "bg-orange-100 text-orange-700"
        }
    } else if (lead.status === 'APPOINTMENT') {
        statusText = "Fissato"
        statusColor = "bg-green-100 text-green-700"
    }

    if (isRowLayout) {
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md hover:border-brand-orange/30 transition-all flex items-center justify-between gap-4 group cursor-pointer relative">
                {/* Visual Highlight indicator left */}
                {lead.recallDate && new Date(lead.recallDate) < new Date() && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-lg"></div>
                )}

                {/* 1. Nome & Contatti (Orizzontale compatto) */}
                <div className="flex-1 min-w-[220px] pl-2 flex flex-col justify-center">
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                        {lead.name}
                        {lead.status === 'APPOINTMENT' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        <div className="flex items-center gap-1 group/phone">
                            <Phone className="h-3 w-3" />
                            {lead.phone}
                            <button 
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                                className="ml-1 p-1 hover:bg-gray-200 text-gray-400 hover:text-brand-orange rounded transition-colors opacity-0 group-hover/phone:opacity-100"
                                title="Copia numero"
                            >
                                <Copy className="h-3 w-3" />
                            </button>
                        </div>
                        {lead.email && (
                            <div className="flex items-center gap-1 max-w-[170px] group/email text-xs">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="truncate" title={lead.email}>{lead.email}</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.email ?? ''); alert('Email copiata!'); }}
                                    className="ml-0.5 p-1 hover:bg-gray-200 text-gray-400 hover:text-brand-orange rounded transition-colors opacity-0 group-hover/email:opacity-100 shrink-0"
                                    title="Copia email"
                                >
                                    <Copy className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Funnel & Status Pills */}
                <div className="w-48 hidden md:flex flex-col items-start gap-1.5">
                    {lead.funnel ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
                            {lead.funnel}
                        </span>
                    ) : <span className="text-[10px] text-gray-300 italic">No funnel</span>}

                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                        {statusText}
                    </span>
                </div>

                {/* 3. Last Activity Info */}
                <div className="w-48 hidden lg:flex flex-col text-xs text-gray-500 justify-center">
                    {lead.recallDate ? (
                        <div className="flex items-center gap-1.5 font-medium text-orange-600">
                            <CalendarIcon className="h-3.5 w-3.5" />
                            {new Date(lead.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                        </div>
                    ) : lead.appointmentDate ? (
                        <div className="flex items-center gap-1.5 font-bold text-green-600">
                            <CalendarIcon className="h-3.5 w-3.5" />
                            {new Date(lead.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                        </div>
                    ) : lead.lastCallDate ? (
                        <div className="flex items-center gap-1.5 text-gray-600">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            {new Date(lead.lastCallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                        </div>
                    ) : (
                        <span className="text-gray-400 italic">Mai chiamato</span>
                    )}
                </div>

                {/* 4. Actions Right */}
                <div className="flex items-center justify-end shrink-0 pl-2">
                    <GdoQuickActions leadId={lead.id} leadVersion={lead.version} />
                </div>
            </div>
        )
    }

    // Default Fallback (Vecchia visualizzazione verticale, usata in altri contesti se serve)
    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow mb-3 flex flex-col relative group">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <h3 className="font-semibold text-gray-800 text-base">{lead.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mt-1 group/phone">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                        <button 
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                            className="ml-1 p-1 hover:bg-gray-100 text-gray-400 hover:text-brand-orange rounded transition-colors opacity-0 group-hover/phone:opacity-100"
                            title="Copia numero"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <button className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="h-4 w-4" />
                </button>
            </div>
            {lead.funnel && (
                <div className="mb-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                        {lead.funnel}
                    </span>
                </div>
            )}
            <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                <GdoQuickActions leadId={lead.id} leadVersion={lead.version} />
            </div>
        </div>
    )
}
