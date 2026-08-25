"use client"

import { useState, useEffect, useCallback } from "react"
import { getApptQuality, type ApptQualityRow } from "@/app/actions/productivityActions"
import { Target, RefreshCw } from "lucide-react"

function monthBounds(offset: number): { from: string; to: string; label: string } {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return {
        from: fmt(d), to: fmt(last),
        label: d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
    }
}

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function ApptQualityTab() {
    const [offset, setOffset] = useState(0)
    const [rows, setRows] = useState<ApptQualityRow[] | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const period = monthBounds(offset)

    const fetchData = useCallback(async () => {
        setIsLoading(true)
        try {
            setRows(await getApptQuality(period.from, period.to))
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }, [period.from, period.to])

    useEffect(() => { fetchData() }, [fetchData])

    if (isLoading && !rows) return <div className="p-8 text-center text-ash-500">Carico gli appuntamenti...</div>
    if (!rows || !rows.length) return <div className="p-8 text-center text-ash-500">Nessun appuntamento per {period.label}.</div>

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button onClick={() => setOffset(offset - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">←</button>
                    <div className="text-sm font-semibold text-ash-700 capitalize min-w-40 text-center">{period.label}</div>
                    <button onClick={() => setOffset(Math.min(0, offset + 1))} disabled={offset >= 0}
                        className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50 disabled:opacity-40">→</button>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">
                    <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
                </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Gli appuntamenti fissati a fine mese si presentano e si chiudono nel mese successivo:
                presenze, chiusure e fatturato del mese in corso sono <strong>sempre parziali</strong>.
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-semibold">GDO</th>
                            <th className="text-right px-4 py-3 font-semibold">Fissati</th>
                            <th className="text-right px-4 py-3 font-semibold">Presenziati</th>
                            <th className="text-right px-4 py-3 font-semibold">Chiusi</th>
                            <th className="text-right px-4 py-3 font-semibold">Fatturato</th>
                            <th className="text-right px-4 py-3 font-semibold">€ per appuntamento</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.userId} className="border-t border-ash-100">
                                <td className="px-4 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{r.app}</td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                    {r.presenziati} <span className="text-ash-400">({r.presenzaPct}%)</span>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                    {r.chiusi} <span className="text-ash-400">({r.chiusuraPct}%)</span>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{eur(r.fatturato)}</td>
                                <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{eur(r.euroPerApp)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-2 text-xs text-ash-400">
                <Target className="w-3 h-3" />
                Ordinati per euro prodotti da ogni appuntamento fissato.
            </div>
        </div>
    )
}
