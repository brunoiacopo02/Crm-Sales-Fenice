"use client"

import { useState, useEffect, useCallback } from "react"
import { getPhoneProductivity, type PhoneProductivityRow } from "@/app/actions/productivityActions"
import { Phone, RefreshCw } from "lucide-react"

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

export function PhoneProductivityTab() {
    const [offset, setOffset] = useState(0)
    const [data, setData] = useState<{ rows: PhoneProductivityRow[]; benchmarkMin: number } | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const period = monthBounds(offset)

    const fetchData = useCallback(async () => {
        setIsLoading(true)
        try {
            setData(await getPhoneProductivity(period.from, period.to))
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }, [period.from, period.to])

    useEffect(() => { fetchData() }, [fetchData])

    if (isLoading && !data) return <div className="p-8 text-center text-ash-500">Carico i tabulati...</div>
    if (!data || !data.rows.length) {
        return <div className="p-8 text-center text-ash-500">Nessun tabulato per {period.label}.</div>
    }

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

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div>
                    Il tempo fuori dalle telefonate va letto scomposto, non come totale.
                    <strong> Ritmo</strong> sono i buchi sotto i 3 minuti: compilare l'esito e passare al numero dopo,
                    tempo di lavoro che non si comprime.
                    <strong> Assenze</strong> sono i buchi oltre i 10 minuti: è questo il numero da discutere.
                </div>
                <div>Il riferimento è il migliore del gruppo: {data.benchmarkMin} min al giorno di assenze.</div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-semibold">GDO</th>
                            <th className="text-right px-4 py-3 font-semibold">Giornate</th>
                            <th className="text-right px-4 py-3 font-semibold">Chiamate/gg</th>
                            <th className="text-right px-4 py-3 font-semibold">Al telefono</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Buchi sotto i 3 minuti">Ritmo</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Buchi oltre i 10 minuti">Assenze</th>
                            <th className="text-right px-4 py-3 font-semibold">Oltre il migliore</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map(r => {
                            const excess = r.assenzeMinPerDay - data.benchmarkMin
                            return (
                                <tr key={r.userId} className="border-t border-ash-100">
                                    <td className="px-4 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                    <td className="px-4 py-3 text-right text-ash-500">{r.days}</td>
                                    <td className="px-4 py-3 text-right tabular-nums">{r.callsPerDay}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{r.talkMinPerDay} min</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-ash-500">{r.ritmoMinPerDay} min</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{r.assenzeMinPerDay} min</td>
                                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${excess > 45 ? 'text-red-600' : excess > 20 ? 'text-amber-600' : 'text-ash-400'}`}>
                                        {excess > 0 ? `+${excess} min` : '—'}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-2 text-xs text-ash-400">
                <Phone className="w-3 h-3" />
                Giornate con almeno 40 chiamate. Fonte: tabulati del centralino.
                Il tempo non telefonico totale è {Math.round(data.rows.reduce((a, r) => a + r.offPhoneMinPerDay, 0) / data.rows.length)} min al giorno in media.
            </div>
        </div>
    )
}
