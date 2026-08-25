"use client"

import { useState, useEffect, useCallback } from "react"
import { getPhoneProductivity, type PhoneProductivityRow } from "@/app/actions/productivityActions"
import { Phone, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"

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
    const [showBuckets, setShowBuckets] = useState(false)
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

    const { rows } = data
    const avgTalkMin = Math.round(rows.reduce((a, r) => a + r.talkMinPerDay, 0) / rows.length)
    const avgFermoMin = Math.round(rows.reduce((a, r) => a + r.fermoTotalMin, 0) / rows.length)
    const fermoValues = rows.map(r => r.fermoTotalMin)
    const fermoSpread = Math.max(...fermoValues) - Math.min(...fermoValues)

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

            {/* Avviso: cosa significa "fermo" e come leggere i bordi del turno */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div>
                    Il <strong>tempo fermo</strong> non è tutto tempo di pausa: contiene anche la compilazione
                    degli esiti e la scelta del lead successivo. Il riferimento sensato è
                    <strong> il migliore del gruppo</strong> ({data.benchmarkMin} min/giorno di assenze pure),
                    non lo zero e non i 30 minuti di pausa concessi.
                </div>
                <div>
                    Le giornate molto corte (uscita molto prima di fine turno) sono quasi sempre permessi o
                    mezze giornate autorizzate, non uscite anticipate sistematiche: per questo "stacca prima"
                    è la <strong>mediana</strong> delle giornate e non la media, che verrebbe trascinata da 1-2 casi anomali.
                </div>
                <div>
                    Il sabato ha un turno diverso (10:00-15:30, non confermato dal committente) ed è conteggiato
                    con la sua durata: non è confrontabile 1:1 con un feriale.
                </div>
            </div>

            {/* Riga riassuntiva di squadra, sopra la tabella */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryStat label="Turno di riferimento" value="Fer. 13:30-20:00" sub="Sab. 10:00-15:30" />
                <SummaryStat label="Al telefono (media)" value={`${avgTalkMin} min`} sub="al giorno, squadra" />
                <SummaryStat label="Fermo totale (media)" value={`${avgFermoMin} min`} sub="al giorno, squadra" />
                <SummaryStat label="Migliore vs peggiore" value={`${fermoSpread} min`} sub="scarto sul fermo totale" />
            </div>

            <div className="rounded-xl border border-ash-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-semibold">GDO</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Numero di giornate con almeno 40 chiamate, usate per il calcolo">Giornate</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Chiamate effettuate in media in una giornata">Chiamate/gg</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Minuti di conversazione effettiva (billsec) in media al giorno">Al telefono</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Buchi fra una chiamata e l'altra, divisi per durata: clicca per il dettaglio">
                                <button
                                    onClick={() => setShowBuckets(v => !v)}
                                    className="flex items-center gap-1 ml-auto text-ash-600 hover:text-ash-800"
                                >
                                    Buchi per durata
                                    {showBuckets ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                            </th>
                            <th className="text-right px-4 py-3 font-semibold" title="Mediana dei minuti fra la fine dell'ultima chiamata e la fine turno. Non è una media: 1-2 giornate anomale (permessi, mezze giornate) la sposterebbero lontano dal caso tipico. A fianco: quante giornate arrivano fino a fine turno (anticipo entro 15 min).">
                                Stacca prima (mediana)
                            </th>
                            <th className="text-right px-4 py-3 font-semibold" title="Minuti del turno senza nessuna chiamata attiva (bordi + buchi interni), e percentuale sulla durata del turno. È l'informazione più importante della tabella.">
                                Fermo totale
                            </th>
                            <th className="text-right px-4 py-3 font-semibold" title="Quanto la giornata di assenze pure (buchi oltre 10 minuti) supera il migliore del gruppo">Oltre il migliore</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const excess = r.assenzeMinPerDay - data.benchmarkMin
                            return (
                                <tr key={r.userId} className="border-t border-ash-100 align-top">
                                    <td className="px-4 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                    <td className="px-4 py-3 text-right text-ash-500">{r.days}</td>
                                    <td className="px-4 py-3 text-right tabular-nums">{r.callsPerDay}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{r.talkMinPerDay} min</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-ash-500">
                                        {showBuckets ? (
                                            <div className="flex flex-col gap-0.5 text-xs">
                                                <div title="Post-chiamata (<3 min): compilare l'esito e passare al numero dopo, tempo di lavoro che non si comprime">
                                                    Post-chiamata (&lt;3 min): <span className="tabular-nums font-medium text-ash-700">{r.ritmoMinPerDay} min</span>
                                                </div>
                                                <div title="Pause brevi (3-10 min)">
                                                    Pause brevi (3-10 min): <span className="tabular-nums font-medium text-ash-700">{r.grigiaMinPerDay} min</span>
                                                </div>
                                                <div title="Assenze (>10 min): il numero da discutere">
                                                    Assenze (&gt;10 min): <span className="tabular-nums font-semibold text-ash-800">{r.assenzeMinPerDay} min</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-xs">{r.assenzeMinPerDay} min assenze</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums">
                                        <div className="font-semibold text-ash-800">{r.endEarlyMin} min</div>
                                        <div className="text-xs text-ash-400">{r.daysFullShift}/{r.days} giornate intere</div>
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums">
                                        <div className="font-bold text-ash-900 text-base">{r.fermoTotalMin} min</div>
                                        <div className="text-xs text-ash-500">{r.fermoPct}% del turno ({r.shiftMinutes} min)</div>
                                    </td>
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
                Giornate con almeno 40 chiamate. Fonte: tabulati del centralino, turno reale (non la finestra osservata).
                {rows.some(r => r.daysShort > 0) && (
                    <span>
                        {' '}{rows.reduce((a, r) => a + r.daysShort, 0)} giornate su {rows.reduce((a, r) => a + r.days, 0)} nel mese hanno anticipo oltre 60 min (mezze giornate/permessi), escluse dal giudizio sulla mediana.
                    </span>
                )}
            </div>
        </div>
    )
}

function SummaryStat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-ash-400 font-semibold">{label}</div>
            <div className="text-lg font-bold text-ash-800">{value}</div>
            <div className="text-xs text-ash-400">{sub}</div>
        </div>
    )
}
