"use client"

import { useEffect, useState } from "react"
import { getVenditoreStorico, saveVenditoreOutcome } from "@/app/actions/venditoreActions"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { Search, BadgeCheck, ChevronDown, ChevronUp } from "lucide-react"
import { parseRomeDatetimeLocal, toRomeDatetimeLocal } from "@/lib/dateUtils"

const OUTCOME_FILTERS = ["Tutti", "Chiuso", "Non chiuso", "Sparito"] as const
type OutcomeFilter = (typeof OUTCOME_FILTERS)[number]

// 'Perso' è un esito legacy (rimosso 2026-07-08): nello Storico è mostrato
// e filtrato come 'Non chiuso'.
const effectiveOutcome = (o: string | null) => (o === "Perso" ? "Non chiuso" : o || "")

const outcomeBadgeClass = (o: string) =>
    o === "Chiuso"
        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
        : o === "Sparito"
            ? "bg-ash-100 text-ash-600 border-ash-200"
            : "bg-amber-100 text-amber-700 border-amber-200"

export function StoricoTrattativeTab({ sellerId, onChanged }: { sellerId: string; onChanged: () => void }) {
    const [rows, setRows] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [filter, setFilter] = useState<OutcomeFilter>("Tutti")
    const [search, setSearch] = useState("")
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [closingId, setClosingId] = useState<string | null>(null)
    const [isClosing, setIsClosing] = useState(false)
    const [closeProduct, setCloseProduct] = useState("")
    const [closeAmount, setCloseAmount] = useState("")
    const [closeDate, setCloseDate] = useState(() => toRomeDatetimeLocal(new Date()))

    const load = () => {
        setIsLoading(true)
        getVenditoreStorico(sellerId)
            .then(r => setRows(r))
            .catch(() => setRows([]))
            .finally(() => setIsLoading(false))
    }
    useEffect(load, [sellerId])

    const filtered = rows.filter(r => {
        if (filter !== "Tutti" && effectiveOutcome(r.salespersonOutcome) !== filter) return false
        const q = search.toLowerCase()
        if (q && !((r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q))) return false
        return true
    })

    const countFor = (f: OutcomeFilter) =>
        f === "Tutti" ? rows.length : rows.filter(r => effectiveOutcome(r.salespersonOutcome) === f).length

    const handleStartClose = (r: any) => {
        setExpandedId(r.id)
        setClosingId(r.id)
        setCloseProduct("")
        setCloseAmount("")
        setCloseDate(toRomeDatetimeLocal(new Date()))
    }

    const handleConfirmClose = async (r: any) => {
        const parsed = parseRomeDatetimeLocal(closeDate)
        if (!parsed) { alert("Data non valida"); return }
        setIsClosing(true)
        try {
            const res = await saveVenditoreOutcome(r.id, {
                outcome: 'Chiuso',
                closeProduct,
                closeAmountEur: Number(closeAmount),
                outcomeAt: parsed,
                // Chiusura diretta di un lead già esitato: è un tentativo in più,
                // il "Non chiuso" precedente resta nella storia. Se il lead era
                // già chiuso, resolveAttemptWrite corregge la chiusura esistente
                // invece di crearne una seconda (una sola chiusura per ciclo).
                occasion: 'new',
            }, r.version)
            if (!res.success) {
                alert(res.error === 'CONCURRENCY_ERROR' ? 'Il lead è stato modificato da un altro utente: ricarica la pagina e riprova.' : (res.error || 'Errore durante la chiusura'))
                return
            }
            setClosingId(null); load(); onChanged()
        } finally { setIsClosing(false) }
    }

    return (
        <div className="p-6 bg-gradient-to-b from-ash-50/50 to-white space-y-4">
            {/* Filtri */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex flex-wrap gap-2">
                    {OUTCOME_FILTERS.map(f => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filter === f
                                ? "bg-brand-orange-600 text-white border-brand-orange-600"
                                : "bg-white text-ash-600 border-ash-200 hover:border-brand-orange/40"}`}
                        >
                            {f} ({countFor(f)})
                        </button>
                    ))}
                </div>
                <div className="relative md:ml-auto md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ash-400" />
                    <input
                        type="text"
                        placeholder="Cerca nome o telefono..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-ash-50/50 border border-ash-200/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-all"
                    />
                </div>
            </div>

            {/* Lista */}
            {isLoading ? (
                <div className="text-center text-ash-400 py-12">Caricamento storico…</div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-ash-400 py-12">Nessuna trattativa nello storico.</div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(r => {
                        const outcome = effectiveOutcome(r.salespersonOutcome)
                        const expanded = expandedId === r.id
                        const isClosingThis = closingId === r.id
                        return (
                            <div key={r.id} className="bg-white border border-ash-200/60 rounded-lg overflow-hidden">
                                <div
                                    onClick={() => { setExpandedId(expanded ? null : r.id); if (expanded) setClosingId(null) }}
                                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-ash-50/50 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <div className="font-semibold text-ash-800 truncate">{r.name}</div>
                                        <div className="text-xs text-ash-500 mt-1">
                                            {r.funnel || "Sconosciuto"}
                                            {r.salespersonOutcomeAt && <> · Esitato il {format(new Date(r.salespersonOutcomeAt), "dd MMM yyyy", { locale: it })}</>}
                                            {outcome === "Chiuso" && r.closeAmountEur ? <> · <strong>€{r.closeAmountEur}</strong>{r.closeProduct ? ` (${r.closeProduct})` : ""}</> : null}
                                            {outcome !== "Chiuso" && r.notClosedReason ? <> · {r.notClosedReason}</> : null}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${outcomeBadgeClass(outcome)}`}>
                                            {outcome}
                                        </div>
                                        {outcome !== "Chiuso" && (
                                            <div onClick={e => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartClose(r)}
                                                    disabled={isClosingThis && isClosing}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-50 transition-colors"
                                                >
                                                    <BadgeCheck className="h-3.5 w-3.5" />
                                                    Registra chiusura
                                                </button>
                                            </div>
                                        )}
                                        {expanded ? <ChevronUp className="h-4 w-4 text-ash-400" /> : <ChevronDown className="h-4 w-4 text-ash-400" />}
                                    </div>
                                </div>
                                {expanded && (
                                    <div className="border-t border-ash-100 bg-ash-50/40 p-4">
                                        {isClosingThis && (
                                            <div onClick={e => e.stopPropagation()} className="mb-4 p-4 bg-white border border-emerald-200 rounded-lg space-y-3">
                                                <p className="text-xs text-ash-500">
                                                    L&apos;esito verrà aggiornato subito a Chiuso. Non è possibile lasciare il lead senza esito o segnarlo Sparito.
                                                </p>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <select
                                                        value={closeProduct}
                                                        onChange={e => setCloseProduct(e.target.value)}
                                                        className="px-3 py-2 border border-ash-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                                                    >
                                                        <option value="">Prodotto…</option>
                                                        <option value="advance">Advance</option>
                                                        <option value="gold">Gold</option>
                                                        <option value="exclusive">Exclusive</option>
                                                    </select>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        placeholder="Importo €"
                                                        value={closeAmount}
                                                        onChange={e => setCloseAmount(e.target.value)}
                                                        className="px-3 py-2 border border-ash-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                                                    />
                                                    <input
                                                        type="datetime-local"
                                                        value={closeDate}
                                                        onChange={e => setCloseDate(e.target.value)}
                                                        className="px-3 py-2 border border-ash-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleConfirmClose(r)}
                                                        disabled={!closeProduct || !(Number(closeAmount) > 0) || isClosing}
                                                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                    >
                                                        {isClosing ? "Salvataggio…" : "Conferma chiusura"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setClosingId(null)}
                                                        disabled={isClosing}
                                                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-600 hover:border-ash-300 disabled:opacity-50 transition-colors"
                                                    >
                                                        Annulla
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <h4 className="text-xs font-bold text-ash-500 uppercase tracking-widest mb-2">Storia dei tentativi</h4>
                                        {r.attempts.length === 0 ? (
                                            <div className="text-xs text-ash-400">Nessun tentativo registrato.</div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {r.attempts.map((a: any) => (
                                                    <div key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ash-600">
                                                        <span className="font-bold text-ash-400 w-24 shrink-0">
                                                            {a.attemptNumber === 0 ? "Appuntamento" : `Follow-up ${a.attemptNumber}`}
                                                        </span>
                                                        <span>{a.outcomeAt ? format(new Date(a.outcomeAt), "dd MMM yyyy - HH:mm", { locale: it }) : "—"}</span>
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${outcomeBadgeClass(effectiveOutcome(a.outcome))}`}>
                                                            {effectiveOutcome(a.outcome)}
                                                        </span>
                                                        {a.notClosedReason && <span>· {a.notClosedReason}</span>}
                                                        {a.closeAmountEur ? <span>· €{a.closeAmountEur}{a.closeProduct ? ` (${a.closeProduct})` : ""}</span> : null}
                                                        {a.nextFollowUpDate && <span className="text-ash-400">· follow-up pianificato {format(new Date(a.nextFollowUpDate), "dd MMM", { locale: it })}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {r.salespersonOutcomeNotes && (
                                            <div className="text-xs text-ash-500 mt-2">Note finali: {r.salespersonOutcomeNotes}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
