"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { X, Loader2, Clock, AlertTriangle, CheckCircle2 } from "lucide-react"
import { getVenditoriAgenda, assignWebinarLeadToSalesperson } from "@/app/actions/confermeActions"

type Lead = {
    id: string
    name: string
    phone: string
    appointmentDate: Date | string | null
}

type Vend = {
    id: string
    name: string
    hasGoogleCalendar: boolean
    appointments: Array<{
        leadId: string
        leadName: string
        appointmentDate: Date | string
        confirmationsOutcome: string | null
    }>
    busySlots: Array<{ start: Date | string; end: Date | string }>
}

function pad(n: number) { return String(n).padStart(2, '0') }

/** Format a Date as YYYY-MM-DDTHH:mm in Europe/Rome for <input type="datetime-local"> */
function toRomeInput(d: Date | string | null): string {
    if (!d) return ""
    const dt = typeof d === "string" ? new Date(d) : d
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Rome",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(dt)
    const m: Record<string, string> = {}
    parts.forEach(p => { m[p.type] = p.value })
    const hh = m.hour === "24" ? "00" : m.hour
    return `${m.year}-${m.month}-${m.day}T${hh}:${m.minute}`
}

/** Parse a "YYYY-MM-DDTHH:mm" string as Europe/Rome local time and return UTC Date. */
function fromRomeInput(s: string): Date {
    if (!s) return new Date(NaN)
    const [date, time] = s.split("T")
    const [y, mo, d] = date.split("-").map(Number)
    const [h, mi] = time.split(":").map(Number)
    // Find the UTC instant whose Europe/Rome wall-clock equals (y,mo,d,h,mi).
    let guess = Date.UTC(y, mo - 1, d, h, mi)
    for (let i = 0; i < 2; i++) {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Rome",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date(guess))
        const mm: Record<string, string> = {}
        parts.forEach(p => { mm[p.type] = p.value })
        const hh = mm.hour === "24" ? "00" : mm.hour
        const wall = Date.UTC(Number(mm.year), Number(mm.month) - 1, Number(mm.day), Number(hh), Number(mm.minute))
        const target = Date.UTC(y, mo - 1, d, h, mi)
        guess += (target - wall)
    }
    return new Date(guess)
}

function startOfDayRome(d: Date): Date {
    const input = toRomeInput(d).slice(0, 10) + "T00:00"
    return fromRomeInput(input)
}

function endOfDayRome(d: Date): Date {
    const input = toRomeInput(d).slice(0, 10) + "T23:59"
    return fromRomeInput(input)
}

function formatHM(d: Date | string): string {
    const dt = typeof d === "string" ? new Date(d) : d
    return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(dt)
}

export function WebinarAssignModal({ lead, onClose, onAssigned }: { lead: Lead; onClose: () => void; onAssigned: () => void }) {
    const initial = toRomeInput(lead.appointmentDate)
    const [apptInput, setApptInput] = useState(initial)
    const [venditori, setVenditori] = useState<Vend[]>([])
    const [loading, setLoading] = useState(true)
    const [assigningId, setAssigningId] = useState<string | null>(null)
    const [, startTransition] = useTransition()

    // Day to fetch agenda for. Recomputed whenever the user picks a different day.
    const dayKey = apptInput.slice(0, 10) || initial.slice(0, 10)

    useEffect(() => {
        if (!dayKey) return
        let alive = true
        setLoading(true)
        const dayAnchor = fromRomeInput(`${dayKey}T12:00`)
        getVenditoriAgenda(startOfDayRome(dayAnchor), endOfDayRome(dayAnchor))
            .then(r => { if (alive) setVenditori((r as any).venditori as Vend[]) })
            .catch(e => console.error("getVenditoriAgenda err:", e))
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
    }, [dayKey])

    const proposed = useMemo(() => apptInput ? fromRomeInput(apptInput) : null, [apptInput])
    const originalIso = lead.appointmentDate ? new Date(lead.appointmentDate).getTime() : null
    const timeChanged = !!proposed && originalIso !== null && proposed.getTime() !== originalIso

    const handleAssign = (salespersonId: string) => {
        if (!proposed || isNaN(proposed.getTime())) {
            alert("Orario non valido")
            return
        }
        setAssigningId(salespersonId)
        startTransition(async () => {
            const res = await assignWebinarLeadToSalesperson(
                lead.id,
                salespersonId,
                timeChanged ? proposed : undefined
            )
            if (res.success) {
                onAssigned()
                onClose()
            } else {
                alert(`Errore: ${res.error}`)
            }
            setAssigningId(null)
        })
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                    <div>
                        <h2 className="text-lg font-bold text-ash-800">Assegna a venditore</h2>
                        <div className="text-sm text-ash-500">{lead.name} · {lead.phone}</div>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-ash-100" aria-label="Chiudi"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-4 border-b bg-purple-50/50">
                    <label className="block text-sm font-medium mb-1 text-ash-700">Orario appuntamento</label>
                    <input
                        type="datetime-local"
                        value={apptInput}
                        onChange={e => setApptInput(e.target.value)}
                        className="w-full max-w-xs px-3 py-2 border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    {timeChanged && (
                        <div className="mt-2 text-xs text-purple-700 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Orario modificato — sarà aggiornato nel CRM e nel Google Calendar del venditore.
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-ash-600"><Loader2 className="w-4 h-4 animate-spin" /> Carico agenda venditori…</div>
                    ) : venditori.length === 0 ? (
                        <div className="text-sm text-ash-500">Nessun venditore attivo disponibile.</div>
                    ) : (
                        <div className="space-y-3">
                            {venditori.map(v => {
                                const slots: Array<{ start: Date; label: string; type: 'crm' | 'busy' }> = [
                                    ...v.appointments.map(a => ({ start: new Date(a.appointmentDate), label: a.leadName, type: 'crm' as const })),
                                    ...v.busySlots.map(b => ({ start: new Date(b.start as any), label: 'Impegno GCal', type: 'busy' as const })),
                                ].sort((a, b) => a.start.getTime() - b.start.getTime())

                                let conflict = false
                                if (proposed && !isNaN(proposed.getTime())) {
                                    const pStart = proposed.getTime()
                                    const pEnd = pStart + 60 * 60 * 1000
                                    conflict = slots.some(s => {
                                        const sStart = s.start.getTime()
                                        const sEnd = sStart + 60 * 60 * 1000
                                        return sStart < pEnd && sEnd > pStart
                                    })
                                }

                                const isBusy = assigningId === v.id

                                return (
                                    <div key={v.id} className={`border rounded-lg p-3 ${conflict ? 'border-amber-300 bg-amber-50' : 'border-ash-200'}`}>
                                        <div className="flex items-center justify-between mb-2 gap-3">
                                            <div className="flex items-center gap-2">
                                                <div className="font-semibold text-ash-800">{v.name}</div>
                                                {!v.hasGoogleCalendar && (
                                                    <span className="text-[10px] uppercase tracking-wide text-ash-500 bg-ash-100 px-1.5 py-0.5 rounded">no GCal</span>
                                                )}
                                                {conflict ? (
                                                    <span className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Conflitto sullo slot</span>
                                                ) : (
                                                    <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Slot libero</span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!!assigningId}
                                                onClick={() => handleAssign(v.id)}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition flex items-center gap-1 min-w-[140px] justify-center ${conflict ? 'bg-amber-600 hover:bg-amber-700' : 'bg-purple-600 hover:bg-purple-700'} disabled:opacity-50`}
                                            >
                                                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : (conflict ? 'Assegna comunque' : 'Assegna')}
                                            </button>
                                        </div>
                                        {slots.length === 0 ? (
                                            <div className="text-xs text-ash-500">Nessun impegno per quel giorno.</div>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                                {slots.map((s, i) => (
                                                    <span key={i} className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${s.type === 'crm' ? 'bg-blue-100 text-blue-800' : 'bg-ash-100 text-ash-700'}`}>
                                                        <Clock className="w-3 h-3" />{formatHM(s.start)} · {s.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="p-3 border-t flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-ash-700 hover:bg-ash-100 rounded-lg">Annulla</button>
                </div>
            </div>
        </div>
    )
}
