"use client"

import { useState, useTransition, useMemo } from "react"
import { Calendar as CalendarIcon, AlertTriangle, Users, RefreshCw, Loader2, Phone, ClipboardList, Clock, Timer } from "lucide-react"
import {
    getVenditoriMonitor,
    type VenditoriMonitorData,
    type AppointmentRow,
    type FollowUpRow,
    type LatePenaltyRowKind,
} from "@/app/actions/venditoriMonitorActions"

interface Props {
    initialData: VenditoriMonitorData
    initialStart: string
    initialEnd: string
}

function formatDateIT(d: Date | string): string {
    const dt = new Date(d)
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

function formatDateTimeIT(d: Date | string): string {
    const dt = new Date(d)
    return `${formatDateIT(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

function toDateInput(d: Date | string): string {
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Ultimi 12 mesi, dal corrente all'indietro: 'YYYY-MM' + etichetta italiana. */
function lastMonths(count = 12): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = []
    const now = new Date()
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        out.push({ key, label: d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) })
    }
    return out
}

/** Le quattro etichette italiane della colonna Tipo (registro unico ritardi + multe calendario). */
const PENALTY_KIND_LABELS: Record<LatePenaltyRowKind, string> = {
    APPOINTMENT: 'Appuntamento',
    FOLLOWUP: 'Follow-up',
    CALENDAR_MISSING: 'Calendario non compilato',
    ABSENT_SLOT: 'Assente allo slot',
}

/** Etichette brevi delle pastiglie-filtro, in ordine di visualizzazione. */
const PENALTY_KIND_FILTERS: { kind: LatePenaltyRowKind; label: string }[] = [
    { kind: 'APPOINTMENT', label: 'Appuntamenti' },
    { kind: 'FOLLOWUP', label: 'Follow-up' },
    { kind: 'CALENDAR_MISSING', label: 'Calendario' },
    { kind: 'ABSENT_SLOT', label: 'Assenze' },
]

function apptStatusBadge(a: AppointmentRow) {
    if (a.salespersonOutcome === 'Chiuso') return { label: 'Chiuso', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    if (a.salespersonOutcome === 'Non chiuso') return { label: 'Non chiuso', cls: 'bg-rose-100 text-rose-700 border-rose-200' }
    if (a.salespersonOutcome === 'Sparito') return { label: 'Sparito', cls: 'bg-ash-200 text-ash-700 border-ash-300' }
    if (a.confirmationsOutcome === 'confermato') return { label: 'Confermato', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    if (a.confirmationsOutcome === 'scartato') return { label: 'Scartato', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
    return { label: 'In attesa', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
}

export function MonitorVenditeClient({ initialData, initialStart, initialEnd }: Props) {
    const [data, setData] = useState(initialData)
    const [startDate, setStartDate] = useState(toDateInput(initialStart))
    const [endDate, setEndDate] = useState(toDateInput(initialEnd))
    const [selectedVenditori, setSelectedVenditori] = useState<string[]>([])
    const [penaltyMonth, setPenaltyMonth] = useState(initialData.penaltyMonthKey)
    const [penaltyKindFilter, setPenaltyKindFilter] = useState<LatePenaltyRowKind | null>(null)
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const months = useMemo(() => lastMonths(), [])
    // Righe che la tabella sta mostrando ADESSO (annullate incluse: restano
    // visibili, barrate). Ogni numero dell'intestazione deve descrivere questo
    // insieme, non il mese intero, altrimenti pastiglia/totale/tabella non
    // raccontano la stessa cosa quando un filtro è attivo.
    const filteredPenalties = useMemo(
        () => penaltyKindFilter ? data.latePenalties.filter(p => p.kind === penaltyKindFilter) : data.latePenalties,
        [data.latePenalties, penaltyKindFilter],
    )
    // Il totale in euro segue il filtro attivo (somma solo le righe mostrate)
    // ed esclude sempre le annullate: sono soldi non dovuti, non righe da
    // nascondere. Quando un filtro è attivo l'etichetta lo dice esplicitamente
    // (vedi `activeFilterLabel`), perché altrimenti "-120 €" sembrerebbe il
    // totale del mese e non lo è.
    const totalMalus = useMemo(
        () => filteredPenalties.reduce((sum, p) => sum + (p.voidedAtIso ? 0 : p.amountEur), 0),
        [filteredPenalties],
    )
    const activeFilterLabel = useMemo(
        () => PENALTY_KIND_FILTERS.find(f => f.kind === penaltyKindFilter)?.label ?? null,
        [penaltyKindFilter],
    )

    const apply = () => {
        setError(null)
        startTransition(async () => {
            try {
                const s = new Date(startDate + 'T00:00:00')
                const e = new Date(endDate + 'T23:59:59')
                const fresh = await getVenditoriMonitor({
                    startDate: s,
                    endDate: e,
                    venditoreIds: selectedVenditori,
                    penaltyMonthKey: penaltyMonth,
                })
                setData(fresh)
            } catch (err: any) {
                setError(err?.message || 'Errore caricamento')
            }
        })
    }

    const changePenaltyMonth = (mk: string) => {
        setPenaltyMonth(mk)
        setPenaltyKindFilter(null)
        setError(null)
        startTransition(async () => {
            try {
                const s = new Date(startDate + 'T00:00:00')
                const e = new Date(endDate + 'T23:59:59')
                const fresh = await getVenditoriMonitor({
                    startDate: s,
                    endDate: e,
                    venditoreIds: selectedVenditori,
                    penaltyMonthKey: mk,
                })
                setData(fresh)
            } catch (err: any) {
                setError(err?.message || 'Errore caricamento')
            }
        })
    }

    const toggleVenditore = (id: string) => {
        setSelectedVenditori(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    // Stats per venditore — aiuta l'admin a vedere il carico a colpo d'occhio
    const perSellerStats = useMemo(() => {
        const m = new Map<string, { name: string; appts: number; upcomingFu: number; overdueFu: number; ritardi: number; malusEur: number }>()
        for (const v of data.venditori) m.set(v.id, { name: v.name, appts: 0, upcomingFu: 0, overdueFu: 0, ritardi: 0, malusEur: 0 })
        for (const a of data.appointments) {
            const s = m.get(a.venditoreId); if (s) s.appts++
        }
        for (const f of data.upcomingFollowUps) {
            const s = m.get(f.venditoreId); if (s) s.upcomingFu++
        }
        for (const f of data.overdueFollowUps) {
            const s = m.get(f.venditoreId); if (s) s.overdueFu++
        }
        for (const p of data.latePenaltySummary) {
            const s = m.get(p.venditoreId)
            if (s) { s.ritardi = p.count; s.malusEur = p.totalEur }
        }
        return Array.from(m.values())
            .filter(s => s.appts + s.upcomingFu + s.overdueFu + s.ritardi > 0)
            .sort((a, b) => b.appts - a.appts)
    }, [data])

    return (
        <div className="mx-auto max-w-6xl space-y-5">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <ClipboardList className="h-6 w-6 text-brand-orange" /> Monitor Vendite
                </h1>
                <p className="text-sm text-ash-500">
                    Appuntamenti e follow-up di tutti i venditori. Permette di verificare carico e pratiche scadute.
                </p>
            </header>

            {/* Filters */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ash-500 mb-1">Dal</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="rounded-lg border border-ash-200 px-2 py-1 text-sm" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ash-500 mb-1">Al</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="rounded-lg border border-ash-200 px-2 py-1 text-sm" />
                    </div>
                    <div className="flex-1 min-w-[240px]">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ash-500 mb-1">
                            Venditori {selectedVenditori.length > 0 ? `(${selectedVenditori.length} selezionati)` : '(tutti)'}
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {data.venditori.map(v => {
                                const active = selectedVenditori.includes(v.id)
                                return (
                                    <button
                                        key={v.id}
                                        onClick={() => toggleVenditore(v.id)}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${active ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-ash-700 border-ash-200 hover:bg-ash-50'}`}
                                    >
                                        {v.name}
                                    </button>
                                )
                            })}
                            {selectedVenditori.length > 0 && (
                                <button onClick={() => setSelectedVenditori([])} className="text-[11px] text-ash-500 underline ml-1">pulisci</button>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={apply}
                        disabled={isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-orange px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Aggiorna
                    </button>
                </div>
                {error && <div className="mt-2 text-xs text-rose-700">{error}</div>}
            </section>

            {/* Per-seller stats */}
            {perSellerStats.length > 0 && (
                <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-ash-900 mb-3">
                        <Users className="h-4 w-4" /> Carico per venditore nel periodo
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[11px] uppercase text-ash-500 border-b border-ash-200">
                                    <th className="text-left py-2 font-semibold">Venditore</th>
                                    <th className="text-right py-2 font-semibold">Appuntamenti</th>
                                    <th className="text-right py-2 font-semibold">Follow-up prossimi</th>
                                    <th className="text-right py-2 font-semibold">Follow-up scaduti</th>
                                    <th className="text-right py-2 font-semibold">Ritardi</th>
                                    <th className="text-right py-2 font-semibold">Malus</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perSellerStats.map(s => (
                                    <tr key={s.name} className="border-b border-ash-100 last:border-0">
                                        <td className="py-2 font-medium text-ash-800">{s.name}</td>
                                        <td className="text-right py-2 text-ash-700">{s.appts}</td>
                                        <td className="text-right py-2 text-ash-700">{s.upcomingFu}</td>
                                        <td className={`text-right py-2 font-semibold ${s.overdueFu > 0 ? 'text-rose-600' : 'text-ash-400'}`}>{s.overdueFu}</td>
                                        <td className={`text-right py-2 font-semibold ${s.ritardi > 0 ? 'text-rose-600' : 'text-ash-400'}`}>{s.ritardi}</td>
                                        <td className={`text-right py-2 font-semibold ${s.malusEur > 0 ? 'text-rose-700' : 'text-ash-400'}`}>
                                            {s.malusEur > 0 ? `-${s.malusEur.toFixed(0)} €` : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Lead in lavorazione (parcheggiati senza data follow-up) */}
            {data.inLavorazione.length > 0 && (
                <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
                    <h2 className="text-sm font-bold text-blue-900 mb-3">
                        Lead in lavorazione (senza data follow-up)
                        <span className="ml-2 rounded-full bg-blue-200 text-blue-800 px-2 py-0.5 text-[11px] font-bold">
                            {data.inLavorazione.reduce((s, v) => s + v.count, 0)}
                        </span>
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {data.inLavorazione.map(v => (
                            <div
                                key={v.venditoreId}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${v.maxDays > 14
                                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                                    : v.maxDays > 7
                                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                                        : 'border-ash-200 bg-white text-ash-700'}`}
                            >
                                <span className="font-bold">{v.venditoreName}</span>
                                <span>{v.count} lead</span>
                                <span className="text-[10px] opacity-70">max {v.maxDays} gg</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Ritardi e multe del mese — registro unico (10 € ritardi + 50 € calendario) */}
            <section className="rounded-2xl border border-rose-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 px-4 py-3">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-rose-900">
                        <Timer className="h-4 w-4 text-rose-600" />
                        Ritardi e multe
                        {data.penaltyRule.active ? (
                            <>
                                {/* Conteggio delle righe mostrate ADESSO (annullate incluse: sono visibili). */}
                                <span className="ml-1 rounded-full bg-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                                    {filteredPenalties.length}
                                </span>
                                {totalMalus > 0 && (
                                    <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                                        -{totalMalus.toFixed(0)} &euro;{activeFilterLabel ? ` (${activeFilterLabel})` : ''}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="rounded-full bg-ash-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ash-600">
                                Non in vigore
                            </span>
                        )}
                    </h2>
                    <select
                        value={penaltyMonth}
                        onChange={e => changePenaltyMonth(e.target.value)}
                        disabled={isPending}
                        className="rounded-lg border border-ash-200 px-2 py-1 text-xs font-medium capitalize disabled:opacity-50"
                    >
                        {months.map(m => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {data.penaltyRule.active && data.latePenalties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b border-rose-100 bg-rose-50/40 px-4 py-2.5">
                        {PENALTY_KIND_FILTERS.map(f => {
                            const count = data.penaltyKindCounts[f.kind]
                            const active = penaltyKindFilter === f.kind
                            return (
                                <div key={f.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setPenaltyKindFilter(active ? null : f.kind)}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${active
                                            ? 'border-rose-600 bg-rose-600 text-white'
                                            : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'}`}
                                    >
                                        {f.label} <span className="opacity-80">({count})</span>
                                    </button>
                                </div>
                            )
                        })}
                        {penaltyKindFilter && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setPenaltyKindFilter(null)}
                                    className="rounded-full px-2 py-1 text-[11px] text-ash-500 underline"
                                >
                                    pulisci filtro
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {!data.penaltyRule.active ? (
                    <div className="px-4 py-6 text-center text-sm text-ash-500">
                        <p className="font-semibold text-ash-700">
                            {data.penaltyRule.reason === 'kill_switch'
                                ? 'Malus ritardi sospeso.'
                                : 'Malus ritardi non ancora attivo.'}
                        </p>
                        <p className="mt-1">
                            {data.penaltyRule.reason === 'kill_switch'
                                ? 'Il kill-switch è acceso: le scadenze scoperte restano nelle liste qui sopra e non maturano trattenute.'
                                : 'Nessuna scadenza sta maturando trattenute. La regola entra in vigore quando viene fissata la data di attivazione.'}
                        </p>
                    </div>
                ) : data.latePenalties.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-ash-500">
                        Nessun ritardo o multa in questo mese.
                        <span className="ml-1 text-ash-400">
                            Regola in vigore dal {formatDateIT(new Date(data.penaltyRule.from))}.
                        </span>
                    </div>
                ) : filteredPenalties.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-ash-500">
                        Nessuna riga per questo filtro.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ash-200 text-[11px] uppercase text-ash-500">
                                    <th className="px-4 py-2 text-left font-semibold">Venditore</th>
                                    <th className="px-4 py-2 text-left font-semibold">Lead</th>
                                    <th className="px-4 py-2 text-left font-semibold">Tipo</th>
                                    <th className="px-4 py-2 text-left font-semibold">Scadenza</th>
                                    <th className="px-4 py-2 text-left font-semibold">Stato</th>
                                    <th className="px-4 py-2 text-left font-semibold">Segnalata da</th>
                                    <th className="px-4 py-2 text-right font-semibold">Malus</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPenalties.map(p => {
                                    const voided = !!p.voidedAtIso
                                    return (
                                        <tr
                                            key={p.id}
                                            className={`border-b border-ash-100 last:border-0 ${voided ? 'line-through text-ash-400' : ''}`}
                                            title={voided ? (p.voidReason || 'Multa annullata') : undefined}
                                        >
                                            <td className="px-4 py-2 font-medium text-ash-800">{p.venditoreName}</td>
                                            <td className="px-4 py-2 text-ash-700">{p.leadName ?? '—'}</td>
                                            <td className="px-4 py-2 text-ash-600">
                                                {PENALTY_KIND_LABELS[p.kind]}
                                            </td>
                                            <td className="px-4 py-2 text-ash-600">{formatDateTimeIT(p.dueAt)}</td>
                                            <td className="px-4 py-2">
                                                {p.kind === 'APPOINTMENT' || p.kind === 'FOLLOWUP' ? (
                                                    p.resolvedAt ? (
                                                        <span className="rounded-full border border-ash-200 bg-ash-50 px-2 py-0.5 text-[11px] font-semibold text-ash-700">
                                                            Esitato dopo {p.hoursLate}h
                                                        </span>
                                                    ) : (
                                                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                                            Ancora da esitare ({p.hoursLate}h)
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className="rounded-full border border-ash-200 bg-ash-50 px-2 py-0.5 text-[11px] font-semibold text-ash-700">
                                                        Multa fissa
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-ash-600">{p.reportedByName || ''}</td>
                                            <td className="px-4 py-2 text-right font-semibold text-rose-700">
                                                -{p.amountEur.toFixed(0)} &euro;
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* Overdue follow-ups — alert */}
            {data.overdueFollowUps.length > 0 && (
                <section className="rounded-2xl border border-rose-200 bg-rose-50/50 shadow-sm">
                    <div className="flex items-center gap-2 border-b border-rose-200 px-4 py-3">
                        <AlertTriangle className="h-4 w-4 text-rose-600" />
                        <h2 className="text-sm font-bold text-rose-900">
                            Follow-up scaduti non gestiti
                            <span className="ml-2 rounded-full bg-rose-200 text-rose-800 px-2 py-0.5 text-[11px] font-bold">{data.overdueFollowUps.length}</span>
                        </h2>
                    </div>
                    <FollowUpList items={data.overdueFollowUps} overdue />
                </section>
            )}

            {/* Upcoming appointments */}
            <section className="rounded-2xl border border-ash-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-ash-100 px-4 py-3">
                    <CalendarIcon className="h-4 w-4 text-brand-orange" />
                    <h2 className="text-sm font-bold text-ash-900">
                        Appuntamenti venditori
                        <span className="ml-2 rounded-full bg-ash-100 text-ash-700 px-2 py-0.5 text-[11px] font-bold">{data.appointments.length}</span>
                    </h2>
                </div>
                {data.appointments.length === 0 ? (
                    <div className="p-6 text-center text-sm text-ash-400">Nessun appuntamento nel periodo selezionato.</div>
                ) : (
                    <ul className="divide-y divide-ash-100">
                        {data.appointments.map(a => {
                            const badge = apptStatusBadge(a)
                            return (
                                <li key={a.leadId + a.appointmentDate} className="px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-ash-50/60">
                                    <div className="font-mono text-xs font-bold text-ash-900 w-[112px] shrink-0">
                                        {formatDateTimeIT(a.appointmentDate)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-semibold text-ash-900 truncate">{a.leadName}</div>
                                        <div className="text-[11px] text-ash-500 flex items-center gap-2 flex-wrap">
                                            {a.funnel && <span className="uppercase">{a.funnel}</span>}
                                            {a.leadPhone && <span className="font-mono flex items-center gap-0.5"><Phone className="h-3 w-3" />{a.leadPhone}</span>}
                                            {a.appointmentNote && <span className="italic truncate max-w-[200px]" title={a.appointmentNote}>— {a.appointmentNote}</span>}
                                        </div>
                                    </div>
                                    <div className="text-xs font-semibold text-ash-700 shrink-0">{a.venditoreName}</div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.cls} shrink-0`}>{badge.label}</span>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </section>

            {/* Upcoming follow-ups */}
            <section className="rounded-2xl border border-ash-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-ash-100 px-4 py-3">
                    <Clock className="h-4 w-4 text-blue-600" />
                    <h2 className="text-sm font-bold text-ash-900">
                        Follow-up programmati
                        <span className="ml-2 rounded-full bg-ash-100 text-ash-700 px-2 py-0.5 text-[11px] font-bold">{data.upcomingFollowUps.length}</span>
                    </h2>
                </div>
                {data.upcomingFollowUps.length === 0 ? (
                    <div className="p-6 text-center text-sm text-ash-400">Nessun follow-up programmato nel periodo.</div>
                ) : (
                    <FollowUpList items={data.upcomingFollowUps} />
                )}
            </section>
        </div>
    )
}

function FollowUpList({ items, overdue = false }: { items: FollowUpRow[]; overdue?: boolean }) {
    return (
        <ul className="divide-y divide-ash-100">
            {items.map(f => (
                <li key={f.leadId + f.followUpNumber} className="px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-ash-50/60">
                    <div className={`font-mono text-xs font-bold w-[112px] shrink-0 ${overdue ? 'text-rose-700' : 'text-ash-900'}`}>
                        {formatDateTimeIT(f.followUpDate)}
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                        FU #{f.followUpNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ash-900 truncate">{f.leadName}</div>
                        <div className="text-[11px] text-ash-500 flex items-center gap-2 flex-wrap">
                            {f.funnel && <span className="uppercase">{f.funnel}</span>}
                            {f.leadPhone && <span className="font-mono flex items-center gap-0.5"><Phone className="h-3 w-3" />{f.leadPhone}</span>}
                            {f.salespersonOutcomeNotes && <span className="italic truncate max-w-[240px]" title={f.salespersonOutcomeNotes}>— {f.salespersonOutcomeNotes}</span>}
                        </div>
                    </div>
                    <div className="text-xs font-semibold text-ash-700 shrink-0">{f.venditoreName}</div>
                </li>
            ))}
        </ul>
    )
}
