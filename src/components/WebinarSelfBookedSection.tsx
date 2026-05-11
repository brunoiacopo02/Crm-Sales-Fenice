"use client"

import { useEffect, useState } from "react"
import { Sparkles, Phone, MessageCircle, Loader2 } from "lucide-react"
import { getWebinarSelfBookedLeads } from "@/app/actions/confermeActions"
import { WebinarAssignModal } from "@/components/WebinarAssignModal"

type WebinarLead = {
    id: string
    name: string
    phone: string
    appointmentDate: Date | string | null
    appointmentNote: string | null
}

function formatHour(d: Date | string | null): string {
    if (!d) return "—"
    const dt = typeof d === "string" ? new Date(d) : d
    return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(dt)
}

function formatDate(d: Date | string | null): string {
    if (!d) return "—"
    const dt = typeof d === "string" ? new Date(d) : d
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" }).format(dt)
}

export function WebinarSelfBookedSection() {
    const [leads, setLeads] = useState<WebinarLead[]>([])
    const [loading, setLoading] = useState(true)
    const [activeLead, setActiveLead] = useState<WebinarLead | null>(null)

    const refresh = () => {
        setLoading(true)
        getWebinarSelfBookedLeads()
            .then(l => setLeads(l as WebinarLead[]))
            .catch(e => console.error("WebinarSelfBookedSection load err:", e))
            .finally(() => setLoading(false))
    }

    useEffect(() => { refresh() }, [])

    // Card si nasconde quando tutto è stato assegnato (dashboard più pulita per i Conferme).
    if (!loading && leads.length === 0) return null

    return (
        <>
            <div className="rounded-2xl border-2 border-purple-300 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        <h2 className="text-lg font-bold text-purple-900">Appuntamenti Webinar (self-booked)</h2>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-purple-700 bg-purple-100 px-2 py-1 rounded-full">
                        {loading ? "…" : `${leads.length} da assegnare`}
                    </span>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-purple-700"><Loader2 className="w-4 h-4 animate-spin" /> Caricamento…</div>
                ) : (
                    <ul className="divide-y divide-purple-100">
                        {leads.map(lead => (
                            <li key={lead.id} className="py-3 flex flex-wrap items-center gap-3">
                                <div className="flex-1 min-w-[200px]">
                                    <div className="font-semibold text-ash-800">{lead.name}</div>
                                    <div className="text-xs text-ash-500 flex items-center gap-2 mt-0.5">
                                        <a href={`tel:${lead.phone}`} className="hover:underline flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</a>
                                        <a href={`https://wa.me/39${lead.phone}`} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1 text-emerald-600"><MessageCircle className="w-3 h-3" />WhatsApp</a>
                                    </div>
                                </div>
                                <div className="text-sm font-medium text-purple-800 px-2 py-1 rounded-md bg-purple-100">
                                    {formatDate(lead.appointmentDate)} · {formatHour(lead.appointmentDate)}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setActiveLead(lead)}
                                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition min-w-[160px]"
                                >
                                    Assegna a venditore
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {activeLead && (
                <WebinarAssignModal
                    lead={activeLead}
                    onClose={() => setActiveLead(null)}
                    onAssigned={refresh}
                />
            )}
        </>
    )
}
