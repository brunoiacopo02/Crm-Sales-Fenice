"use client"

import { useState, useEffect } from "react"
import { Phone, Mail, Calendar as CalendarIcon, Ban, Clock, CheckCircle2, MoreVertical, Copy, AlertCircle, Zap } from "lucide-react"
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
    // Client-side time for expiry checks (avoids hydration mismatch)
    const [clientNow, setClientNow] = useState(0)
    useEffect(() => { setClientNow(Date.now()) }, [])

    // Status badge config with gradient styling
    let statusText = "Nuovo"
    let statusClasses = "bg-blue-50 text-blue-700 border-blue-200/60"
    let statusDot = "bg-blue-400"
    let leftAccent = ""

    if (lead.status === 'IN_PROGRESS') {
        if (lead.callCount === 1) {
            statusText = "2ª Chiamata"
            statusClasses = "bg-gold-50 text-gold-700 border-gold-200/60"
            statusDot = "bg-gold-400"
        } else if (lead.callCount === 2) {
            statusText = "3ª Chiamata"
            statusClasses = "bg-ember-50 text-ember-700 border-ember-200/60"
            statusDot = "bg-ember-400"
        }

        if (lead.recallDate) {
            const isExpired = clientNow > 0 && new Date(lead.recallDate).getTime() < clientNow
            if (isExpired) {
                statusText = "Richiamo Scaduto"
                statusClasses = "bg-ember-100 text-ember-700 border-ember-300 font-bold"
                statusDot = "bg-ember-500 animate-glow-pulse"
                leftAccent = "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-gradient-to-b before:from-ember-400 before:to-ember-600 before:rounded-l-xl"
            } else {
                statusText = "Richiamo Arrivo"
                statusClasses = "bg-brand-orange-50 text-brand-orange-700 border-brand-orange-200/60"
                statusDot = "bg-brand-orange-400"
            }
        }
    } else if (lead.status === 'APPOINTMENT') {
        statusText = "Fissato"
        statusClasses = "bg-emerald-50 text-emerald-700 border-emerald-200/60"
        statusDot = "bg-emerald-500"
    }

    if (isRowLayout) {
        return (
            <div className={`relative bg-white border border-ash-200/80 rounded-xl px-4 py-3 shadow-soft hover:shadow-card hover:border-brand-orange/30 transition-all duration-200 flex items-center justify-between gap-4 group cursor-pointer ${leftAccent}`}>

                {/* 1. Nome & Contatti */}
                <div className="flex-1 min-w-[220px] flex flex-col justify-center">
                    <div className="font-bold text-ash-900 text-sm flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            {lead.name}
                            {lead.status === 'APPOINTMENT' && (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ash-500 mt-1.5">
                        <div className="flex items-center gap-1.5 group/phone">
                            <Phone className="h-3 w-3 text-ash-400" />
                            <div className="font-medium text-ash-600">{lead.phone}</div>
                            <button
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                                className="ml-0.5 p-1 hover:bg-brand-orange-50 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/phone:opacity-100"
                                title="Copia numero"
                            >
                                <Copy className="h-3 w-3" />
                            </button>
                        </div>
                        {lead.email && (
                            <div className="flex items-center gap-1.5 max-w-[170px] group/email">
                                <Mail className="h-3 w-3 text-ash-400 shrink-0" />
                                <div className="truncate text-ash-500" title={lead.email}>{lead.email}</div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.email ?? ''); alert('Email copiata!'); }}
                                    className="ml-0.5 p-1 hover:bg-brand-orange-50 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/email:opacity-100 shrink-0"
                                    title="Copia email"
                                >
                                    <Copy className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Funnel & Status Pills */}
                <div className="w-52 hidden md:flex flex-col items-start gap-2">
                    {lead.funnel ? (
                        <div className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-ash-100 text-ash-600 border border-ash-200/80">
                            {lead.funnel}
                        </div>
                    ) : <div className="text-[10px] text-ash-300 italic">No funnel</div>}

                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${statusClasses}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDot} shrink-0`} />
                        {statusText}
                    </div>
                </div>

                {/* 3. Last Activity Info */}
                <div className="w-48 hidden lg:flex flex-col text-xs justify-center">
                    {lead.recallDate ? (
                        <div className="flex items-center gap-2 font-semibold text-brand-orange-600">
                            <div className="w-7 h-7 rounded-lg bg-brand-orange-50 flex items-center justify-center shrink-0">
                                <CalendarIcon className="h-3.5 w-3.5 text-brand-orange-500" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Richiamo</div>
                                <div>{new Date(lead.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                            </div>
                        </div>
                    ) : lead.appointmentDate ? (
                        <div className="flex items-center gap-2 font-bold text-emerald-600">
                            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                                <CalendarIcon className="h-3.5 w-3.5 text-emerald-500" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Appuntamento</div>
                                <div>{new Date(lead.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                            </div>
                        </div>
                    ) : lead.lastCallDate ? (
                        <div className="flex items-center gap-2 text-ash-500">
                            <div className="w-7 h-7 rounded-lg bg-ash-100 flex items-center justify-center shrink-0">
                                <Clock className="h-3.5 w-3.5 text-ash-400" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Ultima chiamata</div>
                                <div>{new Date(lead.lastCallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-ash-400 italic">
                            <div className="w-7 h-7 rounded-lg bg-ash-50 flex items-center justify-center shrink-0">
                                <Zap className="h-3.5 w-3.5 text-ash-300" />
                            </div>
                            <div className="text-xs">Mai chiamato</div>
                        </div>
                    )}
                </div>

                {/* 4. Actions Right */}
                <div className="flex items-center justify-end shrink-0 pl-2">
                    <GdoQuickActions leadId={lead.id} leadVersion={lead.version} />
                </div>
            </div>
        )
    }

    // Default Fallback (vertical layout for other contexts)
    return (
        <div className="bg-white border border-ash-200/80 rounded-xl p-4 shadow-soft hover:shadow-card transition-all duration-200 mb-3 flex flex-col relative group">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <div className="font-semibold text-ash-800 text-base">{lead.name}</div>
                    <div className="flex items-center gap-2 text-sm text-ash-500 mt-1 group/phone">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                        <button
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                            className="ml-1 p-1 hover:bg-ash-100 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/phone:opacity-100"
                            title="Copia numero"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <button className="text-ash-400 hover:text-ash-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="h-4 w-4" />
                </button>
            </div>
            {lead.funnel && (
                <div className="mb-4">
                    <div className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-ash-100 text-ash-600 border border-ash-200/80">
                        {lead.funnel}
                    </div>
                </div>
            )}
            <div className="mt-auto pt-3 border-t border-ash-100 flex items-center justify-between">
                <GdoQuickActions leadId={lead.id} leadVersion={lead.version} />
            </div>
        </div>
    )
}
