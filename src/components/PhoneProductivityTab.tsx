"use client"

import { useState, useEffect, useCallback } from "react"
import { getPhoneProductivity, type PhoneProductivityRow } from "@/app/actions/productivityActions"
import { Phone, RefreshCw } from "lucide-react"
import { WEEKDAY_SHIFT } from "@/lib/cdr/shift"

/** Durata del turno (minuti): 390 sia nei feriali (13:30-20:00) sia il sabato (10:00-16:30). */
const SHIFT_REFERENCE_MIN = WEEKDAY_SHIFT.endMin - WEEKDAY_SHIFT.startMin

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

/** Somma delle sei colonne di tempo sommabili della riga (esclude le colonne di giudizio). */
function rowTotalMin(r: PhoneProductivityRow): number {
    return r.talkMinPerDay + r.ringingMinPerDay + r.workRhythmMinPerDay + r.pauseMinPerDay
        + r.startLateAvgMin + r.endEarlyAvgMin
}

export function PhoneProductivityTab() {
    const [offset, setOffset] = useState(0)
    const [data, setData] = useState<{ rows: PhoneProductivityRow[] } | null>(null)
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

    const { rows } = data
    const avgTalkMin = Math.round(rows.reduce((a, r) => a + r.talkMinPerDay, 0) / rows.length)
    const avgPauseMinTeam = Math.round(rows.reduce((a, r) => a + r.pauseMinPerDay, 0) / rows.length)
    const teamOverAllowanceHours = Math.round(rows.reduce((a, r) => a + r.overAllowanceHoursPeriod, 0) * 10) / 10

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

            {/* Avviso: come si distingue il ritmo di lavoro dalla pausa vera, e come si verifica la tabella a mano */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div>
                    Le sei colonne di tempo (<strong>al telefono, squilli, ritmo, pause, inizio tardi, dopo l&apos;ultima
                    chiamata</strong>) sono tutte sommabili: la loro somma torna alla durata del turno
                    (<strong>{SHIFT_REFERENCE_MIN} min</strong>), colonna <strong>Totale</strong>. È così che la tabella
                    si verifica a mano.
                </div>
                <div>
                    Fra una chiamata e l&apos;altra, fino a <strong>2 minuti</strong> è <strong>ritmo di lavoro</strong>:
                    chiudere l&apos;esito e comporre il numero dopo, non pausa (<strong>37-75 minuti al giorno</strong>).
                    Oltre i 2 minuti è <strong>interruzione</strong> vera: il contratto prevede 30 minuti di pausa al
                    giorno, è questo il riferimento, non il migliore del gruppo.
                </div>
                <div>
                    La durata di ogni singola pausa è <strong>simile per tutti</strong> (8-11 minuti a interruzione).
                    A fare la differenza fra le persone è <strong>quante volte ci si ferma</strong>, non quanto dura la
                    singola pausa.
                </div>
                <div>
                    Il sabato ha lo stesso orario dei feriali ma su una fascia diversa (10:00-16:30). L&apos;ultima
                    ora è spesso dedicata alla formazione: fino a 60 minuti non vengono conteggiati come interruzione.
                </div>
                <div>
                    Tutte le medie della tabella sono calcolate sulle sole <strong>giornate intere</strong>: le mezze
                    giornate e i permessi sono contati a parte (colonna Giornate) e non entrano nel confronto, perché
                    altrimenti chi ha avuto permessi risulterebbe più diligente di chi ha lavorato tutti i giorni interi.
                </div>
            </div>

            {/* Riga riassuntiva di squadra, sopra la tabella */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryStat label="Turno di riferimento" value="Fer. 13:30-20:00" sub="Sab. 10:00-16:30" />
                <SummaryStat label="Al telefono (media)" value={`${avgTalkMin} min`} sub="al giorno, squadra" />
                <SummaryStat label="Pause (media)" value={`${avgPauseMinTeam} min`} sub="al giorno, squadra · 30 min concessi" />
                <SummaryStat label="Ore in eccesso" value={`${itNum(teamOverAllowanceHours)} h`} sub="squadra, nel periodo" />
            </div>

            <div className="rounded-xl border border-ash-200 bg-white overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-2 py-3 font-semibold">GDO</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Giornate INTERE (non permessi/mezze giornate), con almeno 40 chiamate: sono la base di calcolo di tutte le medie della riga. A fianco, se presenti, le giornate escluse (permessi/mezze giornate).">Gg</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Chiamate effettuate in media in una giornata">Chiamate</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti di conversazione effettiva (billsec) in media al giorno">Al telefono</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Il telefono squilla e nessuno risponde (duration - billsec) in media al giorno: non è conversazione né tempo fermo, è il terzo pezzo del turno">Squilli</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti al giorno in buchi fra una chiamata e l'altra fino a 2 minuti: chiudere l'esito e comporre il numero dopo. È lavoro, non pausa.">Ritmo</th>
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti al giorno persi in interruzioni fra una chiamata e l'altra oltre i 2 minuti (sotto i 2 minuti è ritmo di lavoro). Sotto: quante volte al giorno e quanto dura in media ogni interruzione.">
                                Pause
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Media sulle giornate intere di 'inizio tardi' (ritardo fra inizio turno e prima chiamata) più 'dopo l'ultima chiamata' (anticipo fra fine ultima chiamata e fine turno). Dettaglio dei due valori (media e mediana) nel tooltip della cella.">
                                Bordi turno
                            </th>
                            <th className="text-right px-2 py-3 font-bold" title="Quanto le pause superano i 30 minuti di pausa concessi da contratto. È il numero da guardare.">
                                Oltre 30&apos;
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Ore complessive di eccesso sui 30 minuti concessi, nell'intero periodo mostrato">
                                Ore ecc.
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Somma delle sei colonne di tempo, a fianco la durata del turno di riferimento: devono coincidere a meno di pochi minuti (vedi nota sotto la tabella).">
                                Totale
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const total = rowTotalMin(r)
                            const bordiTurno = r.startLateAvgMin + r.endEarlyAvgMin
                            return (
                                <tr key={r.userId} className="border-t border-ash-100 align-top">
                                    <td className="px-2 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                    <td className="px-2 py-3 text-right tabular-nums">
                                        <div className="text-ash-500">{r.days}</div>
                                        {r.daysShort > 0 && <div className="text-xs text-ash-400">+{r.daysShort} escl.</div>}
                                    </td>
                                    <td className="px-2 py-3 text-right tabular-nums">{r.callsPerDay}</td>
                                    <td className="px-2 py-3 text-right tabular-nums font-semibold text-emerald-700">{r.talkMinPerDay} min</td>
                                    <td className="px-2 py-3 text-right tabular-nums text-ash-500">{r.ringingMinPerDay} min</td>
                                    <td className="px-2 py-3 text-right tabular-nums text-ash-600">{r.workRhythmMinPerDay} min</td>
                                    <td className="px-2 py-3 text-right tabular-nums">
                                        <div className="font-semibold text-ash-800">{r.pauseMinPerDay} min</div>
                                        <div className="text-xs text-ash-400">
                                            {itNum(r.pauseCountPerDay)} volte · {r.avgPauseMin} min l&apos;una
                                        </div>
                                    </td>
                                    <td
                                        className="px-2 py-3 text-right tabular-nums"
                                        title={`Inizio tardi: media ${r.startLateAvgMin} min (mediana ${r.startLateMin} min) · Dopo l'ultima chiamata: media ${r.endEarlyAvgMin} min (mediana ${r.endEarlyMin} min)`}
                                    >
                                        <div className="font-semibold text-ash-800">{bordiTurno} min</div>
                                        <div className="text-xs text-ash-400">
                                            {r.daysFullShift}/{r.days + r.daysShort} a fine turno
                                        </div>
                                    </td>
                                    <td className={`px-2 py-3 text-right tabular-nums font-bold text-base ${r.overAllowanceMinPerDay > 45 ? 'text-red-600' : r.overAllowanceMinPerDay > 0 ? 'text-amber-600' : 'text-ash-400'}`}>
                                        {r.overAllowanceMinPerDay > 0 ? `+${r.overAllowanceMinPerDay} min` : '—'}
                                    </td>
                                    <td className="px-2 py-3 text-right tabular-nums text-ash-600">
                                        {r.overAllowanceHoursPeriod > 0 ? `${itNum(r.overAllowanceHoursPeriod)} h` : '—'}
                                    </td>
                                    <td className="px-2 py-3 text-right tabular-nums text-ash-500">
                                        {total} / {SHIFT_REFERENCE_MIN} min
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 border-ash-200 bg-ash-50 font-semibold text-ash-800">
                            <td className="px-2 py-3" colSpan={9}>Totale squadra, ore in eccesso sul periodo</td>
                            <td className="px-2 py-3 text-right tabular-nums">{itNum(teamOverAllowanceHours)} h</td>
                            <td className="px-2 py-3 text-right tabular-nums text-ash-400">—</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div className="flex items-start gap-2 text-xs text-ash-400">
                <Phone className="w-3 h-3 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                    <div>
                        Giornate con almeno 40 chiamate. Fonte: tabulati del centralino, turno reale (non la finestra osservata).
                        {rows.some(r => r.daysShort > 0) && (
                            <span>
                                {' '}{rows.reduce((a, r) => a + r.daysShort, 0)} giornate su {rows.reduce((a, r) => a + r.days + r.daysShort, 0)} nel mese sono mezze giornate/permessi (anticipo oltre 60 min, 120 il sabato): contate a parte (colonna Giornate), escluse da tutte le medie della riga.
                            </span>
                        )}
                    </div>
                    <div>
                        La colonna Totale può superare la durata del turno di 3-13 minuti: è una media su giornate
                        feriali e sabati, che hanno fasce orarie diverse, più gli arrotondamenti al minuto di ogni
                        colonna. Non è un errore.
                    </div>
                </div>
            </div>
        </div>
    )
}

/** Un decimale, virgola italiana: 20,9 invece di 20.9. */
function itNum(n: number): string {
    return n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
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
