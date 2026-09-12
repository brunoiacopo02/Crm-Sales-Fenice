"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Calendar as CalendarIcon, ChevronLeft, ChevronRight, RefreshCw, Users, Loader2 } from "lucide-react"
import { getVenditoriAgenda } from "@/app/actions/confermeActions"
import { reportSalesAbsence } from "@/app/actions/salesCalendarAdminActions"
import { slotKey, slotStartFor, slotLabel, romeInstant } from "@/lib/venditore/calendarSlots"
import { toRomeDateStr } from "@/lib/dateUtils"
import { absenceReportCheck, absenceRefusalMessage, CALENDAR_PENALTY_EUR, type AbsenceDecision } from "@/lib/venditore/calendarRules"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"

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
    /** Chiavi `slotKey` dichiarate disponibili nell'intervallo caricato. */
    declaredSlots: string[]
    /** Chiavi `slotKey` bloccate PRIMA dell'inizio dello slot: sono le uniche
     *  che valgono come "il venditore aveva avvisato" davanti a una multa. */
    blockedSlots: string[]
    /** Tutti i blocchi dell'intervallo, con il motivo: servono a mostrarli. */
    blockDetails: Array<{ slotKey: string; kind: string; leadName: string | null }>
    /** true = niente obbligo di calendario, niente multe (vedi users.calendarExempt). */
    calendarExempt: boolean
}

const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const DAYS_LONG_IT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']

/** Le tre fasce di copertura mostrate alle Conferme. Coprono le 13 ore della
 *  griglia (9-21) senza sovrapposizioni: 5 + 4 + 4. */
const COVERAGE_BANDS: Array<{ label: string; from: number; to: number }> = [
    { label: '9–13', from: 9, to: 13 },
    { label: '14–17', from: 14, to: 17 },
    { label: '18–21', from: 18, to: 21 },
]

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

/** Un giorno è "passato" quando la sua data civile italiana precede quella di oggi. */
function isPastDay(d: Date): boolean {
    return toRomeDateStr(d) < toRomeDateStr(new Date())
}

type BandStat = { count: number; tone: 'rosso' | 'ambra' | 'neutro'; names: string[] }

/** Copertura minima della fascia: "in quella fascia c'è sempre almeno N". */
function bandStats(coverage: CoverageCell[], dow: number, from: number, to: number, nameOf: (id: string) => string): BandStat {
    const cells = coverage.filter(c => c.dow === dow && c.hour >= from && c.hour <= to)
    if (cells.length === 0) return { count: 0, tone: 'neutro', names: [] }
    const count = Math.min(...cells.map(c => c.available.length))
    const avgExpected = cells.reduce((s, c) => s + c.expectedPeople, 0) / cells.length
    const tone: BandStat['tone'] = count === 0 ? 'rosso' : (count < avgExpected ? 'ambra' : 'neutro')
    const idSet = new Set<string>()
    cells.forEach(c => c.available.forEach(id => idSet.add(id)))
    return { count, tone, names: [...idSet].map(nameOf) }
}

function bandToneClasses(tone: BandStat['tone']): string {
    if (tone === 'rosso') return 'bg-rose-100 text-rose-700'
    if (tone === 'ambra') return 'bg-amber-100 text-amber-700'
    return 'bg-ash-100 text-ash-600'
}

export function VenditoriAgendaModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
    const [data, setData] = useState<{ venditori: Venditore[]; coverage: CoverageCell[]; reportedSlots: string[] } | null>(null)
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
                coverage: res.coverage,
                reportedSlots: res.reportedSlots,
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
    const now = new Date()
    const weekEnd = addDays(weekStart, 6)
    const reportedSet = new Set(data?.reportedSlots ?? [])
    const nameOf = (id: string) => data?.venditori.find(v => v.id === id)?.name ?? id

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

                                    {/* Riga di copertura: quanti venditori sono davvero disponibili in
                                        ogni fascia, prima di elencare gli appuntamenti. Dato dalla stessa
                                        `weekCoverage` che alimenta /mio-calendario: stessi numeri ovunque. */}
                                    <div className="contents">
                                        <div className="sticky left-0 bg-ash-50 border-b border-r border-ash-200 px-3 py-2 z-10 text-[10px] font-bold uppercase tracking-wider text-ash-500">
                                            Copertura
                                        </div>
                                        {days.map((d, i) => {
                                            const isToday = sameDay(d, today)
                                            const dow = i + 1 // Lun=1..Dom=7, stessa convenzione di calendarSlots.romeDow
                                            if (dow === 7) {
                                                return (
                                                    <div
                                                        key={i}
                                                        className={`border-b border-r border-ash-200 px-2 py-2 text-center text-[9px] italic text-ash-400 ${isToday ? 'bg-brand-orange/5' : 'bg-ash-50/60'}`}
                                                    >
                                                        Non compilabile
                                                    </div>
                                                )
                                            }
                                            return (
                                                <div
                                                    key={i}
                                                    className={`border-b border-r border-ash-200 px-1.5 py-1.5 flex flex-col gap-0.5 ${isToday ? 'bg-brand-orange/5' : 'bg-ash-50/60'}`}
                                                >
                                                    {COVERAGE_BANDS.map((band, bi) => {
                                                        const stat = bandStats(data.coverage, dow, band.from, band.to, nameOf)
                                                        const title = stat.names.length > 0
                                                            ? `${band.label}: ${stat.names.join(', ')}`
                                                            : `${band.label}: nessun venditore disponibile`
                                                        return (
                                                            <div
                                                                key={bi}
                                                                className={`rounded px-1 py-0.5 text-[9px] font-bold text-center ${bandToneClasses(stat.tone)}`}
                                                                title={title}
                                                            >
                                                                {band.label}: {stat.count}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* Rows per venditore */}
                                    {data.venditori.map((v) => {
                                        const weekCount = v.appointments.length
                                        const apptSlotKeys = new Set(
                                            v.appointments.flatMap(a => {
                                                const s = slotStartFor(a.appointmentDate as Date)
                                                return s ? [slotKey(s)] : []
                                            }),
                                        )
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
                                                    const dateStr = toRomeDateStr(d)
                                                    const past = isPastDay(d)
                                                    // Il motivo per cui un follow-up blocca lo slot è che le
                                                    // Conferme lo vedano occupato e non ci fissino sopra un
                                                    // appuntamento: senza questa riga il blocco esisteva ma
                                                    // non arrivava a chi doveva vederlo. Solo oggi e il
                                                    // futuro: sul passato non serve più a nessuno.
                                                    const dayBlocks = past
                                                        ? []
                                                        : v.blockDetails.filter(b => b.slotKey.startsWith(`${dateStr}@`))
                                                    // Le ore dichiarate e ancora libere. Sul passato alimentano il
                                                    // bottone "Non c'era"; su oggi e sul futuro sono l'unica cosa
                                                    // che dice alla Conferma DOVE si può fissare — la riga di
                                                    // copertura elenca solo chi è disponibile in TUTTA la fascia e
                                                    // perde chi ha dichiarato una sola ora. Finché era un avviso
                                                    // bastava il verso negativo; ora che è un muro serve anche
                                                    // quello positivo.
                                                    const emptyDeclaredSlots = v.declaredSlots.filter(k => {
                                                        if (!k.startsWith(`${dateStr}@`)) return false
                                                        if (apptSlotKeys.has(k)) return false
                                                        if (past) return true
                                                        // Su oggi e sul futuro la pastiglia promette "qui si
                                                        // fissa": un'ora già mostrata come "Occupato", o un'ora
                                                        // di oggi già passata, non mantengono quella promessa.
                                                        if (v.blockedSlots.includes(k)) return false
                                                        return romeInstant(dateStr, Number(k.split('@')[1])) > now
                                                    })
                                                    return (
                                                        <DayCell
                                                            key={i}
                                                            appointments={items}
                                                            isToday={sameDay(d, today)}
                                                            venditoreId={v.id}
                                                            declaredSlots={v.declaredSlots}
                                                            blockedSlots={v.blockedSlots}
                                                            dayBlocks={dayBlocks}
                                                            calendarExempt={v.calendarExempt}
                                                            emptyDeclaredSlots={emptyDeclaredSlots}
                                                            isPast={past}
                                                            reportedSlots={reportedSet}
                                                            now={now}
                                                            onReported={load}
                                                        />
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
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-300 border border-amber-400" /> Fuori disponibilità dichiarata</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-ash-200 border border-ash-300" /> Slot occupato (follow-up o imprevisto)</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-50 border border-emerald-200" /> Ora dichiarata e libera: qui si fissa senza forzare</span>
                </div>
            </div>
        </div>
    )
}

function DayCell({
    appointments, isToday,
    venditoreId, declaredSlots, blockedSlots, dayBlocks, calendarExempt, emptyDeclaredSlots, isPast, reportedSlots, now, onReported,
}: {
    appointments: Appointment[]
    isToday: boolean
    venditoreId: string
    declaredSlots: string[]
    blockedSlots: string[]
    /** Blocchi di QUESTA giornata (solo oggi e futuro): ora + motivo. */
    dayBlocks: Array<{ slotKey: string; kind: string; leadName: string | null }>
    calendarExempt: boolean
    /** Slot dichiarati per questo giorno senza appuntamento, per ogni giornata. */
    emptyDeclaredSlots: string[]
    /** Giornata già chiusa: solo lì la pastiglia porta il bottone "Non c'era". */
    isPast: boolean
    /** Chiavi `'<salesUserId>|<slotKey>'` già segnalate, annullate incluse:
     *  l'annullamento è definitivo per quello slot, non lo riapre. */
    reportedSlots: Set<string>
    now: Date
    onReported: () => void
}) {
    const hasContent = appointments.length > 0
        || emptyDeclaredSlots.length > 0 || dayBlocks.length > 0
    const bg = isToday ? 'bg-brand-orange/5' : !hasContent ? 'bg-ash-50/30' : 'bg-white'
    return (
        <div className={`border-b border-r border-ash-200 ${bg} p-1.5 min-h-[70px] space-y-1`}>
            {!hasContent ? (
                <div className="text-[10px] text-ash-300 text-center pt-3 italic">—</div>
            ) : (
                <>
                    {appointments.map(a => {
                        const d = a.appointmentDate as Date
                        const badge = outcomeBadge(a.confirmationsOutcome)
                        const key = slotKey(d)
                        const outOfAvailability = !declaredSlots.includes(key)
                        const slotStart = slotStartFor(d)
                        const started = !!slotStart && now >= slotStart
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
                                {outOfAvailability && (
                                    <div
                                        className="mt-1 rounded px-1 py-0.5 text-[9px] font-bold text-center bg-amber-100 text-amber-700"
                                        title="Il venditore non aveva dichiarato quest'ora: questo slot non può generare multa."
                                    >
                                        Fuori disponibilità
                                    </div>
                                )}
                                {started && slotStart && (
                                    <AbsenceButton
                                        decision={absenceReportCheck({
                                            slotStart,
                                            now,
                                            declared: declaredSlots.includes(key),
                                            blocked: blockedSlots.includes(key),
                                            exempt: calendarExempt,
                                            alreadyReported: reportedSlots.has(`${venditoreId}|${key}`),
                                        })}
                                        onReport={() => reportSalesAbsence(venditoreId, slotStart.toISOString())}
                                        onSuccess={onReported}
                                    />
                                )}
                            </div>
                        )
                    })}
                    {dayBlocks.map(b => {
                        const [dateStr, hStr] = b.slotKey.split('@')
                        const slotStart = romeInstant(dateStr, Number(hStr))
                        const motivo = b.kind === 'FOLLOWUP'
                            ? `Follow-up${b.leadName ? `: ${b.leadName}` : ''}`
                            : 'Bloccato dal venditore'
                        return (
                            <div
                                key={`block-${b.slotKey}-${b.kind}-${b.leadName ?? ''}`}
                                className="rounded-md border border-ash-300 bg-ash-100 px-1.5 py-1 text-[10px] leading-tight"
                                title={`${slotLabel(slotStart)} — ${motivo}. Il venditore non è disponibile in quest'ora.`}
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="font-mono font-bold text-ash-600">{slotLabel(slotStart)}</span>
                                    <span className="text-ash-500 font-semibold">Occupato</span>
                                </div>
                                <div className="truncate text-ash-500 text-[9px] italic">{motivo}</div>
                            </div>
                        )
                    })}
                    {emptyDeclaredSlots.length > 0 && (
                        <div className="space-y-1 border-t border-dashed border-ash-200 pt-1">
                            {emptyDeclaredSlots.map(k => {
                                const [dateStr, hStr] = k.split('@')
                                const slotStart = romeInstant(dateStr, Number(hStr))
                                // Su oggi e sul futuro la pastiglia è il verso positivo del
                                // muro: "qui si può fissare". Niente "Non c'era", che su una
                                // giornata non ancora chiusa sarebbe solo un bottone spento.
                                if (!isPast) {
                                    return (
                                        <div
                                            key={k}
                                            className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] leading-tight"
                                            title={`${slotLabel(slotStart)} — ora dichiarata e libera: qui si può fissare senza forzare.`}
                                        >
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="font-mono font-bold text-emerald-700">{slotLabel(slotStart)}</span>
                                                <span className="text-emerald-600 font-semibold">Libero</span>
                                            </div>
                                        </div>
                                    )
                                }
                                return (
                                    <div
                                        key={k}
                                        className="rounded-md border border-dashed border-ash-200 bg-ash-50/60 px-1.5 py-1 text-[10px] leading-tight"
                                        title="Slot dichiarato disponibile, senza appuntamento."
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="font-mono font-bold text-ash-500">{slotLabel(slotStart)}</span>
                                            <span className="text-ash-400 italic">Slot vuoto</span>
                                        </div>
                                        <AbsenceButton
                                            decision={absenceReportCheck({
                                                slotStart,
                                                now,
                                                declared: true,
                                                blocked: blockedSlots.includes(k),
                                                exempt: calendarExempt,
                                                alreadyReported: reportedSlots.has(`${venditoreId}|${k}`),
                                            })}
                                            onReport={() => reportSalesAbsence(venditoreId, slotStart.toISOString())}
                                            onSuccess={onReported}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

/**
 * Bottone "Non c'era": disabilitato con il motivo quando `decision` non è
 * ammissibile (stessi messaggi di `absenceRefusalMessage`, non riformulati).
 * Quando è ammissibile, la conferma è inline — niente `window.confirm`, che
 * blocca l'estensione: un secondo click entro 5 secondi registra la multa.
 */
function AbsenceButton({
    decision, onReport, onSuccess,
}: {
    decision: AbsenceDecision
    onReport: () => Promise<{ success: boolean; error?: string }>
    onSuccess: () => void
}) {
    const [armed, setArmed] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!armed) return
        const t = setTimeout(() => setArmed(false), 5000)
        return () => clearTimeout(t)
    }, [armed])

    if (!decision.ok) {
        return (
            <button
                type="button"
                disabled
                title={absenceRefusalMessage(decision.reason)}
                className="mt-1 w-full rounded px-1 py-0.5 text-[9px] font-bold text-center bg-ash-100 text-ash-400 cursor-not-allowed"
            >
                Non c&apos;era
            </button>
        )
    }

    return (
        <div className="mt-1">
            <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                    if (!armed) { setArmed(true); return }
                    setSubmitting(true)
                    setError(null)
                    try {
                        const res = await onReport()
                        if (res.success) {
                            setArmed(false)
                            onSuccess()
                        } else {
                            setArmed(false)
                            setError(res.error || 'Segnalazione non riuscita.')
                        }
                    } finally {
                        setSubmitting(false)
                    }
                }}
                className={`w-full rounded px-1 py-0.5 text-[9px] font-bold text-center transition-colors ${armed ? 'bg-rose-600 text-white' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'} ${submitting ? 'opacity-60' : ''}`}
            >
                {submitting ? 'Invio…' : armed ? `Confermi? ${CALENDAR_PENALTY_EUR} €` : "Non c'era"}
            </button>
            {error && <div className="mt-0.5 text-[9px] text-rose-600">{error}</div>}
        </div>
    )
}
