"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Calendar as CalendarIcon, ChevronLeft, ChevronRight, RefreshCw, Users, Loader2 } from "lucide-react"
import { getVenditoriAgenda } from "@/app/actions/confermeActions"

type Appointment = {
    leadId: string
    leadName: string
    leadPhone: string | null
    funnel: string | null
    appointmentDate: Date | string
    appointmentNote: string | null
    confirmationsOutcome: string | null
}

type Venditore = {
    id: string
    name: string
    appointments: Appointment[]
}

const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const DAYS_LONG_IT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']

/** Ritorna il lunedì (00:00 Europe/Rome) della settimana contenente `d` */
function startOfWeek(d: Date): Date {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    const dow = x.getDay() // 0=dom, 1=lun, ...
    const diff = dow === 0 ? -6 : 1 - dow
    x.setDate(x.getDate() + diff)
    return x
}

function addDays(d: Date, n: number): Date {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDM(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatHM(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function outcomeBadge(outcome: string | null) {
    if (outcome === 'confermato') return { label: 'Conf', cls: 'bg-emerald-100 text-emerald-700' }
    if (outcome === 'scartato') return { label: 'Scart', cls: 'bg-rose-100 text-rose-700' }
    return { label: 'Aperto', cls: 'bg-amber-100 text-amber-700' }
}

export function VenditoriAgendaModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
    const [data, setData] = useState<{ venditori: Venditore[] } | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const start = new Date(weekStart)
            const end = addDays(start, 7) // lunedì settimana successiva esclusa
            const res = await getVenditoriAgenda(start, end)
            setData({
                venditori: res.venditori.map(v => ({
                    ...v,
                    appointments: v.appointments.map(a => ({ ...a, appointmentDate: new Date(a.appointmentDate) })),
                })),
            })
        } catch (e: any) {
            setError(e?.message || 'Errore caricamento agenda')
        } finally {
            setLoading(false)
        }
    }, [weekStart])

    useEffect(() => {
        if (isOpen) load()
    }, [isOpen, load])

    if (!isOpen) return null

    const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const today = new Date()
    const weekEnd = addDays(weekStart, 6)

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 bg-ash-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl my-4 flex flex-col max-h-[95vh]">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-ash-200 px-4 sm:px-6 py-3 sticky top-0 bg-white rounded-t-2xl z-10">
                    <div className="flex items-center gap-2 min-w-0">
                        <CalendarIcon className="h-5 w-5 text-brand-orange shrink-0" />
                        <div className="min-w-0">
                            <h2 className="text-base sm:text-lg font-bold text-ash-900 truncate">Agenda venditori</h2>
                            <p className="text-[11px] text-ash-500 hidden sm:block">
                                Carico settimanale per capire a chi assegnare i prossimi appuntamenti.
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-ash-100 bg-ash-50/50">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setWeekStart(addDays(weekStart, -7))}
                            className="p-1.5 rounded-lg border border-ash-200 bg-white hover:bg-ash-100 text-ash-700"
                            title="Settimana precedente"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setWeekStart(startOfWeek(new Date()))}
                            className="px-2.5 py-1 rounded-lg border border-ash-200 bg-white hover:bg-ash-100 text-xs font-semibold text-ash-700"
                        >
                            Oggi
                        </button>
                        <button
                            onClick={() => setWeekStart(addDays(weekStart, 7))}
                            className="p-1.5 rounded-lg border border-ash-200 bg-white hover:bg-ash-100 text-ash-700"
                            title="Settimana successiva"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="text-sm font-bold text-ash-800">
                        {formatDM(weekStart)} – {formatDM(weekEnd)}
                    </div>
                    <button
                        onClick={load}
                        disabled={loading}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-ash-200 bg-white hover:bg-ash-100 text-xs font-semibold text-ash-700 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Aggiorna
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto">
                    {error && (
                        <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {error}
                        </div>
                    )}

                    {!data && loading && (
                        <div className="flex items-center justify-center py-16 text-ash-400">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    )}

                    {data && data.venditori.length === 0 && (
                        <div className="p-8 text-center text-sm text-ash-500">
                            <Users className="h-8 w-8 text-ash-300 mx-auto mb-2" />
                            Nessun venditore attivo.
                        </div>
                    )}

                    {data && data.venditori.length > 0 && (
                        <div className="min-w-full">
                            {/* Grid: header giorni + rows venditori */}
                            <div className="overflow-x-auto">
                                <div className="grid min-w-[880px]" style={{ gridTemplateColumns: '180px repeat(7, minmax(0, 1fr))' }}>
                                    {/* Header row */}
                                    <div className="sticky left-0 bg-white border-b border-r border-ash-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ash-500 z-10">
                                        Venditore
                                    </div>
                                    {days.map((d, i) => {
                                        const isToday = sameDay(d, today)
                                        return (
                                            <div
                                                key={i}
                                                className={`border-b border-r border-ash-200 px-2 py-2 text-center ${isToday ? 'bg-brand-orange/10' : 'bg-white'}`}
                                            >
                                                <div className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? 'text-brand-orange' : 'text-ash-500'}`}>
                                                    {DAYS_IT[i]}
                                                </div>
                                                <div className={`text-xs font-semibold ${isToday ? 'text-brand-orange' : 'text-ash-800'}`}>
                                                    {formatDM(d)}
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {/* Rows per venditore */}
                                    {data.venditori.map((v) => {
                                        const weekCount = v.appointments.length
                                        return (
                                            <div key={v.id} className="contents">
                                                <div className="sticky left-0 bg-white border-b border-r border-ash-200 px-3 py-2 z-10">
                                                    <div className="text-xs font-bold text-ash-900 truncate" title={v.name}>{v.name}</div>
                                                    <div className="text-[10px] text-ash-500">
                                                        {weekCount} app{weekCount === 1 ? '' : '.'} / sett
                                                    </div>
                                                </div>
                                                {days.map((d, i) => {
                                                    const items = v.appointments.filter(a =>
                                                        sameDay(a.appointmentDate as Date, d),
                                                    )
                                                    return (
                                                        <DayCell key={i} appointments={items} isToday={sameDay(d, today)} />
                                                    )
                                                })}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Legend */}
                <div className="border-t border-ash-200 px-4 sm:px-6 py-2 text-[11px] text-ash-500 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Aperto</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Confermato</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Scartato</span>
                </div>
            </div>
        </div>
    )
}

function DayCell({ appointments, isToday }: { appointments: Appointment[]; isToday: boolean }) {
    const bg = isToday ? 'bg-brand-orange/5' : appointments.length === 0 ? 'bg-ash-50/30' : 'bg-white'
    return (
        <div className={`border-b border-r border-ash-200 ${bg} p-1.5 min-h-[70px] space-y-1`}>
            {appointments.length === 0 ? (
                <div className="text-[10px] text-ash-300 text-center pt-3 italic">—</div>
            ) : (
                appointments.map(a => {
                    const d = a.appointmentDate as Date
                    const badge = outcomeBadge(a.confirmationsOutcome)
                    return (
                        <div
                            key={a.leadId}
                            className="rounded-md border border-ash-200 bg-white px-1.5 py-1 text-[10px] leading-tight hover:shadow-sm transition-shadow"
                            title={`${a.leadName} · ${a.funnel || '-'}${a.appointmentNote ? ` · ${a.appointmentNote}` : ''}`}
                        >
                            <div className="flex items-center justify-between gap-1">
                                <span className="font-mono font-bold text-ash-900">{formatHM(d)}</span>
                                <span className={`rounded px-1 py-px text-[9px] font-bold ${badge.cls}`}>{badge.label}</span>
                            </div>
                            <div className="truncate font-semibold text-ash-800">{a.leadName}</div>
                            {a.funnel && <div className="truncate text-ash-500 text-[9px]">{a.funnel}</div>}
                        </div>
                    )
                })
            )}
        </div>
    )
}
