"use client"

import { useEffect, useState } from "react"
import { getVenditoriRisposte, type VenditoreRispostaRow } from "@/app/actions/venditorePerformanceActions"
import { NOT_CLOSED_REASONS } from "@/lib/surveys/questions"

interface Props {
    venditori: { id: string; name: string }[]
    initialYearMonth: string
}

const OUTCOMES = ['Chiuso', 'Non chiuso', 'Perso', 'Sparito'] as const

const OUTCOME_BADGE: Record<string, string> = {
    'Chiuso': 'bg-green-100 text-green-800',
    'Non chiuso': 'bg-amber-100 text-amber-800',
    'Perso': 'bg-red-100 text-red-800',
    'Sparito': 'bg-gray-100 text-gray-600',
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
}

export function VenditoriRisposteTab({ venditori, initialYearMonth }: Props) {
    const [salesUserId, setSalesUserId] = useState<string>("")
    const [ym, setYm] = useState<string>(initialYearMonth)
    const [outcome, setOutcome] = useState<string>("")
    const [notClosedReason, setNotClosedReason] = useState<string>("")
    const [page, setPage] = useState(1)
    const [data, setData] = useState<{ rows: VenditoreRispostaRow[]; total: number; pageSize: number } | null>(null)

    // Reset pagina quando cambia un filtro.
    useEffect(() => {
        setPage(1)
    }, [salesUserId, ym, outcome, notClosedReason])

    useEffect(() => {
        let alive = true
        setData(null)
        getVenditoriRisposte({
            yearMonth: ym,
            salesUserId: salesUserId || undefined,
            outcome: outcome || undefined,
            notClosedReason: notClosedReason || undefined,
            page,
        }).then(d => { if (alive) setData(d) })
        return () => { alive = false }
    }, [salesUserId, ym, outcome, notClosedReason, page])

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Venditore</label>
                    <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)} className="input-fenice text-sm w-auto">
                        <option value="">Tutti</option>
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
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Esito</label>
                    <select value={outcome} onChange={e => setOutcome(e.target.value)} className="input-fenice text-sm w-auto">
                        <option value="">Tutti</option>
                        {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Motivo</label>
                    <select value={notClosedReason} onChange={e => setNotClosedReason(e.target.value)} className="input-fenice text-sm w-auto">
                        <option value="">Tutti</option>
                        {NOT_CLOSED_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
            </div>

            {!data ? (
                <div className="text-center text-gray-400 py-12">Caricamento…</div>
            ) : data.rows.length === 0 ? (
                <div className="text-center text-gray-400 py-12">Nessuna risposta trovata per i filtri selezionati.</div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-ash-100">
                    <table className="min-w-full text-sm">
                        <thead className="bg-ash-50 text-xs uppercase text-ash-500">
                            <tr>
                                <th className="px-3 py-2 text-left">Data</th>
                                <th className="px-3 py-2 text-left">Venditore</th>
                                <th className="px-3 py-2 text-left">Lead</th>
                                <th className="px-3 py-2 text-left">Tentativo</th>
                                <th className="px-3 py-2 text-left">Esito</th>
                                <th className="px-3 py-2 text-left">Motivo</th>
                                <th className="px-3 py-2 text-left">Prossimo FU</th>
                                <th className="px-3 py-2 text-left">Prodotto / €</th>
                                <th className="px-3 py-2 text-left">Note</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100">
                            {data.rows.map(r => (
                                <tr key={r.id} className="hover:bg-ash-50/50">
                                    <td className="px-3 py-2 whitespace-nowrap text-ash-600">{fmtDate(r.outcomeAt)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-ash-800 font-medium">{r.venditoreName ?? '—'}</td>
                                    <td className="px-3 py-2">
                                        <div className="text-ash-800">{r.leadName ?? '—'}</div>
                                        <div className="text-xs text-ash-500">{r.leadPhone ?? '—'}</div>
                                        {r.funnel && (
                                            <span className="inline-block mt-0.5 rounded-full bg-ash-100 px-2 py-0.5 text-[10px] text-ash-600">{r.funnel}</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-ash-600">
                                        {r.attemptNumber === 0 ? 'Esito app' : `FU #${r.attemptNumber}`}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME_BADGE[r.outcome] ?? 'bg-gray-100 text-gray-600'}`}>
                                            {r.outcome}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-ash-600">{r.notClosedReason ?? '—'}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-ash-600">{r.nextFollowUpDate ? fmtDate(r.nextFollowUpDate) : '—'}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-ash-600">
                                        {r.outcome === 'Chiuso'
                                            ? `${r.closeProduct ?? '—'}${r.closeAmountEur != null ? ` · ${r.closeAmountEur.toLocaleString('it-IT')}€` : ''}`
                                            : '—'}
                                    </td>
                                    <td className="px-3 py-2 max-w-[240px] truncate text-ash-600" title={r.notes ?? ''}>{r.notes ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data && (
                <div className="flex items-center justify-between text-sm text-ash-500">
                    <div>{data.total} risposte</div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="rounded-lg border border-ash-200 px-2.5 py-1 disabled:opacity-40 hover:bg-ash-50"
                        >
                            ‹
                        </button>
                        <div>{page} / {totalPages}</div>
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="rounded-lg border border-ash-200 px-2.5 py-1 disabled:opacity-40 hover:bg-ash-50"
                        >
                            ›
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
