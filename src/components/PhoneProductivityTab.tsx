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

/**
 * Somma delle colonne di tempo sommabili della riga (esclude le colonne di
 * giudizio). Si sommano le voci COSÌ COME SONO MOSTRATE — brevi e pause
 * separate, non pauseMinPerDay — perché il totale deve tornare rifacendo il
 * conto a mano da quello che si legge in tabella.
 */
function rowTotalMin(r: PhoneProductivityRow): number {
    return r.talkMinPerDay + r.ringingMinPerDay + r.workRhythmMinPerDay
        + r.shortPauseMinPerDay + r.longPauseMinPerDay
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
    const teamAvg = (pick: (r: PhoneProductivityRow) => number) => rows.reduce((a, r) => a + pick(r), 0) / rows.length
    const avgTalkMin = Math.round(teamAvg(r => r.talkMinPerDay))
    const avgShortPauseMinTeam = Math.round(teamAvg(r => r.shortPauseMinPerDay))
    const avgLongPauseMinTeam = Math.round(teamAvg(r => r.longPauseMinPerDay))
    const avgAfterRingTeam = Math.round(teamAvg(r => r.shortPauseAfterRingCountPerDay) * 10) / 10
    const afterRingValues = rows.map(r => r.shortPauseAfterRingCountPerDay)
    const minAfterRing = Math.min(...afterRingValues)
    const maxAfterRing = Math.max(...afterRingValues)
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

            {/* Avviso: le tre categorie di tempo fra una chiamata e l'altra, e come si verifica la tabella a mano */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div>
                    Le sette colonne di tempo (<strong>al telefono, squilli, tra le chiamate, interruzioni brevi, pause,
                    inizio tardi, dopo l&apos;ultima chiamata</strong>) sono tutte sommabili: la loro somma torna alla
                    durata del turno (<strong>{SHIFT_REFERENCE_MIN} min</strong>), colonna <strong>Totale</strong>. È
                    così che la tabella si verifica a mano.
                </div>
                <div>
                    Il tempo fra una chiamata e l&apos;altra è diviso in <strong>tre fasce, che dicono cose diverse</strong>:
                    fino a <strong>2 minuti</strong> è lavoro (chiudere l&apos;esito, comporre il numero dopo) e non va
                    giudicato — è alto proprio per chi fa tante chiamate; da <strong>2 a 10 minuti</strong> sono
                    interruzioni brevi, non basta per uscire; <strong>oltre i 10 minuti</strong> sono le pause vere, le
                    uscite (3-6 al giorno in una giornata normale).
                </div>
                <div>
                    <strong>Dopo uno squillo a vuoto non c&apos;è nessun esito da scrivere</strong>: fermarsi lì non ha la
                    giustificazione del lavoro amministrativo. È la voce meno contestabile della tabella, e in questo
                    periodo va da <strong>{itNum(minAfterRing)}</strong> a <strong>{itNum(maxAfterRing)} volte al
                    giorno</strong> a seconda della persona.
                </div>
                <div>
                    Il metro sulle interruzioni (brevi + pause insieme) resta il diritto contrattuale a
                    <strong> 30 minuti di pausa al giorno</strong>, non il migliore del gruppo.
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <SummaryStat label="Turno di riferimento" value="Fer. 13:30-20:00" sub="Sab. 10:00-16:30" />
                <SummaryStat label="Al telefono (media)" value={`${avgTalkMin} min`} sub="al giorno, squadra" />
                <SummaryStat label="Interruzioni brevi" value={`${avgShortPauseMinTeam} min`} sub={`al giorno, squadra · ${itNum(avgAfterRingTeam)} volte dopo uno squillo a vuoto`} />
                <SummaryStat label="Pause (oltre 10 min)" value={`${avgLongPauseMinTeam} min`} sub="al giorno, squadra · 30 min concessi in tutto" />
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
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti al giorno in buchi fra una chiamata e l'altra fino a 2 minuti: chiudere l'esito e comporre il numero dopo. È lavoro, non pausa, e non è un metro di giudizio: è alto per chi fa tante chiamate.">
                                Tra le chiamate
                                <div className="text-[10px] font-normal text-ash-400">fino a 2 min · lavoro</div>
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti al giorno in interruzioni fra 2 e 10 minuti: troppo per essere lavoro, troppo poco per essere un'uscita. Sotto: quante volte al giorno, e quante di quelle volte arrivano subito dopo uno squillo a vuoto (dove non c'è alcun esito da scrivere).">
                                Interruzioni brevi
                                <div className="text-[10px] font-normal text-ash-400">2-10 min</div>
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Minuti al giorno in pause oltre i 10 minuti: le uscite. Sotto: quante volte al giorno (3-6 è la giornata normale).">
                                Pause
                                <div className="text-[10px] font-normal text-ash-400">oltre 10 min</div>
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Media sulle giornate intere di 'inizio tardi' (ritardo fra inizio turno e prima chiamata) più 'dopo l'ultima chiamata' (anticipo fra fine ultima chiamata e fine turno). Dettaglio dei due valori (media e mediana) nel tooltip della cella.">
                                Bordi turno
                            </th>
                            <th className="text-right px-2 py-3 font-bold" title="Quanto le interruzioni (brevi + pause insieme) superano i 30 minuti di pausa concessi da contratto. È il numero da guardare.">
                                Oltre 30&apos;
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Ore complessive di eccesso sui 30 minuti concessi, nell'intero periodo mostrato">
                                Ore ecc.
                            </th>
                            <th className="text-right px-2 py-3 font-semibold" title="Somma delle sette colonne di tempo, a fianco la durata del turno di riferimento: devono coincidere a meno di pochi minuti (vedi nota sotto la tabella).">
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
                                    <td className="px-2 py-3 text-right tabular-nums text-ash-500">{r.workRhythmMinPerDay} min</td>
                                    <td className="px-2 py-3 text-right tabular-nums">
                                        <div className="font-semibold text-ash-800">{r.shortPauseMinPerDay} min</div>
                                        <div className="text-xs text-ash-400">{itNum(r.shortPauseCountPerDay)} volte</div>
                                        <div
                                            className={`text-xs ${r.shortPauseAfterRingCountPerDay >= 5 ? 'font-semibold text-red-600' : 'text-ash-400'}`}
                                            title="Interruzioni brevi che iniziano subito dopo uno squillo a vuoto: nessun esito da scrivere, nessuna giustificazione amministrativa"
                                        >
                                            {itNum(r.shortPauseAfterRingCountPerDay)} dopo squillo a vuoto
                                        </div>
                                    </td>
                                    <td className="px-2 py-3 text-right tabular-nums">
                                        <div className="font-semibold text-ash-800">{r.longPauseMinPerDay} min</div>
                                        <div className="text-xs text-ash-400">{itNum(r.longPauseCountPerDay)} volte</div>
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
                            <td className="px-2 py-3" colSpan={10}>Totale squadra, ore in eccesso sul periodo</td>
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
                        La colonna Totale può discostarsi dalla durata del turno di una decina di minuti in più o in
                        meno: è una media su giornate feriali e sabati, che hanno fasce orarie diverse, ci sono gli
                        arrotondamenti al minuto di ogni colonna, e il sabato fino a 60 minuti di formazione sono
                        tolti dalle pause (quindi mancano dalla somma). Non è un errore.
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
