"use client"

/**
 * Striscia "STATO ALERT — MESE CORRENTE" in cima a /panoramica-generale.
 * Card per metrica: scostamento % vs target proporzionale MTD + giorni
 * consecutivi sotto soglia + badge ALERT / PRE-ALERT / OK / NO TARGET.
 * Stesso pattern visivo del CRM marketing (pagina /marketing/alert).
 */

import { useState, useEffect, useTransition } from "react"
import { AlertTriangle, CheckCircle2, MinusCircle, Loader2, RefreshCw } from "lucide-react"
import { getSalesAlerts, type SalesAlertsResult, type SalesAlertCard } from "@/app/actions/salesAlertsActions"

function formatValue(card: SalesAlertCard): string {
    switch (card.unit) {
        case 'eur':
            return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(card.actualToday)
        case 'ratio':
        case 'avg':
            return card.actualToday.toLocaleString("it-IT", { maximumFractionDigits: 2 })
        default:
            return Math.round(card.actualToday).toLocaleString("it-IT")
    }
}

function formatTarget(card: SalesAlertCard): string {
    switch (card.unit) {
        case 'eur':
            return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(card.targetToday)
        case 'ratio':
        case 'avg':
            return card.targetToday.toLocaleString("it-IT", { maximumFractionDigits: 2 })
        default:
            return card.targetToday.toLocaleString("it-IT", { maximumFractionDigits: 1 })
    }
}

function formatDeviation(dev: number | null): string {
    if (dev === null || !isFinite(dev)) return '—'
    const pct = dev * 100
    return `${pct > 0 ? '+' : ''}${pct.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
}

function AlertBadge({ status }: { status: SalesAlertCard['status'] }) {
    if (status === 'alert') {
        return (
            <div className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                <AlertTriangle className="h-3 w-3" /> ALERT
            </div>
        )
    }
    if (status === 'pre-alert') {
        return (
            <div className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                <AlertTriangle className="h-3 w-3" /> PRE-ALERT
            </div>
        )
    }
    if (status === 'no-target') {
        return (
            <div className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                <MinusCircle className="h-3 w-3" /> NO TARGET
            </div>
        )
    }
    return (
        <div className="flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> OK
        </div>
    )
}

function AlertCard({ card }: { card: SalesAlertCard }) {
    const noTarget = card.status === 'no-target'
    const devClass =
        noTarget ? 'text-gray-400'
            : card.deviationToday !== null && card.deviationToday < card.threshold ? 'text-red-600'
                : 'text-emerald-600'
    const tooltip = noTarget
        ? 'Nessun target impostato per questo mese'
        : `ACT ${formatValue(card)} vs target ${formatTarget(card)} (soglia ${Math.round(card.threshold * 100)}%)`

    return (
        <div
            className="flex min-w-[200px] flex-1 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5"
            title={tooltip}
        >
            <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-ash-500">{card.label}</div>
                <div className="text-sm font-medium text-ash-800">
                    <span className="text-ash-500">scost.</span>{' '}
                    <span className={devClass}>{noTarget ? '—' : formatDeviation(card.deviationToday)}</span>
                    {!noTarget && (
                        <>
                            {' '}<span className="text-ash-300">·</span>{' '}
                            <span className={card.consecutiveDaysBelow > 0 ? 'text-red-600 font-semibold' : 'text-ash-500'}>
                                {card.consecutiveDaysBelow}gg
                            </span>
                        </>
                    )}
                </div>
            </div>
            <AlertBadge status={card.status} />
        </div>
    )
}

export function SalesAlertStrip() {
    const [data, setData] = useState<SalesAlertsResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [, startTransition] = useTransition()

    const load = async () => {
        try {
            const res = await getSalesAlerts()
            setData(res)
        } catch {
            setData({ success: false, error: 'Errore caricamento alert' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        const handler = () => startTransition(() => { load() })
        window.addEventListener("realtime_update", handler)
        return () => window.removeEventListener("realtime_update", handler)
    }, [])

    if (loading) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm text-ash-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Caricamento stato alert…
                </div>
            </div>
        )
    }

    if (!data) return null

    if (!data.success) {
        return (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <div>Stato alert non disponibile: {data.error}</div>
                <button
                    onClick={() => { setLoading(true); load() }}
                    className="flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                    <RefreshCw className="h-3 w-3" /> Riprova
                </button>
            </div>
        )
    }

    const multi = data.groups.length > 1

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wide text-ash-700">
                    Stato Alert — Mese Corrente
                </h2>
                <div className="text-[11px] text-ash-400">
                    Sotto {Math.round(data.thresholds.metric * 100)}% per ≥ {data.thresholds.consecutiveDays}gg = ALERT · soglia ROAS {Math.round(data.thresholds.roas * 100)}% · giorno {data.daysSoFar}/{data.totalDays}
                </div>
            </div>
            <div className="space-y-3">
                {data.groups.map((g) => (
                    <div key={g.companyId}>
                        {multi && (
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                {g.companyLabel}
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {g.cards.map((card) => (
                                <AlertCard key={card.key} card={card} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
