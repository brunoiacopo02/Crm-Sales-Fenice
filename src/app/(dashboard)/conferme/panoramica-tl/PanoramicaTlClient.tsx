"use client"

import { useState, useTransition } from "react"
import {
    Target, Users, Handshake, Trophy, Euro, CalendarCheck, Calendar,
    Filter, Clock, TrendingUp, TrendingDown, Minus, XCircle,
} from "lucide-react"
import { getConfermeTlOverview, type ConfermeTlOverview, type TlFunnelRow } from "@/app/actions/confermeKpiActions"

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** Ultimi n mesi ('YYYY-MM'), dal più recente. */
function lastNMonths(currentYm: string, n: number): string[] {
    const [y, m] = currentYm.split('-').map(Number)
    const out: string[] = []
    let yy = y, mm = m
    for (let i = 0; i < n; i++) {
        out.push(`${yy}-${String(mm).padStart(2, '0')}`)
        mm--
        if (mm === 0) { mm = 12; yy-- }
    }
    return out
}

function monthLabel(ym: string): string {
    const [y, m] = ym.split('-')
    return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`
}

function fmtPct(v: number | null, decimals = 0): string {
    if (v === null || !isFinite(v)) return "—"
    return `${(v * 100).toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`
}

function fmtEur(v: number, decimals = 0): string {
    return new Intl.NumberFormat("it-IT", {
        style: "currency", currency: "EUR",
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(v)
}

function fmtNum(v: number): string {
    return v.toLocaleString("it-IT")
}

/** "BLACK SUMMER" → "Black Summer" */
function prettyFunnel(f: string): string {
    return f.toLowerCase().replace(/(^|\s|-)([a-z0-9])/g, (_, sep, ch) => sep + ch.toUpperCase())
}

/** Badge delta in punti percentuali vs mese precedente. */
function DeltaPp({ value }: { value: number | null }) {
    if (value === null || !isFinite(value)) return null
    const pp = value * 100
    if (Math.abs(pp) < 0.05) {
        return (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-ash-400">
                <Minus className="h-3 w-3" /> stabile
            </span>
        )
    }
    const up = pp > 0
    return (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? "+" : ""}{pp.toLocaleString("it-IT", { maximumFractionDigits: 1 })} pp
        </span>
    )
}

export function PanoramicaTlClient({
    initialData,
    currentYearMonth,
}: {
    initialData: ConfermeTlOverview
    currentYearMonth: string
}) {
    const [data, setData] = useState<ConfermeTlOverview>(initialData)
    const [selectedMonth, setSelectedMonth] = useState(currentYearMonth)
    const [isPending, startTransition] = useTransition()
    const months = lastNMonths(currentYearMonth, 12)

    function changeMonth(ym: string) {
        setSelectedMonth(ym)
        startTransition(async () => {
            const fresh = await getConfermeTlOverview(ym)
            setData(fresh)
        })
    }

    const monthSelector = (
        <div className="flex items-center gap-2 rounded-lg border border-ash-200 bg-white px-3 py-2 shadow-sm">
            <Calendar className="h-4 w-4 text-brand-orange" />
            <label htmlFor="tl-month" className="text-xs font-semibold uppercase tracking-wider text-ash-500">
                Periodo
            </label>
            <select
                id="tl-month"
                value={selectedMonth}
                onChange={(e) => changeMonth(e.target.value)}
                disabled={isPending}
                className="cursor-pointer bg-transparent text-sm font-bold text-ash-800 outline-none disabled:opacity-50"
            >
                {months.map((ym) => (
                    <option key={ym} value={ym}>
                        {monthLabel(ym)}{ym === currentYearMonth ? ' (in corso)' : ''}
                    </option>
                ))}
            </select>
        </div>
    )

    if (!data.success) {
        return (
            <div className="space-y-4">
                {monthSelector}
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                    Errore caricamento panoramica: {data.error}
                </div>
            </div>
        )
    }

    const { month, deltaVsPrev, perFunnel, totals, discardReasons, scartiTotali, leadTime, weekly, perOperator } = data

    const kpis = [
        {
            key: "pctConferme", label: "% Conferme", value: fmtPct(month.pctConferme, 1),
            sub: `${fmtNum(month.confermati)} confermati su ${fmtNum(month.fissati)} fissati`,
            icon: Target, delta: deltaVsPrev.pctConferme,
        },
        {
            key: "pctPresenze", label: "% Presenze", value: fmtPct(month.pctPresenze, 1),
            sub: `${fmtNum(month.presentati)} presenziati su ${fmtNum(month.confermati)} confermati`,
            icon: Users, delta: deltaVsPrev.pctPresenze,
        },
        {
            key: "pctChiusure", label: "% Chiusure", value: fmtPct(month.pctChiusure, 1),
            sub: `${fmtNum(month.chiusure)} chiusure su ${fmtNum(month.presentati)} presenziati`,
            icon: Handshake, delta: deltaVsPrev.pctChiusure,
        },
        {
            key: "chiusureMese", label: "Chiusure mese", value: fmtNum(month.chiusure),
            sub: data.isCurrentMonth
                ? `settimana in corso: ${fmtNum(data.week.chiusure)}`
                : `mese precedente: ${deltaVsPrev.chiusure >= 0 ? '+' : ''}${fmtNum(deltaVsPrev.chiusure)}`,
            icon: Trophy, delta: null,
        },
        {
            key: "fatturato", label: "Fatturato mese", value: fmtEur(month.fatturatoEur),
            sub: data.isCurrentMonth
                ? `settimana in corso: ${fmtEur(data.week.fatturatoEur)}`
                : `vs mese prec.: ${deltaVsPrev.fatturatoEur >= 0 ? '+' : ''}${fmtEur(deltaVsPrev.fatturatoEur)}`,
            icon: Euro, delta: null,
        },
    ]

    /** Colora Fissato→Chiuso rispetto alla media del mese. */
    function yieldClass(row: TlFunnelRow): string {
        if (row.pctFissatoChiuso === null || totals.pctFissatoChiuso === null) return "text-ash-500"
        if (row.pctFissatoChiuso >= totals.pctFissatoChiuso) return "text-emerald-600"
        if (row.pctFissatoChiuso < totals.pctFissatoChiuso * 0.5) return "text-rose-600"
        return "text-amber-600"
    }

    return (
        <div className={`space-y-6 ${isPending ? "pointer-events-none opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Panoramica TL Conferme</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Metriche canoniche (stesso calcolo di Marketing Analytics e KPI GDO): ogni voce è
                        contata nel mese in cui è avvenuta l&apos;azione. Azienda attiva: quella selezionata in alto.
                    </p>
                </div>
                {monthSelector}
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {kpis.map(k => (
                    <div key={k.key} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                            <k.icon className="h-3.5 w-3.5 text-brand-orange" /> {k.label}
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-ash-800">{k.value}</span>
                            <DeltaPp value={k.delta} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-ash-400">{k.sub}</div>
                    </div>
                ))}
            </div>

            {/* Funnel breakdown */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                    <Filter className="h-3.5 w-3.5 text-brand-orange" /> Rendimento per funnel
                </div>
                <p className="mb-3 text-[11px] text-ash-400">
                    &ldquo;Fissato→Chiuso&rdquo; e &ldquo;€/fissato&rdquo; sono le colonne confrontabili: dicono quanto vale
                    un appuntamento di quel funnel, al netto dei volumi.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                <th className="py-2 pr-4">Funnel</th>
                                <th className="py-2 pr-3 text-right">Fissati</th>
                                <th className="py-2 pr-3 text-right">Conf.</th>
                                <th className="py-2 pr-3 text-right">%Conf</th>
                                <th className="py-2 pr-3 text-right">Pres.</th>
                                <th className="py-2 pr-3 text-right">%Pres</th>
                                <th className="py-2 pr-3 text-right">Chiusi</th>
                                <th className="py-2 pr-3 text-right">%Chius</th>
                                <th className="py-2 pr-3 text-right">Fiss.→Chiuso</th>
                                <th className="py-2 pr-3 text-right">Fatturato</th>
                                <th className="py-2 text-right">€/fissato</th>
                            </tr>
                        </thead>
                        <tbody>
                            {perFunnel.map(row => (
                                <tr key={row.funnel} className="border-b border-gray-100">
                                    <td className="py-2 pr-4 font-medium text-ash-800">{prettyFunnel(row.funnel)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(row.fissati)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(row.confermati)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(row.pctConf, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(row.presenziati)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(row.pctPres, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(row.chiusi)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(row.pctChius, 1)}</td>
                                    <td className={`py-2 pr-3 text-right font-bold ${yieldClass(row)}`}>{fmtPct(row.pctFissatoChiuso, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtEur(row.fatturatoEur)}</td>
                                    <td className="py-2 text-right font-semibold text-ash-800">
                                        {row.eurPerFissato === null ? "—" : fmtEur(row.eurPerFissato)}
                                    </td>
                                </tr>
                            ))}
                            {perFunnel.length > 0 && (
                                <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                                    <td className="py-2 pr-4 text-ash-800">TOTALE</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtNum(totals.fissati)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtNum(totals.confermati)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtPct(totals.pctConf, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtNum(totals.presenziati)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtPct(totals.pctPres, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtNum(totals.chiusi)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtPct(totals.pctChius, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtPct(totals.pctFissatoChiuso, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-800">{fmtEur(totals.fatturatoEur)}</td>
                                    <td className="py-2 text-right text-ash-800">
                                        {totals.eurPerFissato === null ? "—" : fmtEur(totals.eurPerFissato)}
                                    </td>
                                </tr>
                            )}
                            {perFunnel.length === 0 && (
                                <tr>
                                    <td colSpan={11} className="py-4 text-center text-xs text-ash-400">
                                        Nessun dato per il mese selezionato.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* Motivi di scarto */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                        <XCircle className="h-3.5 w-3.5 text-brand-orange" /> Motivi di scarto
                    </div>
                    <p className="mb-3 text-[11px] text-ash-400">
                        {fmtNum(scartiTotali)} scarti registrati nel mese. Distingue il problema di
                        raggiungibilità (NR) dall&apos;obiezione commerciale.
                    </p>
                    <div className="space-y-2">
                        {discardReasons.map(r => (
                            <div key={r.reason}>
                                <div className="flex items-baseline justify-between text-xs">
                                    <span className="font-medium capitalize text-ash-700">{r.reason}</span>
                                    <span className="text-ash-500">
                                        <span className="font-semibold text-ash-800">{fmtNum(r.count)}</span> · {fmtPct(r.pct, 1)}
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                                    <div
                                        className="h-full rounded-full bg-brand-orange"
                                        style={{ width: `${Math.max(2, r.pct * 100)}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {discardReasons.length === 0 && (
                            <div className="py-4 text-center text-xs text-ash-400">Nessuno scarto nel mese.</div>
                        )}
                    </div>
                </div>

                {/* Lead time */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                        <Clock className="h-3.5 w-3.5 text-brand-orange" /> Distanza fissaggio → appuntamento
                    </div>
                    <p className="mb-3 text-[11px] text-ash-400">
                        Coorte degli appuntamenti fissati nel mese, seguita fino a conferma e presenza
                        (unico blocco per-appuntamento). Più l&apos;appuntamento è lontano, più è difficile confermarlo.
                    </p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                <th className="py-2 pr-4">Distanza</th>
                                <th className="py-2 pr-3 text-right">Fissati</th>
                                <th className="py-2 pr-3 text-right">%Conf</th>
                                <th className="py-2 text-right">%Pres</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leadTime.map(b => (
                                <tr key={b.bucket} className="border-b border-gray-100 last:border-0">
                                    <td className="py-2 pr-4 font-medium text-ash-800">{b.bucket}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(b.fissati)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(b.pctConf, 1)}</td>
                                    <td className="py-2 text-right text-ash-600">{fmtPct(b.pctPres, 1)}</td>
                                </tr>
                            ))}
                            {leadTime.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="py-4 text-center text-xs text-ash-400">
                                        Nessun appuntamento fissato nel mese.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Trend settimanale */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                    <TrendingUp className="h-3.5 w-3.5 text-brand-orange" /> Trend settimanale
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                <th className="py-2 pr-4">Settimana</th>
                                <th className="py-2 pr-3 text-right">Fissati</th>
                                <th className="py-2 pr-3 text-right">%Conf</th>
                                <th className="py-2 pr-3 text-right">%Pres</th>
                                <th className="py-2 pr-3 text-right">%Chius</th>
                                <th className="py-2 text-right">Chiusi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {weekly.map(w => (
                                <tr key={w.label} className={`border-b border-gray-100 last:border-0 ${w.isCurrent ? "bg-orange-50/60" : ""}`}>
                                    <td className="py-2 pr-4">
                                        <span className="font-medium text-ash-800">{w.label}</span>
                                        <span className="ml-2 text-[11px] text-ash-400">{w.range}</span>
                                        {w.isCurrent && (
                                            <span className="ml-2 rounded bg-brand-orange/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-orange">
                                                in corso
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(w.fissati)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(w.pctConf, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtPct(w.pctPres, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtPct(w.pctChius, 1)}</td>
                                    <td className="py-2 text-right font-semibold text-ash-800">{fmtNum(w.chiusi)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Operatori */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                    <CalendarCheck className="h-3.5 w-3.5 text-brand-orange" /> Operatori
                </div>
                <p className="mb-3 text-[11px] text-ash-400">
                    Presenze e chiusure sono attribuite all&apos;operatore che ha confermato il lead:
                    distinguono chi conferma tanto da chi conferma bene.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                <th className="py-2 pr-4">Operatore</th>
                                <th className="py-2 pr-3 text-right">Confermati</th>
                                <th className="py-2 pr-3 text-right">Scartati</th>
                                <th className="py-2 pr-3 text-right">Presenziati</th>
                                <th className="py-2 pr-3 text-right">%Pres</th>
                                <th className="py-2 pr-3 text-right">Chiusure</th>
                                <th className="py-2 pr-3 text-right">%Chius</th>
                                <th className="py-2 pr-3 text-right">Fatturato</th>
                                <th className="py-2 text-right">€/conferma</th>
                            </tr>
                        </thead>
                        <tbody>
                            {perOperator.map(op => (
                                <tr key={op.userId} className="border-b border-gray-100 last:border-0">
                                    <td className="py-2 pr-4 font-medium text-ash-800">{op.name}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-emerald-600">{fmtNum(op.confermati)}</td>
                                    <td className="py-2 pr-3 text-right text-rose-600">{fmtNum(op.scartati)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(op.presenziati)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(op.pctPresenze, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtNum(op.chiusure)}</td>
                                    <td className="py-2 pr-3 text-right font-semibold text-ash-800">{fmtPct(op.pctChiusure, 1)}</td>
                                    <td className="py-2 pr-3 text-right text-ash-600">{fmtEur(op.fatturatoEur)}</td>
                                    <td className="py-2 text-right font-semibold text-ash-800">
                                        {op.eurPerConferma === null ? "—" : fmtEur(op.eurPerConferma)}
                                    </td>
                                </tr>
                            ))}
                            {perOperator.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="py-4 text-center text-xs text-ash-400">Nessun operatore Conferme attivo.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
