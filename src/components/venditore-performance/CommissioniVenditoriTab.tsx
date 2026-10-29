"use client"

// Performance venditori → "Incassi e commissioni" (PO 29/10/2026), solo
// ADMIN/MANAGER: per controllare la fattura di ogni venditore. Stesso calcolo
// di "I miei incassi" (src/lib/venditore/obiettivi.ts): obiettivo sul FIRMATO,
// commissione sull'INCASSATO senza IVA (÷ 1,22) al 10/11/12%.

import { Fragment, useEffect, useState } from "react"
import { getCommissioniVenditori, type CommissioneVenditore } from "@/app/actions/obiettiviVenditoriActions"
import { formatEur, formatDate, formatMonth } from "@/components/gestionale/format"
import { ChevronDown, ChevronRight } from "lucide-react"

const euro = (eur: number) => formatEur(Math.round(eur * 100))

function Scenario({ s, pct, preso, attivo }: { s: { cents: number; mancaEur: number } | null; pct: number; preso: boolean; attivo: boolean }) {
    if (!s) return <div className="text-ash-300">—</div>
    return (
        <div className={`rounded-md px-2 py-1 ${attivo ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}>
            <div className={`font-semibold ${attivo ? 'text-emerald-700' : 'text-ash-500'}`}>{formatEur(s.cents)}</div>
            <div className="text-[10px] text-ash-500">
                {preso ? `${pct}% · raggiunto` : `${pct}% · mancano ${euro(s.mancaEur)} di firmato`}
            </div>
        </div>
    )
}

export function CommissioniVenditoriTab({ mesi, initialYearMonth }: { mesi: string[]; initialYearMonth: string }) {
    const [ym, setYm] = useState(initialYearMonth)
    const [righe, setRighe] = useState<CommissioneVenditore[] | null>(null)
    const [errore, setErrore] = useState<string | null>(null)
    const [aperti, setAperti] = useState<Set<string>>(new Set())

    useEffect(() => {
        let vivo = true
        setRighe(null)
        setErrore(null)
        getCommissioniVenditori(ym)
            .then(r => { if (vivo) setRighe(r) })
            .catch(e => { console.error(e); if (vivo) setErrore('Impossibile caricare incassi e commissioni.') })
        return () => { vivo = false }
    }, [ym])

    const apri = (id: string) => setAperti(p => {
        const n = new Set(p)
        if (n.has(id)) n.delete(id); else n.add(id)
        return n
    })

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Mese</label>
                    <select value={ym} onChange={e => setYm(e.target.value)} className="input-fenice w-auto text-sm">
                        {mesi.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
                    </select>
                </div>
                <div className="max-w-2xl text-xs text-ash-500">
                    Obiettivo sul <b>firmato</b> del mese. Commissione = <b>incassato</b> del mese (mese commissione del gestionale) ÷ 1,22 × 10%;
                    11% col 1° obiettivo, 12% col 2°, su tutto l&apos;incassato. La colonna valida è evidenziata. Le multe sono a parte.
                    &quot;Provvisorio&quot; = l&apos;amministrazione non ha ancora la riga commissioni: l&apos;incassato è la somma delle righe.
                </div>
            </div>

            {errore && <div className="text-sm text-ember-600">{errore}</div>}
            {!righe && !errore && <div className="py-12 text-center text-gray-400">Caricamento…</div>}

            {righe && (
                <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white">
                    <table className="min-w-full divide-y divide-ash-200/60 text-left text-sm">
                        <thead className="bg-ash-50 text-xs font-medium uppercase tracking-wider text-ash-500">
                            <tr>
                                <th className="px-3 py-2">Venditore</th>
                                <th className="px-3 py-2 text-right">Firmato</th>
                                <th className="px-3 py-2">Obiettivo raggiunto</th>
                                <th className="px-3 py-2 text-right">Incassato (lordo)</th>
                                <th className="px-3 py-2 text-right">Senza IVA (÷1,22)</th>
                                <th className="px-3 py-2">Commissione attuale</th>
                                <th className="px-3 py-2">Se raggiunge il 1° (11%)</th>
                                <th className="px-3 py-2">Se raggiunge il 2° (12%)</th>
                                <th className="px-3 py-2 text-right">Multe (a parte)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100/60">
                            {righe.map(r => {
                                const g = r.guadagno
                                const aperto = aperti.has(r.salesUserId)
                                return (
                                    <Fragment key={r.salesUserId}>
                                        <tr className="align-top">
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <button type="button" onClick={() => apri(r.salesUserId)} className="flex items-start gap-1 text-left">
                                                    {aperto ? <ChevronDown className="mt-0.5 h-4 w-4 text-ash-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-ash-400" />}
                                                    <div>
                                                        <div className="font-medium text-ash-800">{r.nome}</div>
                                                        <div className="text-[10px] text-ash-400">{r.codice} · {r.incassi.length} incassi</div>
                                                    </div>
                                                </button>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-ash-800">{euro(r.firmatoEur)}</td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                {r.obiettivi.target1Eur == null ? <div className="text-ash-300">nessun obiettivo</div>
                                                    : g.raggiunto === 0 ? <div className="text-ash-500">nessuno</div>
                                                        : <div className="font-semibold text-emerald-700">{g.raggiunto}° obiettivo</div>}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">
                                                {formatEur(r.incassatoCents)}
                                                {r.incassoProvvisorio && <div className="text-[10px] text-amber-600">provvisorio</div>}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">{formatEur(g.senzaIvaCents)}</td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <div className={`rounded-md px-2 py-1 ${g.raggiunto === 0 ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}>
                                                    <div className="font-bold text-ash-900">{formatEur(g.attualeCents)}</div>
                                                    <div className="text-[10px] text-ash-500">{g.pct}% · da fatturare</div>
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2"><Scenario s={g.se1} pct={11} preso={g.raggiunto >= 1} attivo={g.raggiunto === 1} /></td>
                                            <td className="whitespace-nowrap px-3 py-2"><Scenario s={g.se2} pct={12} preso={g.raggiunto >= 2} attivo={g.raggiunto === 2} /></td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-red-700">{r.multeCents ? formatEur(r.multeCents) : <div className="text-ash-300">—</div>}</td>
                                        </tr>
                                        {aperto && (
                                            <tr className="bg-ash-50/60">
                                                <td colSpan={9} className="px-6 py-3">
                                                    {r.incassi.length === 0 ? (
                                                        <div className="text-sm text-ash-500">Nessun incasso nel mese.</div>
                                                    ) : (
                                                        <table className="text-sm">
                                                            <thead className="text-xs text-ash-500">
                                                                <tr>
                                                                    <th className="pr-6 text-left font-medium">Data</th>
                                                                    <th className="pr-6 text-left font-medium">Cliente</th>
                                                                    <th className="pr-6 text-left font-medium">Voce</th>
                                                                    <th className="text-right font-medium">Importo</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {r.incassi.map(i => (
                                                                    <tr key={i.id} className={i.contaCommissione ? '' : 'text-ash-400'}>
                                                                        <td className="pr-6">{formatDate(i.data)}</td>
                                                                        <td className="pr-6">{i.cliente}</td>
                                                                        <td className="pr-6">{i.voce ?? '—'}{!i.contaCommissione && ' (non conta)'}</td>
                                                                        <td className={`text-right ${i.importoCents < 0 ? 'text-red-700' : ''}`}>{formatEur(i.importoCents)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
