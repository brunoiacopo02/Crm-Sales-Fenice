"use client"

/**
 * Vista Direzione del calendario disponibilità venditori. Tre domande, tre
 * schede: chi è disponibile e quando (Copertura), chi ha compilato
 * (Compilazione), quali multe sono scattate e quali vanno tolte (Multe
 * calendario). La copertura usa la stessa `weekCoverage` delle altre due
 * schermate (venditore, Conferme): mai un secondo calcolo, mai numeri diversi.
 *
 * `voidCalendarPenalty` e `setCalendarExempt` sono solo ADMIN (spec §7): per
 * chiunque altro lo switch e il bottone "Annulla" sono statici/assenti, mai
 * disabilitati a metà — la scheda Multe calendario non si mostra affatto a
 * CONFERME (spec §6.2).
 */

import { useState, useMemo, useCallback, useTransition } from "react"
import { ChevronLeft, ChevronRight, Loader2, CalendarClock } from "lucide-react"
import {
    getCalendarSupervision, voidCalendarPenalty, setCalendarExempt, type SupervisionView,
} from "@/app/actions/salesCalendarAdminActions"
import { weekSlots, weekStartFor, slotKey, slotLabel } from "@/lib/venditore/calendarSlots"
import { previousYearMonth, nextYearMonth, monthBoundsRome } from "@/lib/dateUtils"
import type { CalendarPenaltyKind } from "@/lib/venditore/calendarRules"
import { SlotGrid, type SlotCellView } from "@/components/calendar/SlotGrid"
import { CoverageLegend } from "@/components/calendar/CoverageLegend"

interface Props {
    initial: SupervisionView
    role: string
}

const WEEK_MS = 7 * 86_400_000
const DAY_ABBR_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

const weekdayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })
const dateSlashFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric' })
const monthOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' })
const monthYearFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long', year: 'numeric' })
const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function formatWeekRange(weekStartIso: string): string {
    const start = new Date(weekStartIso)
    const end = new Date(start.getTime() + 5 * 86_400_000)
    const startMonth = monthOnlyFmt.format(start)
    const endMonth = monthOnlyFmt.format(end)
    const startDay = dayOnlyFmt.format(start)
    const endDay = dayOnlyFmt.format(end)
    return startMonth === endMonth
        ? `${startDay} – ${endDay} ${endMonth}`
        : `${startDay} ${startMonth} – ${endDay} ${endMonth}`
}

function monthLabel(monthKey: string): string {
    const { start } = monthBoundsRome(monthKey)
    return capitalize(monthYearFmt.format(start))
}

function formatDateTime(iso: string): string {
    const d = new Date(iso)
    return `${capitalize(weekdayFmt.format(d))} ${dateSlashFmt.format(d)} alle ${timeFmt.format(d)}`
}

function kindLabel(kind: CalendarPenaltyKind): string {
    return kind === 'CALENDAR_MISSING' ? 'Calendario non compilato' : 'Assenza su slot'
}

function Pill({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'neutral'; children: React.ReactNode }) {
    const cls = {
        green: 'bg-emerald-100 text-emerald-800',
        red: 'bg-rose-100 text-rose-800',
        amber: 'bg-amber-100 text-amber-800',
        neutral: 'bg-ash-100 text-ash-600',
    }[tone]
    return (
        <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
            {children}
        </div>
    )
}

export function CalendariVenditoriClient({ initial, role }: Props) {
    const [data, setData] = useState<SupervisionView>(initial)
    const [tab, setTab] = useState<'copertura' | 'compilazione' | 'multe'>('copertura')
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    const canWrite = role === 'ADMIN'
    const showMulte = role !== 'CONFERME'

    const load = useCallback((weekStartIso: string, monthKey: string) => {
        setError(null)
        startTransition(async () => {
            try {
                const fresh = await getCalendarSupervision(weekStartIso, monthKey)
                setData(fresh)
            } catch (e: any) {
                setError(e?.message || 'Errore di caricamento.')
            }
        })
    }, [])

    const reload = useCallback(() => load(data.weekStartIso, data.monthKey), [load, data.weekStartIso, data.monthKey])

    const goWeek = (delta: number) => {
        const cur = new Date(data.weekStartIso)
        const target = weekStartFor(new Date(cur.getTime() + delta * WEEK_MS))
        load(target.toISOString(), data.monthKey)
    }

    const goMonth = (delta: number) => {
        const target = delta > 0 ? nextYearMonth(data.monthKey) : previousYearMonth(data.monthKey)
        load(data.weekStartIso, target)
    }

    const venditoriById = useMemo(() => new Map(data.venditori.map(v => [v.id, v])), [data.venditori])
    const slots = useMemo(() => weekSlots(new Date(data.weekStartIso)), [data.weekStartIso])
    const coverageByKey = useMemo(() => new Map(data.coverage.map(c => [c.slotKey, c])), [data.coverage])

    const coverageCells = useMemo(() => {
        const m = new Map<string, SlotCellView>()
        for (const slot of slots) {
            const key = slotKey(slot)
            const cov = coverageByKey.get(key)
            const availableCount = cov?.available.length ?? 0
            const expected = (cov?.expectedPeople ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 1 })
            const names = cov?.available.map(id => venditoriById.get(id)?.name ?? id) ?? []
            const detail = names.length === 0
                ? undefined
                : names.length > 3
                    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
                    : names.join(', ')
            m.set(key, {
                state: 'libero',
                subtitle: `${availableCount} disp · ≈${expected}`,
                detail,
                tone: cov?.status ?? 'neutro',
                title: names.length > 0 ? names.join(', ') : undefined,
            })
        }
        return m
    }, [slots, coverageByKey, venditoriById])

    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <CalendarClock className="h-6 w-6 text-brand-orange" /> Calendari Venditori
                </h1>
                <p className="text-sm text-ash-500">
                    Copertura, compilazione e multe del calendario disponibilità.
                </p>
            </header>

            <div className="inline-flex flex-wrap rounded-lg border border-ash-200 bg-white p-1 text-sm font-semibold">
                <button
                    type="button"
                    onClick={() => setTab('copertura')}
                    className={`rounded-md px-3 py-1.5 transition-colors ${tab === 'copertura' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                >
                    Copertura
                </button>
                <button
                    type="button"
                    onClick={() => setTab('compilazione')}
                    className={`rounded-md px-3 py-1.5 transition-colors ${tab === 'compilazione' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                >
                    Compilazione
                </button>
                {showMulte && (
                    <button
                        type="button"
                        onClick={() => setTab('multe')}
                        className={`rounded-md px-3 py-1.5 transition-colors ${tab === 'multe' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                    >
                        Multe calendario
                    </button>
                )}
            </div>

            {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {tab !== 'multe' && (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => goWeek(-1)}
                        disabled={isPending}
                        aria-label="Settimana precedente"
                        className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="min-w-[10rem] text-center text-sm font-semibold text-ash-800">
                        {formatWeekRange(data.weekStartIso)}
                    </div>
                    <button
                        type="button"
                        onClick={() => goWeek(1)}
                        disabled={isPending}
                        aria-label="Settimana successiva"
                        className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {isPending && <Loader2 className="h-4 w-4 animate-spin text-ash-400" />}
                </div>
            )}

            {tab === 'copertura' && (
                <div className="space-y-4">
                    <SlotGrid weekStartIso={data.weekStartIso} cells={coverageCells} readOnly />
                    <CoverageLegend />
                    <MatrixCard matrix={data.matrix} venditoriById={venditoriById} slots={slots} />
                </div>
            )}

            {tab === 'compilazione' && (
                <CompilazioneTab
                    data={data}
                    venditoriById={venditoriById}
                    canWrite={canWrite}
                    onChanged={reload}
                />
            )}

            {tab === 'multe' && showMulte && (
                <MulteTab
                    data={data}
                    venditoriById={venditoriById}
                    canWrite={canWrite}
                    isPending={isPending}
                    onMonthChange={goMonth}
                    onChanged={reload}
                />
            )}
        </div>
    )
}

function MatrixCard({
    matrix, venditoriById, slots,
}: {
    matrix: SupervisionView['matrix']
    venditoriById: Map<string, { id: string; name: string; calendarExempt: boolean }>
    slots: Date[]
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-bold text-ash-800">Venditore × slot</h2>
            <p className="mb-3 text-xs text-ash-500">
                Ogni quadratino è un'ora dichiarata disponibile: serve a vedere a colpo d'occhio chi si accumula sulle stesse ore.
            </p>
            <div className="min-w-[560px] space-y-1.5">
                {matrix.length === 0 ? (
                    <div className="text-sm text-ash-500">Nessun venditore attivo.</div>
                ) : (
                    matrix.map(row => {
                        const name = venditoriById.get(row.salesUserId)?.name ?? row.salesUserId
                        const declared = new Set(row.slotKeys)
                        return (
                            <div key={row.salesUserId} className="flex items-center gap-2">
                                <div className="w-32 shrink-0 truncate text-xs font-semibold text-ash-700" title={name}>
                                    {name}
                                </div>
                                <div className="flex flex-1 flex-wrap gap-px">
                                    {slots.map((s, i) => {
                                        const key = slotKey(s)
                                        const on = declared.has(key)
                                        const dayIdx = Math.floor(i / 13)
                                        return (
                                            <div
                                                key={key}
                                                title={`${DAY_ABBR_IT[dayIdx]} ${slotLabel(s)} — ${on ? 'disponibile' : 'non disponibile'}`}
                                                className={`h-[6px] w-[6px] rounded-[1px] ${on ? 'bg-emerald-500' : 'bg-ash-200'}`}
                                            />
                                        )
                                    })}
                                </div>
                                <div className="w-10 shrink-0 text-right text-xs font-bold text-ash-600">
                                    {row.slotKeys.length}h
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function CompilazioneTab({
    data, venditoriById, canWrite, onChanged,
}: {
    data: SupervisionView
    venditoriById: Map<string, { id: string; name: string; calendarExempt: boolean }>
    canWrite: boolean
    onChanged: () => void
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-ash-50 text-[11px] font-bold uppercase tracking-wider text-ash-500">
                    <tr>
                        <th className="px-3 py-2">Venditore</th>
                        <th className="px-3 py-2">Compilato</th>
                        <th className="px-3 py-2">Quando</th>
                        <th className="px-3 py-2">Ore dichiarate</th>
                        <th className="px-3 py-2">Ritardo</th>
                        <th className="px-3 py-2">Multa</th>
                        <th className="px-3 py-2">Esente</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-ash-100">
                    {data.compilation.length === 0 && (
                        <tr>
                            <td colSpan={7} className="px-3 py-6 text-center text-ash-500">Nessun venditore attivo.</td>
                        </tr>
                    )}
                    {data.compilation.map(row => {
                        const v = venditoriById.get(row.salesUserId)
                        return (
                            <tr key={row.salesUserId} className="align-middle">
                                <td className="px-3 py-2 font-semibold text-ash-800">{v?.name ?? row.salesUserId}</td>
                                <td className="px-3 py-2">
                                    {row.submittedAtIso ? <Pill tone="green">Sì</Pill> : <Pill tone="red">No</Pill>}
                                </td>
                                <td className="px-3 py-2 text-ash-600">
                                    {row.submittedAtIso ? formatDateTime(row.submittedAtIso) : '—'}
                                </td>
                                <td className="px-3 py-2 text-ash-600">{row.slotCount}</td>
                                <td className="px-3 py-2">
                                    {row.late ? <Pill tone="amber">In ritardo</Pill> : <span className="text-ash-400">—</span>}
                                </td>
                                <td className="px-3 py-2">
                                    {row.penalised ? <Pill tone="red">50 €</Pill> : <span className="text-ash-400">—</span>}
                                </td>
                                <td className="px-3 py-2">
                                    <ExemptSwitch
                                        salesUserId={row.salesUserId}
                                        exempt={v?.calendarExempt ?? false}
                                        canWrite={canWrite}
                                        onChanged={onChanged}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

function ExemptSwitch({
    salesUserId, exempt, canWrite, onChanged,
}: {
    salesUserId: string
    exempt: boolean
    canWrite: boolean
    onChanged: () => void
}) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    if (!canWrite) {
        return <Pill tone={exempt ? 'neutral' : 'green'}>{exempt ? 'Esente' : 'No'}</Pill>
    }

    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                disabled={pending}
                aria-pressed={exempt}
                onClick={() => {
                    setError(null)
                    startTransition(async () => {
                        const res = await setCalendarExempt(salesUserId, !exempt)
                        if (!res.success) setError(res.error ?? 'Errore.')
                        else onChanged()
                    })
                }}
                className={`inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:opacity-50 ${exempt ? 'border-brand-orange bg-brand-orange/80' : 'border-ash-300 bg-ash-200'}`}
            >
                <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${exempt ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            {error && <div className="text-[10px] text-rose-600">{error}</div>}
        </div>
    )
}

function MulteTab({
    data, venditoriById, canWrite, isPending, onMonthChange, onChanged,
}: {
    data: SupervisionView
    venditoriById: Map<string, { id: string; name: string; calendarExempt: boolean }>
    canWrite: boolean
    isPending: boolean
    onMonthChange: (delta: number) => void
    onChanged: () => void
}) {
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onMonthChange(-1)}
                        disabled={isPending}
                        aria-label="Mese precedente"
                        className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="min-w-[9rem] text-center text-sm font-semibold text-ash-800">
                        {monthLabel(data.monthKey)}
                    </div>
                    <button
                        type="button"
                        onClick={() => onMonthChange(1)}
                        disabled={isPending}
                        aria-label="Mese successivo"
                        className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {isPending && <Loader2 className="h-4 w-4 animate-spin text-ash-400" />}
                </div>
                <div className="text-sm font-bold text-ash-800">
                    Totale mese: {eurFmt.format(data.totalEur)}
                </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="bg-ash-50 text-[11px] font-bold uppercase tracking-wider text-ash-500">
                        <tr>
                            <th className="px-3 py-2">Venditore</th>
                            <th className="px-3 py-2">Tipo</th>
                            <th className="px-3 py-2">Quando</th>
                            <th className="px-3 py-2">Segnalata da</th>
                            <th className="px-3 py-2">Nota</th>
                            <th className="px-3 py-2">Importo</th>
                            <th className="px-3 py-2">Stato</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ash-100">
                        {data.penalties.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 py-6 text-center text-ash-500">Nessuna multa in questo mese.</td>
                            </tr>
                        )}
                        {data.penalties.map(p => {
                            const v = venditoriById.get(p.salesUserId)
                            const voided = !!p.voidedAtIso
                            const strike = voided ? 'line-through text-ash-400' : 'text-ash-700'
                            return (
                                <tr key={p.id} className="align-top">
                                    <td className={`px-3 py-2 font-semibold ${strike}`}>{v?.name ?? p.salesUserId}</td>
                                    <td className={`px-3 py-2 ${strike}`}>
                                        {kindLabel(p.kind)}
                                        {p.leadName && <div className="text-[11px] text-ash-400">{p.leadName}</div>}
                                    </td>
                                    <td className={`px-3 py-2 ${strike}`}>{formatDateTime(p.dueAt)}</td>
                                    <td className={`px-3 py-2 ${strike}`}>{p.reportedByName ?? 'Sistema'}</td>
                                    <td className={`px-3 py-2 ${strike}`}>{p.note ?? '—'}</td>
                                    <td className={`px-3 py-2 font-semibold ${strike}`}>{eurFmt.format(p.amountEur)}</td>
                                    <td className="px-3 py-2">
                                        {voided ? (
                                            <div className="text-xs text-ash-500">
                                                <Pill tone="neutral">Annullata</Pill>
                                                <div className="mt-1 italic">{p.voidReason}</div>
                                            </div>
                                        ) : canWrite ? (
                                            <VoidPenaltyControl penaltyId={p.id} onVoided={onChanged} />
                                        ) : (
                                            <Pill tone="red">Attiva</Pill>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function VoidPenaltyControl({ penaltyId, onVoided }: { penaltyId: string; onVoided: () => void }) {
    const [open, setOpen] = useState(false)
    const [reason, setReason] = useState('')
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    if (!open) {
        return (
            <div>
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                    Annulla
                </button>
            </div>
        )
    }

    return (
        <div className="flex min-w-[10rem] flex-col gap-1">
            <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo (obbligatorio)"
                disabled={pending}
                className="rounded border border-ash-300 px-2 py-1 text-xs"
            />
            <div className="flex gap-1">
                <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                        setError(null)
                        startTransition(async () => {
                            const res = await voidCalendarPenalty(penaltyId, reason)
                            if (!res.success) {
                                setError(res.error ?? 'Annullamento non riuscito.')
                            } else {
                                setOpen(false)
                                onVoided()
                            }
                        })
                    }}
                    className="rounded bg-rose-600 px-2 py-1 text-xs font-bold text-white hover:brightness-95 disabled:opacity-50"
                >
                    {pending ? 'Invio…' : 'Conferma'}
                </button>
                <button
                    type="button"
                    disabled={pending}
                    onClick={() => { setOpen(false); setReason(''); setError(null) }}
                    className="rounded border border-ash-300 px-2 py-1 text-xs font-semibold text-ash-600 hover:bg-ash-50"
                >
                    Annulla
                </button>
            </div>
            {error && <div className="text-[10px] text-rose-600">{error}</div>}
        </div>
    )
}
