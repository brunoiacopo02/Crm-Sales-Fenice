"use client"

/**
 * Client della pagina "Il mio Calendario". Due viste dietro un interruttore:
 * il proprio calendario (spunta ore, blocca/sblocca imprevisti) e la
 * copertura squadra (sola lettura, motivo per cui il PO ha chiesto la
 * funzione: vedere le fasce scoperte in anticipo).
 */

import { useState, useEffect, useMemo, useCallback, useTransition } from "react"
import { ChevronLeft, ChevronRight, Loader2, CalendarClock } from "lucide-react"
import {
    getCalendarWeek, saveCalendarWeek, blockSlot, unblockSlot, type CalendarWeekView,
} from "@/app/actions/salesCalendarActions"
import { weekSlots, weekStartFor, slotKey, slotLabel } from "@/lib/venditore/calendarSlots"
import { MANUAL_BLOCK_NOTICE_MINUTES } from "@/lib/venditore/calendarRules"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { SlotGrid, type SlotCellView } from "@/components/calendar/SlotGrid"
import { CoverageLegend } from "@/components/calendar/CoverageLegend"

interface Props {
    initial: CalendarWeekView
    role: string
}

const WEEK_MS = 7 * 86_400_000
const MAX_WEEKS_FORWARD = 3

const weekdayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })
const dateSlashFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric' })
const monthOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' })

function formatCountdown(ms: number): string {
    if (ms <= 0) return '0m'
    const totalMinutes = Math.floor(ms / 60_000)
    const days = Math.floor(totalMinutes / (24 * 60))
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60
    if (days > 0) return `${days}g ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
}

function formatWeekRange(weekStartIso: string): string {
    const start = new Date(weekStartIso)
    const end = new Date(start.getTime() + 5 * 86_400_000) // sabato: mai/dom mai attraversata da DST
    const startMonth = monthOnlyFmt.format(start)
    const endMonth = monthOnlyFmt.format(end)
    const startDay = dayOnlyFmt.format(start)
    const endDay = dayOnlyFmt.format(end)
    return startMonth === endMonth
        ? `${startDay} – ${endDay} ${endMonth}`
        : `${startDay} ${startMonth} – ${endDay} ${endMonth}`
}

function readOnlyNote(editable: boolean, reason: CalendarWeekView['readOnlyReason']): string | null {
    if (editable) return null
    if (reason === 'settimana_passata') return 'Settimana passata: sola lettura.'
    if (reason === 'altro_venditore') return 'Stai guardando il calendario di un altro venditore: sola lettura.'
    // Caso limite: un non-VENDITORE (admin/manager/conferme) guarda il proprio
    // account. Niente motivo specifico dal contratto dati: non lasciarlo muto.
    return 'Sola lettura.'
}

function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function fasciaLabel(cov: CoverageCell): string {
    const dt = new Date(cov.slotStart)
    const weekday = capitalize(weekdayFmt.format(dt))
    const day = dayOnlyFmt.format(dt)
    const time = slotLabel(dt)
    const attesi = cov.expectedPeople.toLocaleString('it-IT', { maximumFractionDigits: 1 })
    const chi = cov.available.length === 0
        ? 'nessuno disponibile'
        : `${cov.available.length} disponibil${cov.available.length === 1 ? 'e' : 'i'}`
    return `${weekday} ${day} alle ${time} — ${chi}, ≈${attesi} attesi`
}

function StatusStrip({ data, now }: { data: CalendarWeekView; now: Date }) {
    const deadline = new Date(data.deadlineIso)

    if (data.submittedAtIso) {
        const submitted = new Date(data.submittedAtIso)
        return (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {`Compilato ${weekdayFmt.format(submitted)} ${dateSlashFmt.format(submitted)} alle ${timeFmt.format(submitted)} — ${data.slotCount} ore dichiarate`}
                {data.late && ' (in ritardo)'}
            </div>
        )
    }
    if (data.isExempt) {
        return (
            <div className="rounded-xl border border-ash-200 bg-ash-50 px-4 py-3 text-sm text-ash-600">
                Sei esente dall&apos;obbligo di compilazione.
            </div>
        )
    }
    if (data.penaltyIso) {
        const penalty = new Date(data.penaltyIso)
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {`Calendario non compilato: multa di 50 € registrata ${weekdayFmt.format(penalty)} ${dateSlashFmt.format(penalty)}. Puoi compilare comunque.`}
            </div>
        )
    }
    if (now < deadline) {
        const ms = deadline.getTime() - now.getTime()
        return (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {`Compila entro ${weekdayFmt.format(deadline)} ${timeFmt.format(deadline)} — mancano ${formatCountdown(ms)}`}
            </div>
        )
    }
    // Scadenza passata ma la multa non risulta ancora registrata (es. cron non
    // ancora eseguito): non inventiamo un importo, solo lo stato dei fatti.
    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {`Calendario non compilato: la scadenza delle ${timeFmt.format(deadline)} di ${weekdayFmt.format(deadline)} è passata.`}
        </div>
    )
}

export function MioCalendarioClient({ initial, role }: Props) {
    const [data, setData] = useState<CalendarWeekView>(initial)
    const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.mySlots))
    const [view, setView] = useState<'mio' | 'copertura'>('mio')
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [now, setNow] = useState<Date>(() => new Date())

    // Countdown ricalcolato ogni minuto, mai a ogni render.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000)
        return () => clearInterval(id)
    }, [])

    // La selezione locale segue la settimana caricata: al cambio settimana si
    // riparte sempre dallo stato salvato lato server.
    useEffect(() => {
        setSelected(new Set(data.mySlots))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.weekStartIso])

    const loadWeek = useCallback((weekStartIso: string) => {
        setError(null)
        startTransition(async () => {
            try {
                const fresh = await getCalendarWeek({ weekStartIso })
                setData(fresh)
            } catch (e: any) {
                setError(e?.message || 'Errore caricamento calendario.')
            }
        })
    }, [])

    const maxForwardWeekMs = useMemo(() => {
        const cur = weekStartFor(new Date())
        return cur.getTime() + MAX_WEEKS_FORWARD * WEEK_MS
    }, [])

    const goWeek = (delta: number) => {
        const cur = new Date(data.weekStartIso)
        const naive = new Date(cur.getTime() + delta * WEEK_MS)
        const target = weekStartFor(naive)
        loadWeek(target.toISOString())
    }

    const atMaxForward = new Date(data.weekStartIso).getTime() >= maxForwardWeekMs

    const slots = useMemo(() => weekSlots(new Date(data.weekStartIso)), [data.weekStartIso])
    const instantByKey = useMemo(() => new Map(slots.map(s => [slotKey(s), s])), [slots])
    const coverageByKey = useMemo(() => new Map(data.coverage.map(c => [c.slotKey, c])), [data.coverage])
    const venditoriById = useMemo(() => new Map(data.venditori.map(v => [v.id, v.name])), [data.venditori])
    const blocksByKey = useMemo(() => new Map(data.myBlocks.map(b => [b.slotKey, b])), [data.myBlocks])
    const apptByKey = useMemo(() => new Map(data.myAppointments.map(a => [a.slotKey, a])), [data.myAppointments])
    const mySlotsSet = useMemo(() => new Set(data.mySlots), [data.mySlots])

    const myCells = useMemo(() => {
        const m = new Map<string, SlotCellView>()
        for (const slot of slots) {
            const key = slotKey(slot)
            const appt = apptByKey.get(key)
            const block = blocksByKey.get(key)
            const cov = coverageByKey.get(key)

            let state: SlotCellView['state']
            let subtitle: string | undefined
            let menuDisabled: boolean | undefined
            let menuTitle: string | undefined

            if (appt) {
                state = 'occupato'
                subtitle = appt.leadName
            } else if (block) {
                state = 'bloccato'
                subtitle = block.kind === 'FOLLOWUP' ? `Follow-up: ${block.leadName ?? ''}` : 'Bloccato'
                // `unblockSlot` rifiuta sempre i blocchi FOLLOWUP: il bottone
                // resta visibile ma spento, con la spiegazione, non nascosto
                // (stessa decisione della finestra di preavviso qui sotto).
                if (block.kind === 'FOLLOWUP') {
                    menuDisabled = true
                    menuTitle = "Questo slot è occupato da un follow-up: spostalo o registrane l'esito."
                }
            } else if (selected.has(key)) {
                state = 'disponibile'
                // Anticipazione lato client della stessa regola server-side
                // (manualBlockCheck/MANUAL_BLOCK_NOTICE_MINUTES): il controllo
                // vero resta nel server action, questo evita solo il click a
                // vuoto seguito da un rifiuto che sembra un guasto.
                const minutiDiPreavviso = (slot.getTime() - now.getTime()) / 60_000
                if (minutiDiPreavviso <= MANUAL_BLOCK_NOTICE_MINUTES) {
                    menuDisabled = true
                    menuTitle = "Troppo tardi: uno slot si blocca almeno un'ora prima."
                }
            } else {
                state = 'libero'
            }

            // La copertura arriva dal DB (ultimo salvataggio), non dalla
            // selezione locale non ancora salvata: per non contarmi due volte
            // sottraggo me stesso solo se ero davvero disponibile server-side.
            const amIAvailableServerSide = mySlotsSet.has(key) && !blocksByKey.has(key)
            const othersAvailable = cov ? cov.available.length - (amIAvailableServerSide ? 1 : 0) : 0

            m.set(key, {
                state,
                subtitle,
                badge: othersAvailable > 0 ? String(othersAvailable) : undefined,
                tone: cov?.status ?? 'neutro',
                menuDisabled,
                menuTitle,
            })
        }
        return m
    }, [slots, apptByKey, blocksByKey, coverageByKey, selected, mySlotsSet, now])

    const coverageCells = useMemo(() => {
        const m = new Map<string, SlotCellView>()
        for (const slot of slots) {
            const key = slotKey(slot)
            const cov = coverageByKey.get(key)
            const availableCount = cov?.available.length ?? 0
            const expected = (cov?.expectedPeople ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 1 })
            const names = cov?.available.map(id => venditoriById.get(id) ?? id) ?? []
            // I nomi vanno nel corpo della cella (spec §5.1): il `title` resta
            // solo come comodità per chi ha il mouse, non l'unico posto dove
            // esistono — su telefono l'hover non esiste.
            const detail = names.length === 0
                ? undefined
                : names.length > 3
                    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
                    : names.join(', ')
            m.set(key, {
                // Il segnale primario qui è il semaforo (`tone`), non lo stato
                // personale: teniamo il fondo cella neutro per non doppiare il
                // messaggio.
                state: 'libero',
                subtitle: `${availableCount} disp · ≈${expected}`,
                detail,
                tone: cov?.status ?? 'neutro',
                title: names.length > 0 ? names.join(', ') : undefined,
            })
        }
        return m
    }, [slots, coverageByKey, venditoriById])

    const dirty = useMemo(() => {
        if (selected.size !== data.mySlots.length) return true
        for (const k of data.mySlots) if (!selected.has(k)) return true
        return false
    }, [selected, data.mySlots])

    const uncovered = useMemo(
        () => data.coverage.filter(c => c.status === 'rosso' || c.status === 'ambra'),
        [data.coverage],
    )

    const handleCellClick = (key: string) => {
        if (!data.editable) return
        const cell = myCells.get(key)
        if (!cell) return
        if (cell.state === 'occupato' || cell.state === 'bloccato') return
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const handleCellMenu = (key: string) => {
        if (!data.editable) return
        const cell = myCells.get(key)
        const instant = instantByKey.get(key)
        if (!cell || !instant || cell.menuDisabled) return
        const slotIso = instant.toISOString()

        if (cell.state === 'disponibile') {
            setError(null)
            startTransition(async () => {
                const res = await blockSlot(slotIso)
                if (!res.success) setError(res.error ?? 'Blocco non riuscito.')
                else loadWeek(data.weekStartIso)
            })
        } else if (cell.state === 'bloccato') {
            setError(null)
            startTransition(async () => {
                const res = await unblockSlot(slotIso)
                if (!res.success) setError(res.error ?? 'Sblocco non riuscito.')
                else loadWeek(data.weekStartIso)
            })
        }
    }

    const handleSave = () => {
        setError(null)
        startTransition(async () => {
            const res = await saveCalendarWeek(data.weekStartIso, [...selected])
            if (!res.success) {
                setError(res.error ?? 'Salvataggio non riuscito: riprova fra un momento.')
                return
            }
            try {
                const fresh = await getCalendarWeek({ weekStartIso: data.weekStartIso })
                setData(fresh)
            } catch (e: any) {
                setError(e?.message || 'Salvato, ma il ricaricamento è fallito: aggiorna la pagina.')
            }
        })
    }

    const roNote = readOnlyNote(data.editable, data.readOnlyReason)

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <CalendarClock className="h-6 w-6 text-brand-orange" /> Il mio Calendario
                </h1>
                <p className="text-sm text-ash-500">
                    Dichiara le ore in cui sei disponibile per gli appuntamenti dei prossimi giorni.
                </p>
            </header>

            {role === 'VENDITORE' && <StatusStrip data={data} now={now} />}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
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
                        disabled={isPending || atMaxForward}
                        aria-label="Settimana successiva"
                        className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    {isPending && <Loader2 className="h-4 w-4 animate-spin text-ash-400" />}
                </div>

                <div className="inline-flex rounded-lg border border-ash-200 bg-white p-1 text-sm font-semibold">
                    <button
                        type="button"
                        onClick={() => setView('mio')}
                        className={`rounded-md px-3 py-1.5 transition-colors ${view === 'mio' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                    >
                        Il mio calendario
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('copertura')}
                        className={`rounded-md px-3 py-1.5 transition-colors ${view === 'copertura' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                    >
                        Copertura squadra
                    </button>
                </div>
            </div>

            {roNote && (
                <div className="text-xs italic text-ash-500">{roNote}</div>
            )}

            {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {view === 'mio' ? (
                <div className="space-y-3">
                    <SlotGrid
                        weekStartIso={data.weekStartIso}
                        cells={myCells}
                        onCellClick={handleCellClick}
                        onCellMenu={handleCellMenu}
                        readOnly={!data.editable}
                    />
                    <CoverageLegend />
                    {role === 'VENDITORE' && (
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!data.editable || !dirty || isPending}
                                className="flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50"
                            >
                                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                                {`Salva (${selected.size} ore)`}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    <SlotGrid
                        weekStartIso={data.weekStartIso}
                        cells={coverageCells}
                        readOnly
                    />
                    <CoverageLegend />
                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-2 text-sm font-bold text-ash-800">Fasce scoperte questa settimana</h2>
                        {uncovered.length === 0 ? (
                            <div className="text-sm text-ash-500">Nessuna fascia scoperta.</div>
                        ) : (
                            <ul className="space-y-1 text-sm text-ash-700">
                                {uncovered.map(c => (
                                    <li key={c.slotKey}>{fasciaLabel(c)}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
