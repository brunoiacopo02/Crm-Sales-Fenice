"use client"

import { useEffect, useState, useTransition } from "react"
import { Sparkles, Phone, MessageCircle, Loader2, CheckCircle2 } from "lucide-react"
import { getWebinarSelfBookedLeads, listVenditoriForAssignment, assignWebinarLeadToSalesperson } from "@/app/actions/confermeActions"

type WebinarLead = {
    id: string
    name: string
    phone: string
    appointmentDate: Date | string | null
    appointmentNote: string | null
}

type Venditore = { id: string; name: string; displayName: string | null }

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
    const [venditori, setVenditori] = useState<Venditore[]>([])
    const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [assigningId, setAssigningId] = useState<string | null>(null)
    const [, startTransition] = useTransition()

    useEffect(() => {
        let alive = true
        setLoading(true)
        Promise.all([getWebinarSelfBookedLeads(), listVenditoriForAssignment()])
            .then(([l, v]) => { if (!alive) return; setLeads(l as WebinarLead[]); setVenditori(v as Venditore[]) })
            .catch(e => console.error("WebinarSelfBookedSection load err:", e))
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
    }, [])

    const handleAssign = (leadId: string, salespersonId: string) => {
        setAssigningId(leadId)
        startTransition(async () => {
            const res = await assignWebinarLeadToSalesperson(leadId, salespersonId)
            if (res.success) {
                setLeads(prev => prev.filter(l => l.id !== leadId))
                setOpenDropdownFor(null)
            } else {
                alert(`Errore assegnazione: ${res.error}`)
            }
            setAssigningId(null)
        })
    }

    return (
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
            ) : leads.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-purple-700/70">
                    <CheckCircle2 className="w-4 h-4" /> Nessun appuntamento webinar in attesa di assegnazione.
                </div>
            ) : (
                <ul className="divide-y divide-purple-100">
                    {leads.map(lead => {
                        const isOpen = openDropdownFor === lead.id
                        const isBusy = assigningId === lead.id
                        return (
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
                                <div className="relative">
                                    <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => setOpenDropdownFor(isOpen ? null : lead.id)}
                                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-semibold transition flex items-center justify-center min-w-[160px]"
                                    >
                                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assegna a venditore"}
                                    </button>
                                    {isOpen && !isBusy && (
                                        <div className="absolute right-0 mt-2 w-56 bg-white border border-purple-200 rounded-lg shadow-lg z-10 max-h-72 overflow-y-auto">
                                            {venditori.length === 0 ? (
                                                <div className="p-3 text-sm text-ash-500">Nessun venditore disponibile</div>
                                            ) : venditori.map(v => (
                                                <button
                                                    key={v.id}
                                                    type="button"
                                                    onClick={() => handleAssign(lead.id, v.id)}
                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 transition"
                                                >
                                                    {v.displayName || v.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
