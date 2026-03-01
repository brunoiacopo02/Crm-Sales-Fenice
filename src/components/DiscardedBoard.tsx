"use client"

import { useState, useMemo } from "react"
import { Search, Download, Copy, Filter, ChevronDown, ListEnd } from "lucide-react"
import { DiscardedLeadPayload } from "@/app/actions/discardedActions"
import Papa from "papaparse"

type DiscardedBoardProps = {
    initialData: DiscardedLeadPayload[]
}

export function DiscardedBoard({ initialData }: DiscardedBoardProps) {
    const [searchQuery, setSearchQuery] = useState("")

    // Filters
    const [dateRange, setDateRange] = useState("ALL")
    const [customStart, setCustomStart] = useState("")
    const [customEnd, setCustomEnd] = useState("")
    const [funnelFilter, setFunnelFilter] = useState("ALL")
    const [reasonFilter, setReasonFilter] = useState("ALL")
    const [gdoFilter, setGdoFilter] = useState("ALL")

    // Extracted Unique Values for dropdowns
    const funnels = useMemo(() => Array.from(new Set(initialData.map(l => l.funnel))), [initialData])
    const reasons = useMemo(() => Array.from(new Set(initialData.map(l => l.reason))), [initialData])
    const gdos = useMemo(() => Array.from(new Set(initialData.map(l => l.discardedBy))), [initialData])

    // Derived Data
    const filteredData = useMemo(() => {
        let res = [...initialData]

        // 1. Search Query (Email o Funnel)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            res = res.filter(l =>
                l.email.toLowerCase().includes(q) ||
                l.funnel.toLowerCase().includes(q)
            )
        }

        // 2. Date Filter
        if (dateRange !== "ALL") {
            const now = new Date()
            let cutoff = new Date()
            if (dateRange === "0") {
                cutoff.setHours(0, 0, 0, 0)
                res = res.filter(l => l.discardDate.getTime() >= cutoff.getTime())
            } else if (dateRange === "7") {
                cutoff.setDate(now.getDate() - 7)
                res = res.filter(l => l.discardDate.getTime() >= cutoff.getTime())
            } else if (dateRange === "30") {
                cutoff.setDate(now.getDate() - 30)
                res = res.filter(l => l.discardDate.getTime() >= cutoff.getTime())
            } else if (dateRange === "CUSTOM" && customStart && customEnd) {
                const s = new Date(customStart)
                const e = new Date(customEnd)
                e.setHours(23, 59, 59, 999)
                res = res.filter(l => l.discardDate.getTime() >= s.getTime() && l.discardDate.getTime() <= e.getTime())
            }
        }

        // 3. Funnel Filter
        if (funnelFilter !== "ALL") {
            res = res.filter(l => l.funnel === funnelFilter)
        }

        // 4. Reason Filter
        if (reasonFilter !== "ALL") {
            res = res.filter(l => l.reason === reasonFilter)
        }

        // 5. GDO Filter
        if (gdoFilter !== "ALL") {
            res = res.filter(l => l.discardedBy === gdoFilter)
        }

        return res
    }, [initialData, searchQuery, dateRange, customStart, customEnd, funnelFilter, reasonFilter, gdoFilter])

    // Actions
    const exportCsv = () => {
        if (filteredData.length === 0) return alert("Nessun dato da esportare.")
        const csv = Papa.unparse(filteredData.map(row => ({
            Email: row.email,
            Funnel: row.funnel,
            "Motivo Scarto": row.reason,
            "Data Scarto": new Date(row.discardDate).toLocaleString('it-IT'),
            "Scartato Da": row.discardedBy,
            "Note (Anteprima)": row.note
        })))

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `fenice_scartati_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    const copyEmails = (mode: 'COMMA' | 'NEWLINE') => {
        if (filteredData.length === 0) return alert("Nessun'email da copiare.")
        const emails = filteredData.map(l => l.email)
        const content = mode === 'COMMA' ? emails.join(', ') : emails.join('\n')

        navigator.clipboard.writeText(content).then(() => {
            alert(`Copiati ${emails.length} indirizzi email!`)
        }).catch(() => {
            alert("Impossibile accedere agli appunti del tuo browser.")
        })
    }

    return (
        <div className="space-y-6">

            {/* Toolbar di Azione Rapida */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <div className="relative w-full md:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Cerca per email o funnel..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium text-brand-charcoal"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={exportCsv}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
                    >
                        <Download className="h-4 w-4" />
                        Esporta CSV
                    </button>

                    <div className="relative group">
                        <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg shadow-inner transition-colors border border-gray-300">
                            <Copy className="h-4 w-4 text-gray-500" />
                            Copia Email <ChevronDown className="h-4 w-4 ml-1 opacity-50" />
                        </button>
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 overflow-hidden">
                            <button onClick={() => copyEmails('COMMA')} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-50">Separate da Virgola (,)</button>
                            <button onClick={() => copyEmails('NEWLINE')} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><ListEnd className="h-3 w-3" /> Una per riga</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Area Filtri Avanzati */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap gap-4 items-end shadow-sm">
                <div className="flex items-center gap-2 w-full text-gray-600 font-semibold mb-1">
                    <Filter className="h-4 w-4 text-gray-400" />
                    Filtra Risultati ({filteredData.length} Contatti)
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">Data Scarto</label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700"
                    >
                        <option value="ALL">Qualsiasi Data</option>
                        <option value="0">Oggi</option>
                        <option value="7">Ultimi 7 Giorni</option>
                        <option value="30">Ultimi 30 Giorni</option>
                        <option value="CUSTOM">Intervallo Cust.</option>
                    </select>
                </div>

                {dateRange === "CUSTOM" && (
                    <div className="flex gap-2 animate-in fade-in">
                        <div className="flex flex-col gap-1">
                            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md" />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">Motivo (Tag)</label>
                    <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700">
                        <option value="ALL">Tutti</option>
                        {reasons.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">Funnel Origine</label>
                    <select value={funnelFilter} onChange={(e) => setFunnelFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700">
                        <option value="ALL">Tutti</option>
                        {funnels.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">Scartato Da (GDO)</label>
                    <select value={gdoFilter} onChange={(e) => setGdoFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700">
                        <option value="ALL">Chiunque</option>
                        {gdos.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                </div>
            </div>

            {/* Tabella Dati */}
            <div className="bg-white border flex-1 border-gray-200 shadow-sm rounded-xl overflow-hidden">
                <div className="overflow-x-auto text-sm">
                    <table className="w-full text-left border-collapse min-w-max">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium select-none sticky top-0 shadow-sm">
                            <tr>
                                <th className="px-6 py-4">Email Contatto</th>
                                <th className="px-4 py-4">Funnel</th>
                                <th className="px-4 py-4">Motivo Scarto</th>
                                <th className="px-4 py-4">Quando</th>
                                <th className="px-4 py-4">Fattore GDO</th>
                                <th className="px-6 py-4">Annotazioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredData.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-gray-500 italic">
                                        Nessun lead scartato combacia con la ricerca e i filtri.
                                    </td>
                                </tr>
                            ) : filteredData.map(lead => (
                                <tr key={lead.id} className="hover:bg-red-50/20 transition-colors">
                                    <td className="px-6 py-4 font-bold text-gray-800 tracking-wide">
                                        {lead.email}
                                    </td>
                                    <td className="px-4 py-4 text-gray-500">
                                        <span className="bg-gray-100 border px-2 py-0.5 rounded text-xs truncate max-w-[120px] inline-block" title={lead.funnel}>
                                            {lead.funnel}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="text-red-700 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full text-xs font-semibold shadow-sm inline-block">
                                            {lead.reason}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-gray-500">
                                        <div className="flex flex-col">
                                            <span>{new Date(lead.discardDate).toLocaleDateString('it-IT')}</span>
                                            <span className="text-xs text-gray-400 font-mono">{new Date(lead.discardDate).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 font-medium text-gray-700">
                                        {lead.discardedBy}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500 text-xs truncate max-w-xs" title={lead.note}>
                                        {lead.note || <span className="text-gray-300 italic">n.a.</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    )
}
