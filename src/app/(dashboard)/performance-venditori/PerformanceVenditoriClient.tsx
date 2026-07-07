"use client"

import { useEffect, useState } from "react"
import { getVenditorePerformance, type VenditorePerformanceData } from "@/app/actions/venditorePerformanceActions"
import { VenditorePerformanceView } from "@/components/venditore-performance/VenditorePerformanceView"
import { SalesWeeklyFocusEditor } from "@/components/venditore-performance/SalesWeeklyFocusEditor"
import { VenditoriRisposteTab } from "@/components/venditore-performance/VenditoriRisposteTab"

interface Props {
    venditori: { id: string; name: string }[]
    initialYearMonth: string
    weekStart: string
    readOnly: boolean
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${active ? "border-brand-orange text-brand-orange" : "border-transparent text-ash-500 hover:text-ash-700"}`}
        >
            {children}
        </button>
    )
}

export function PerformanceVenditoriClient({ venditori, initialYearMonth, weekStart, readOnly }: Props) {
    const [tab, setTab] = useState<'performance' | 'risposte'>('performance')
    const [sel, setSel] = useState<string>(venditori[0]?.id ?? "")
    const [ym, setYm] = useState<string>(initialYearMonth)
    const [data, setData] = useState<VenditorePerformanceData | null>(null)

    useEffect(() => {
        if (!sel) return
        let alive = true
        setData(null)
        getVenditorePerformance({ salesUserId: sel, yearMonth: ym }).then(d => { if (alive) setData(d) })
        return () => { alive = false }
    }, [sel, ym])

    if (venditori.length === 0) {
        return <div className="text-center text-gray-400 py-12">Nessun venditore disponibile.</div>
    }

    return (
        <div className="space-y-5">
            <div className="flex border-b border-ash-100">
                <TabBtn active={tab === 'performance'} onClick={() => setTab('performance')}>Performance</TabBtn>
                <TabBtn active={tab === 'risposte'} onClick={() => setTab('risposte')}>Risposte</TabBtn>
            </div>

            {tab === 'performance' && (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Venditore</label>
                            <select value={sel} onChange={e => setSel(e.target.value)} className="input-fenice text-sm w-auto">
                                {venditori.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Mese</label>
                            <select value={ym} onChange={e => setYm(e.target.value)} className="input-fenice text-sm w-auto">
                                {Array.from({ length: 12 }).map((_, i) => {
                                    const now = new Date()
                                    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
                                    const m = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
                                    return <option key={m} value={m}>{m}</option>
                                })}
                            </select>
                        </div>
                    </div>

                    {sel && (
                        <SalesWeeklyFocusEditor
                            salesUserId={sel}
                            weekStart={weekStart}
                            suggestedObjection={data?.topReason?.reason ?? null}
                            readOnly={readOnly}
                        />
                    )}

                    {data ? <VenditorePerformanceView data={data} /> : <div className="text-center text-gray-400 py-12">Caricamento…</div>}
                </div>
            )}

            {tab === 'risposte' && (
                <VenditoriRisposteTab venditori={venditori} initialYearMonth={initialYearMonth} />
            )}
        </div>
    )
}
