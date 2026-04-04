"use client"

import { useState, useEffect } from "react"
import { getLeadProfile } from "@/app/actions/eventActions"
import { X, CalendarCheck, Phone, Mail, User, Clock, AlertCircle, History, FileText, CheckCircle2 } from "lucide-react"
import { GdoQuickActions } from "./GdoQuickActions"
import { useAuth } from "./AuthProvider"

export function ContactDrawer({
    isOpen,
    leadId,
    onClose
}: {
    isOpen: boolean
    leadId: string | null
    onClose: () => void
}) {
    const [profile, setProfile] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState<'details' | 'timeline'>('details')
    const { user: authUser } = useAuth()

    const refreshProfile = () => {
        if (!leadId) return
        setIsLoading(true)
        getLeadProfile(leadId).then(data => {
            setProfile(data)
            setIsLoading(false)
        }).catch(err => {
            console.error(err)
            setIsLoading(false)
        })
    }

    useEffect(() => {
        if (!isOpen || !leadId) {
            setProfile(null)
            setActiveTab('details')
            return
        }

        refreshProfile()

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, leadId])

    if (!isOpen) return null

    const lead = profile?.lead
    const events = profile?.events || []

    const formatTimestamp = (ts: Date) => {
        return new Date(ts).toLocaleString('it-IT', {
            timeZone: 'Europe/Rome',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        })
    }

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'IMPORTED': return <FileText className="h-4 w-4 text-blue-500" />
            case 'ASSIGNED': return <User className="h-4 w-4 text-purple-500" />
            case 'CALL_LOGGED': return <Phone className="h-4 w-4 text-indigo-500" />
            case 'SECTION_MOVED': return <History className="h-4 w-4 text-brand-orange" />
            case 'DISCARDED': return <AlertCircle className="h-4 w-4 text-red-500" />
            case 'RECALL_SET': return <Clock className="h-4 w-4 text-yellow-600" />
            case 'APPOINTMENT_SET': return <CalendarCheck className="h-4 w-4 text-green-500" />
            default: return <CheckCircle2 className="h-4 w-4 text-gray-400" />
        }
    }

    const getEventLabel = (type: string) => {
        switch (type) {
            case 'IMPORTED': return 'Lead Importato'
            case 'ASSIGNED': return 'Assegnato a GDO'
            case 'CALL_LOGGED': return 'Chiamata Registrata'
            case 'SECTION_MOVED': return 'Spostato di Sezione'
            case 'DISCARDED': return 'Lead Scartato'
            case 'RECALL_SET': return 'Richiamo Programmato'
            case 'APPOINTMENT_SET': return 'Appuntamento Fissato'
            default: return 'Evento Sconosciuto'
        }
    }

    return (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />

            <div className="relative w-full max-w-md flex flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-300 border-l border-gray-200 z-50">
                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-2">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                {lead?.name || 'Caricamento...'}
                            </h2>
                            {lead?.funnel && (
                                <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700 uppercase tracking-wide">
                                    {lead.funnel}
                                </span>
                            )}
                        </div>
                        <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 bg-white px-2">
                    <button
                        onClick={() => setActiveTab('details')}
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Dettagli Contatto
                    </button>
                    <button
                        onClick={() => setActiveTab('timeline')}
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'timeline' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        Timeline Eventi
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-white custom-scrollbar p-6">
                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange" />
                        </div>
                    ) : activeTab === 'details' && lead ? (
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Anagrafica</h3>
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3 text-sm">
                                        <User className="h-4 w-4 text-gray-400" />
                                        <span className="text-gray-700">{lead.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                        <Phone className="h-4 w-4 text-gray-400" />
                                        <span className="text-gray-900 font-medium cursor-copy hover:text-brand-orange transition-colors">{lead.phone}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                        <Mail className="h-4 w-4 text-gray-400" />
                                        <span className="text-gray-700">{lead.email || '-'}</span>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-100" />

                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Stato CRM</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="text-xs text-gray-500 mb-1">Stato DB</div>
                                        <div className="text-sm font-bold text-gray-900">{lead.status}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="text-xs text-gray-500 mb-1">Assegnazione</div>
                                        <div className="text-sm font-bold text-gray-900">{lead.assignedToName || 'Nessuno'}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="text-xs text-gray-500 mb-1">Tentativi Chiamate</div>
                                        <div className="text-sm font-bold text-gray-900">{lead.callCount} / 3</div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-100" />

                            <div className="space-y-4 bg-brand-orange/5 p-4 rounded-xl border border-brand-orange/20">
                                <h3 className="text-sm font-bold text-brand-orange uppercase tracking-wider flex items-center justify-between">
                                    Azioni Rapide sull'Esito
                                </h3>
                                <div className="pt-2">
                                    <GdoQuickActions leadId={lead.id} onSettled={refreshProfile} />
                                </div>
                                <p className="text-xs text-brand-orange/70 mt-2">
                                    Clicca un pulsante per esitare il lead e fisserà automaticamente lo storico o l'appuntamento.
                                </p>
                            </div>
                        </div>
                    ) : activeTab === 'timeline' && events ? (
                        <div className="relative pl-3">
                            {/* Vertical Line */}
                            <div className="absolute left-[19px] top-2 bottom-0 w-px bg-gray-200" />

                            {events.length === 0 ? (
                                <div className="text-center text-sm text-gray-500 py-8">Nessun evento registrato.</div>
                            ) : (
                                <div className="space-y-6">
                                    {events.map((ev: any) => (
                                        <div key={ev.id} className="relative pl-8">
                                            {/* dot */}
                                            <div className="absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center shadow-sm z-10">
                                                {getEventIcon(ev.eventType)}
                                            </div>

                                            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 hover:shadow-sm transition-shadow">
                                                <div className="flex flex-col gap-1 mb-2 border-b border-gray-100 pb-2">
                                                    <h4 className="text-sm font-bold text-gray-900">{getEventLabel(ev.eventType)}</h4>
                                                    <time className="text-xs text-gray-500 font-mono flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatTimestamp(ev.timestamp)}
                                                    </time>
                                                </div>

                                                {/* Dettagli condizionali */}
                                                <div className="text-sm text-gray-700 space-y-1.5">
                                                    {ev.eventType === 'SECTION_MOVED' && (
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{ev.fromSection || '?'}</span>
                                                            <span className="text-gray-400">→</span>
                                                            <span className="bg-brand-orange/10 text-brand-orange px-1.5 py-0.5 rounded">{ev.toSection}</span>
                                                        </div>
                                                    )}

                                                    {ev.userName && (
                                                        <div className="text-xs text-gray-500">Operatore: <span className="font-medium text-gray-700">{ev.userName}</span></div>
                                                    )}

                                                    {ev.metadata?.note && (
                                                        <div className="text-xs italic text-gray-600 pt-1">
                                                            "{ev.metadata.note}"
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
