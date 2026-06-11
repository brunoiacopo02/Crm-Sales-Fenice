"use client"

/**
 * Striscia "Parametri Manager" sotto lo Stato Alert su /panoramica-generale:
 * - 4 parametri con target espliciti (10 app/gg/GDO, 15% conferme, fatturato
 *   settimanale mensile/4 + stretch +15%, costo/contratto <= 760€)
 * - lead nuovi arrivati oggi (totale + funnel)
 * - scorte lead lavorabili per GDO (chi sta finendo i lead) + pool non assegnati
 * - GDO sotto target della settimana (segnalazione underperformer)
 */

import { useState, useEffect, useTransition } from "react"
import { Target, TrendingDown, Inbox, PackageOpen, Loader2 } from "lucide-react"
import { getManagerOverview, type ManagerOverviewResult, type ManagerParamCard } from "@/app/actions/managerOverviewActions"

function fmtValue(card: ManagerParamCard, v: number | null): string {
    if (v === null || !isFinite(v)) return '—'
    switch (card.unit) {
        case 'eur':
            return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v)
        case 'pct':
            return `${Math.round(v * 100)}%`
        default:
            return v.toLocaleString("it-IT", { maximumFractionDigits: 1 })
    }
}

export function ManagerParamsStrip() {
    const [data, setData] = useState<ManagerOverviewResult | null>(null)
    const [, startTransition] = useTransition()

    const load = async () => {
        try {
            setData(await getManagerOverview())
        } catch {
            setData({ success: false, error: 'Errore caricamento' })
        }
    }

    useEffect(() => {
        load()
        const handler = () => startTransition(() => { load() })
        window.addEventListener("realtime_update", handler)
        return () => window.removeEventListener("realtime_update", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (!data) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm text-ash-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Caricamento parametri manager…
                </div>
            </div>
        )
    }
    if (!data.success) return null

    const lowStock = data.stock.perGdo.filter(g => g.stock < 20)

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                    <Target className="h-3.5 w-3.5 text-brand-orange" /> Parametri Manager
                </h2>
                <div className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                    <Inbox className="h-3.5 w-3.5" />
                    Lead nuovi oggi: {data.newLeadsToday.total}
                    {data.newLeadsToday.byFunnel.length > 0 && (
                        <span className="font-normal text-sky-600">
                            ({data.newLeadsToday.byFunnel.map(f => `${f.funnel} ${f.count}`).join(' · ')})
                        </span>
                    )}
                </div>
            </div>

            {/* Card parametri */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {data.params.map((p) => (
                    <div
                        key={p.key}
                        className={`rounded-lg border px-3 py-2 ${p.ok === false ? 'border-red-200 bg-red-50/60' : p.ok === true ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50/50'}`}
                    >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-ash-500">{p.label}</div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                            <span className={`text-lg font-bold ${p.ok === false ? 'text-red-600' : p.ok === true ? 'text-emerald-600' : 'text-ash-700'}`}>
                                {fmtValue(p, p.actual)}
                            </span>
                            <span className="text-[11px] text-ash-400">
                                / {p.higherIsBetter ? '≥' : '≤'} {fmtValue(p, p.target)}
                                {p.stretchTarget ? ` (top: ${fmtValue(p, p.stretchTarget)})` : ''}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                {/* Scorte lead per GDO */}
                <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ash-600">
                            <PackageOpen className="h-3.5 w-3.5" /> Scorte lead lavorabili
                        </div>
                        <div className="text-[11px] text-ash-500">
                            Non assegnati: <span className="font-bold text-ash-800">{data.stock.unassigned}</span>
                        </div>
                    </div>
                    {data.stock.perGdo.length === 0 ? (
                        <div className="text-xs text-ash-400">Nessun GDO attivo.</div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {data.stock.perGdo.map(g => (
                                <div
                                    key={g.gdoId}
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${g.stock < 20 ? 'border-red-200 bg-red-50 text-red-700' : g.stock < 50 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-ash-600'}`}
                                    title={`${g.name}: ${g.stock} lead ancora lavorabili (1ª-3ª chiamata)`}
                                >
                                    {g.name}: <span className="font-bold">{g.stock}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {lowStock.length > 0 && (
                        <div className="mt-2 text-[11px] font-semibold text-red-600">
                            ⚠️ Da rifornire: {lowStock.map(g => g.name).join(', ')}
                        </div>
                    )}
                </div>

                {/* Underperformer settimana */}
                <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ash-600">
                        <TrendingDown className="h-3.5 w-3.5" /> GDO sotto target (settimana)
                    </div>
                    {data.underperformers.length === 0 ? (
                        <div className="text-xs text-emerald-600 font-medium">✓ Nessun GDO sotto il 50% del target app/giorno.</div>
                    ) : (
                        <div className="space-y-1">
                            {data.underperformers.map(u => (
                                <div key={u.gdoId} className="flex items-center justify-between rounded-md bg-red-50 px-2 py-1 text-xs">
                                    <span className="font-semibold text-red-700">{u.name}</span>
                                    <span className="text-red-600">
                                        {u.appWeekAvg !== null ? u.appWeekAvg.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'} app/gg
                                        <span className="text-red-400"> · oggi {u.appToday}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
