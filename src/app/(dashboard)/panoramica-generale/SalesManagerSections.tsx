"use client"

import { useState, useEffect, useTransition } from "react"
import Link from "next/link"
import { Briefcase, TrendingUp, Calendar, ExternalLink, RefreshCw, Loader2, AlertTriangle } from "lucide-react"
import { getVenditoriKpi } from "@/app/actions/kpiVenditoriActions"
import { getMarketingStats } from "@/app/actions/marketingActions"
import { getVenditoriMonitor, type VenditoriMonitorData } from "@/app/actions/venditoriMonitorActions"

type VenditoriKpiRow = Awaited<ReturnType<typeof getVenditoriKpi>>[number]
type MarketingRow = Awaited<ReturnType<typeof getMarketingStats>>[number]

function formatEur(n: number): string {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
}

function formatPercent(n: number): string {
    if (!isFinite(n)) return '—'
    return `${Math.round(n)}%`
}

export function SalesManagerSections() {
    const [vendKpi, setVendKpi] = useState<VenditoriKpiRow[] | null>(null)
    const [marketing, setMarketing] = useState<MarketingRow[] | null>(null)
    const [monitor, setMonitor] = useState<VenditoriMonitorData | null>(null)
    const [loading, setLoading] = useState(true)
    const [, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const today = new Date()
            const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`

            // Range follow-up/appuntamenti: oggi → +14 giorni (vista prossima)
            const start = new Date(today); start.setHours(0, 0, 0, 0)
            const end = new Date(start); end.setDate(end.getDate() + 14); end.setHours(23, 59, 59, 999)

            const [v, m, mon] = await Promise.all([
                getVenditoriKpi("mese"),
                getMarketingStats(monthStr),
                getVenditoriMonitor({ startDate: start, endDate: end, venditoreIds: [] }),
            ])
            setVendKpi(v)
            setMarketing(m)
            setMonitor(mon)
        } catch (e: any) {
            setError(e?.message || "Errore caricamento")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // Realtime auto-refresh — stesso pattern di KpiGdoBoard
        const handler = () => startTransition(() => { load() })
        window.addEventListener("realtime_update", handler)
        return () => window.removeEventListener("realtime_update", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Aggregati ROAS globali calcolati lato client da getMarketingStats
    const roasTotals = marketing
        ? marketing.reduce(
            (acc, r) => {
                acc.fatturato += r.fatturato || 0
                acc.spent += r.spentAmountEur || 0
                acc.leads += r.leads || 0
                acc.close += r.close || 0
                return acc
            },
            { fatturato: 0, spent: 0, leads: 0, close: 0 },
        )
        : null
    const roasGlobal = roasTotals && roasTotals.spent > 0 ? (roasTotals.fatturato / roasTotals.spent) * 100 : 0

    return (
        <div className="space-y-6 mt-2">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-ash-800 flex items-center gap-2">
                    <Briefcase className="w-5 h-5 text-brand-orange" /> Panoramica Sales
                </h2>
                <button
                    onClick={() => load()}
                    disabled={loading}
                    className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2.5 py-1 text-xs font-semibold text-ash-700 hover:bg-ash-50 disabled:opacity-50"
                    title="Aggiorna sezione Sales"
                >
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Aggiorna
                </button>
            </div>

            {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* === ROAS RIASSUNTO === */}
            <section className="rounded-2xl border border-ash-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-ash-900 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" /> ROAS — riassunto del mese
                    </h3>
                    <Link href="/marketing-analytics" className="text-xs font-semibold text-brand-orange hover:underline flex items-center gap-1">
                        Apri Marketing Analytics <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>

                {loading && !marketing ? (
                    <SkeletonRow rows={3} />
                ) : !roasTotals ? (
                    <div className="text-sm text-ash-400">Nessun dato</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            <KpiTile label="ROAS globale" value={formatPercent(roasGlobal)} accent={roasGlobal >= 100 ? "emerald" : "rose"} />
                            <KpiTile label="Fatturato" value={formatEur(roasTotals.fatturato)} accent="emerald" />
                            <KpiTile label="Spesa pubb." value={formatEur(roasTotals.spent)} accent="rose" />
                            <KpiTile label="Lead totali" value={String(roasTotals.leads)} accent="ash" />
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-ash-200 text-[11px] uppercase text-ash-500">
                                        <th className="text-left py-2 font-semibold">Funnel</th>
                                        <th className="text-right py-2 font-semibold">Lead</th>
                                        <th className="text-right py-2 font-semibold">App</th>
                                        <th className="text-right py-2 font-semibold">Close</th>
                                        <th className="text-right py-2 font-semibold">Fatturato</th>
                                        <th className="text-right py-2 font-semibold">Spesa</th>
                                        <th className="text-right py-2 font-semibold text-brand-orange">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {marketing!
                                        .filter(r => r.leads > 0 || r.spentAmountEur > 0)
                                        .map(r => (
                                            <tr key={r.funnel} className="border-b border-ash-100 last:border-0 hover:bg-ash-50/40">
                                                <td className="py-1.5 font-medium text-ash-800 uppercase tracking-tight">{r.funnel}</td>
                                                <td className="text-right py-1.5">{r.leads}</td>
                                                <td className="text-right py-1.5">{r.apps}</td>
                                                <td className="text-right py-1.5 font-bold">{r.close}</td>
                                                <td className="text-right py-1.5">{formatEur(r.fatturato)}</td>
                                                <td className="text-right py-1.5 text-rose-600">{formatEur(r.spentAmountEur)}</td>
                                                <td className={`text-right py-1.5 font-bold ${r.roas >= 100 ? "text-emerald-600" : r.roas > 0 ? "text-amber-600" : "text-ash-400"}`}>
                                                    {r.spentAmountEur > 0 ? formatPercent(r.roas) : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>

            {/* === PERFORMANCE VENDITORI === */}
            <section className="rounded-2xl border border-ash-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-ash-900 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-blue-600" /> Performance Venditori — mese in corso
                    </h3>
                    <Link href="/kpi-venditori" className="text-xs font-semibold text-brand-orange hover:underline flex items-center gap-1">
                        Apri KPI Venditori <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>

                {loading && !vendKpi ? (
                    <SkeletonRow rows={4} />
                ) : !vendKpi || vendKpi.length === 0 ? (
                    <div className="text-sm text-ash-400">Nessun venditore attivo</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ash-200 text-[11px] uppercase text-ash-500">
                                    <th className="text-left py-2 font-semibold">#</th>
                                    <th className="text-left py-2 font-semibold">Venditore</th>
                                    <th className="text-right py-2 font-semibold">Chiusi</th>
                                    <th className="text-right py-2 font-semibold">Non chiusi</th>
                                    <th className="text-right py-2 font-semibold">Spariti</th>
                                    <th className="text-right py-2 font-semibold text-emerald-700">Closing Rate</th>
                                    <th className="text-right py-2 font-semibold text-emerald-700">Fatturato</th>
                                    <th className="text-right py-2 font-semibold text-ash-400">Target</th>
                                </tr>
                            </thead>
                            <tbody>
                                {vendKpi.map(v => {
                                    const target = v.salesTargetEur || 0
                                    const targetReached = target > 0 && v.fatturato >= target
                                    return (
                                        <tr key={v.id} className="border-b border-ash-100 last:border-0 hover:bg-ash-50/40">
                                            <td className="py-2 font-bold text-ash-500">{v.position}</td>
                                            <td className="py-2 font-medium text-ash-900">{v.name}</td>
                                            <td className="text-right py-2 font-bold text-emerald-700">{v.chiusi}</td>
                                            <td className="text-right py-2 text-ash-600">{v.nonChiusi}</td>
                                            <td className="text-right py-2 text-ash-400">{v.sparito}</td>
                                            <td className="text-right py-2 font-semibold text-emerald-700">{v.closingRate}%</td>
                                            <td className={`text-right py-2 font-bold ${targetReached ? "text-emerald-700" : "text-ash-800"}`}>
                                                {formatEur(v.fatturato)}
                                            </td>
                                            <td className="text-right py-2 text-ash-400">{target > 0 ? formatEur(target) : "—"}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* === FOLLOW-UP & APPUNTAMENTI VENDITORI === */}
            <section className="rounded-2xl border border-ash-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-ash-900 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-brand-orange" /> Pipeline Venditori — prossimi 14 giorni
                    </h3>
                    <Link href="/monitor-vendite" className="text-xs font-semibold text-brand-orange hover:underline flex items-center gap-1">
                        Apri Monitor Vendite <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>

                {loading && !monitor ? (
                    <SkeletonRow rows={4} />
                ) : !monitor || monitor.venditori.length === 0 ? (
                    <div className="text-sm text-ash-400">Nessun venditore attivo</div>
                ) : (
                    <>
                        {monitor.overdueFollowUps.length > 0 && (
                            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 mb-3 flex items-center gap-2 text-xs text-rose-700">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span><strong>{monitor.overdueFollowUps.length}</strong> follow-up scaduti non gestiti — apri Monitor Vendite per la lista completa</span>
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-ash-200 text-[11px] uppercase text-ash-500">
                                        <th className="text-left py-2 font-semibold">Venditore</th>
                                        <th className="text-right py-2 font-semibold">Appuntamenti</th>
                                        <th className="text-right py-2 font-semibold text-blue-600">FU prossimi</th>
                                        <th className="text-right py-2 font-semibold text-rose-600">FU scaduti</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        // Aggrego per venditore — ricalcolo come fa MonitorVenditeClient
                                        const map = new Map<string, { name: string; appts: number; upcomingFu: number; overdueFu: number }>()
                                        for (const v of monitor.venditori) map.set(v.id, { name: v.name, appts: 0, upcomingFu: 0, overdueFu: 0 })
                                        for (const a of monitor.appointments) {
                                            const s = map.get(a.venditoreId); if (s) s.appts++
                                        }
                                        for (const f of monitor.upcomingFollowUps) {
                                            const s = map.get(f.venditoreId); if (s) s.upcomingFu++
                                        }
                                        for (const f of monitor.overdueFollowUps) {
                                            const s = map.get(f.venditoreId); if (s) s.overdueFu++
                                        }
                                        const rows = Array.from(map.values()).filter(s => s.appts + s.upcomingFu + s.overdueFu > 0)
                                            .sort((a, b) => (b.appts + b.upcomingFu) - (a.appts + a.upcomingFu))
                                        if (rows.length === 0) {
                                            return (
                                                <tr><td colSpan={4} className="py-4 text-center text-sm text-ash-400">Nessun appuntamento o follow-up nel range</td></tr>
                                            )
                                        }
                                        return rows.map(r => (
                                            <tr key={r.name} className="border-b border-ash-100 last:border-0 hover:bg-ash-50/40">
                                                <td className="py-2 font-medium text-ash-900">{r.name}</td>
                                                <td className="text-right py-2">{r.appts}</td>
                                                <td className="text-right py-2 text-blue-600 font-medium">{r.upcomingFu}</td>
                                                <td className={`text-right py-2 font-bold ${r.overdueFu > 0 ? "text-rose-600" : "text-ash-400"}`}>{r.overdueFu}</td>
                                            </tr>
                                        ))
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent: "emerald" | "rose" | "ash" }) {
    const palette = {
        emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
        rose: "bg-rose-50 border-rose-200 text-rose-900",
        ash: "bg-ash-50 border-ash-200 text-ash-900",
    }[accent]
    return (
        <div className={`rounded-xl border ${palette} p-3`}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</div>
            <div className="text-xl font-black mt-0.5 truncate" title={value}>{value}</div>
        </div>
    )
}

function SkeletonRow({ rows }: { rows: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="h-8 rounded bg-ash-100/60 animate-pulse" />
            ))}
        </div>
    )
}
