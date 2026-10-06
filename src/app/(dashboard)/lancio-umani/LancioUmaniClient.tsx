"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, FlaskConical } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import {
    percentuale,
    type LancioUmaniDati,
    type LeadLancioUmani,
    type StatsLancioUmani,
} from "@/lib/humanTestCohort"

// Stessa scheda contatto della ricerca in Topbar (caricata solo al primo clic).
const ContactDrawer = dynamic(
    () => import("@/components/ContactDrawer").then(mod => mod.ContactDrawer),
    { ssr: false },
)

type Filtro = "tutti" | "NEW" | "IN_PROGRESS" | "APPOINTMENT" | "REJECTED"

const FILTRI: { value: Filtro; label: string }[] = [
    { value: "tutti", label: "Tutti" },
    { value: "NEW", label: "Da chiamare" },
    { value: "IN_PROGRESS", label: "In lavorazione" },
    { value: "APPOINTMENT", label: "Appuntamento" },
    { value: "REJECTED", label: "Scartati" },
]

const STATO: Record<string, { label: string; classe: string }> = {
    NEW: { label: "Da chiamare", classe: "bg-ash-100 text-ash-700" },
    IN_PROGRESS: { label: "In lavorazione", classe: "bg-amber-100 text-amber-800" },
    APPOINTMENT: { label: "Appuntamento", classe: "bg-emerald-100 text-emerald-800" },
    REJECTED: { label: "Scartato", classe: "bg-red-100 text-red-700" },
}

/** Le voci del funnel: valore, base della percentuale e come si legge la base. */
type Voce = {
    key: keyof StatsLancioUmani
    label: string
    base?: (s: StatsLancioUmani) => number
    baseLabel?: string
    euro?: boolean
}

const VOCI: Voce[] = [
    { key: "leadDati", label: "Lead dati" },
    { key: "chiamati", label: "Chiamati", base: s => s.leadDati, baseLabel: "dei lead" },
    { key: "risposto", label: "Hanno risposto", base: s => s.leadDati, baseLabel: "dei lead" },
    { key: "appuntamenti", label: "Appuntamenti fissati", base: s => s.chiamati, baseLabel: "dei chiamati" },
    { key: "presentati", label: "Presentati", base: s => s.appuntamenti, baseLabel: "dei fissati" },
    { key: "vendite", label: "Vendite", base: s => s.leadDati, baseLabel: "dei lead" },
    { key: "venduto", label: "Venduto", euro: true },
    { key: "scartati", label: "Scartati", base: s => s.leadDati, baseLabel: "dei lead" },
    { key: "daLavorare", label: "Ancora da chiamare", base: s => s.leadDati, baseLabel: "dei lead" },
    { key: "daRichiamare", label: "Da richiamare", base: s => s.leadDati, baseLabel: "dei lead" },
]

const euro = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const quando = (iso: string | null) => (iso ? format(new Date(iso), "d MMM HH:mm", { locale: it }) : "—")
const etichettaGdo = (codice: number | null, nome: string | null) =>
    codice ? `GDO ${codice}` : (nome ?? "Non assegnato")

function valore(v: Voce, s: StatsLancioUmani) {
    return v.euro ? euro(s[v.key]) : s[v.key].toLocaleString("it-IT")
}

function perc(v: Voce, s: StatsLancioUmani) {
    if (!v.base) return null
    const p = percentuale(s[v.key], v.base(s))
    return p === null ? null : `${p}%`
}

/** A che punto e' il lead dopo il GDO: venditore, poi conferme, poi scarto o richiamo. */
function esito(l: LeadLancioUmani) {
    if (l.salespersonOutcome) {
        const importo = l.closeAmountEur ? ` · ${euro(l.closeAmountEur)}` : ""
        return `Venditore: ${l.salespersonOutcome}${importo}`
    }
    if (l.confirmationsOutcome) return `Conferme: ${l.confirmationsOutcome}`
    if (l.status === "REJECTED") return l.discardReason ?? "Scartato"
    if (l.status === "IN_PROGRESS" && l.recallDate) return `Richiamo ${quando(l.recallDate)}`
    return "—"
}

/**
 * Test lancio umani (PO 06/10/2026): i lead del lancio che hanno visto la live,
 * lavorati solo dai GDO 106 e 119. Lo staff vede il confronto fra i due, il
 * GDO solo i suoi numeri e la sua lista.
 */
export function LancioUmaniClient({ dati, isStaff }: { dati: LancioUmaniDati; isStaff: boolean }) {
    const router = useRouter()
    const [filtro, setFiltro] = useState<Filtro>("tutti")
    const [minutiDesc, setMinutiDesc] = useState(true)
    const [leadAperto, setLeadAperto] = useState<string | null>(null)

    const conteggi = useMemo(() => {
        const c: Record<string, number> = { tutti: dati.leads.length }
        for (const l of dati.leads) c[l.status] = (c[l.status] ?? 0) + 1
        return c
    }, [dati.leads])

    const visibili = useMemo(() => {
        const lista = filtro === "tutti" ? dati.leads : dati.leads.filter(l => l.status === filtro)
        // Senza minuti in fondo, in entrambi gli ordini.
        return [...lista].sort((a, b) => {
            if (a.zoomMinuti === null) return b.zoomMinuti === null ? 0 : 1
            if (b.zoomMinuti === null) return -1
            return minutiDesc ? b.zoomMinuti - a.zoomMinuti : a.zoomMinuti - b.zoomMinuti
        })
    }, [dati.leads, filtro, minutiDesc])

    const s = dati.totale
    const card = VOCI.filter(v => v.key !== "daRichiamare" && v.key !== "venduto")

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-2 flex items-center gap-2">
                <FlaskConical className="h-6 w-6 text-brand-orange" />
                <h1 className="text-2xl font-bold text-ash-900">Test lancio umani</h1>
            </div>
            <p className="mb-6 text-sm text-ash-600">
                400 lead del lancio Web Developer AI che hanno visto la live, lavorati solo dai GDO 106 e 119:
                il bot non li contatta. Contano anche nelle KPI normali; qui li vedi da soli.
            </p>

            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                {card.map(v => (
                    <div key={v.key} className="rounded-xl border border-ash-200/60 bg-white p-3 shadow-soft">
                        <div className="text-xs font-semibold text-ash-500">{v.label}</div>
                        <div className="mt-1 text-2xl font-bold text-ash-900">{valore(v, s)}</div>
                        {perc(v, s) && (
                            <div className="text-xs text-ash-500">{perc(v, s)} {v.baseLabel}</div>
                        )}
                    </div>
                ))}
            </div>
            <div className="mb-6 flex flex-wrap gap-3 text-sm text-ash-700">
                <div className="rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800">Venduto: {euro(s.venduto)}</div>
                <div className="rounded-lg bg-amber-50 px-3 py-1.5 font-semibold text-amber-800">Da richiamare: {s.daRichiamare}</div>
            </div>

            {isStaff && dati.perGdo.length > 0 && (
                <div className="mb-8 overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                    <table className="min-w-full text-sm">
                        <thead className="bg-ash-50 text-left text-xs font-bold uppercase tracking-wide text-ash-600">
                            <tr>
                                <th className="px-3 py-2">Confronto</th>
                                {dati.perGdo.map(g => (
                                    <th key={g.gdoUserId ?? "nessuno"} className="px-3 py-2 text-right">{etichettaGdo(g.gdoCode, g.gdoNome)}</th>
                                ))}
                                <th className="px-3 py-2 text-right">Totale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {VOCI.map(v => (
                                <tr key={v.key} className="border-t border-ash-100">
                                    <td className="px-3 py-2 font-semibold text-ash-800">
                                        {v.label}
                                        {v.baseLabel && <span className="ml-1 text-xs font-normal text-ash-500">(% {v.baseLabel})</span>}
                                    </td>
                                    {[...dati.perGdo, { ...s, gdoUserId: "__totale" }].map(g => (
                                        <td key={g.gdoUserId ?? "nessuno"} className="whitespace-nowrap px-3 py-2 text-right text-ash-900">
                                            <span className="font-bold">{valore(v, g)}</span>
                                            {perc(v, g) && <span className="ml-1.5 text-xs text-ash-500">{perc(v, g)}</span>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    {FILTRI.map(f => (
                        <button
                            key={f.value}
                            onClick={() => setFiltro(f.value)}
                            className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${filtro === f.value
                                ? "bg-brand-orange text-white"
                                : "bg-white text-ash-700 ring-1 ring-ash-200 hover:bg-ash-50"}`}
                        >
                            {f.label} <span className="opacity-70">{conteggi[f.value] ?? 0}</span>
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => setMinutiDesc(d => !d)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ash-700 ring-1 ring-ash-200 transition-colors hover:bg-ash-50"
                >
                    {minutiDesc ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                    Minuti di live: {minutiDesc ? "prima chi ne ha visti di più" : "prima chi ne ha visti di meno"}
                </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                <table className="min-w-full text-sm">
                    <thead className="bg-ash-50 text-left text-xs font-bold uppercase tracking-wide text-ash-600">
                        <tr>
                            <th className="px-3 py-2">Nome</th>
                            <th className="px-3 py-2">Telefono</th>
                            {isStaff && <th className="px-3 py-2">GDO</th>}
                            <th className="px-3 py-2 text-right">Minuti live</th>
                            <th className="px-3 py-2">Stato</th>
                            <th className="px-3 py-2 text-right">Chiamate</th>
                            <th className="px-3 py-2">Ultima chiamata</th>
                            <th className="px-3 py-2">Appuntamento</th>
                            <th className="px-3 py-2">Esito</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibili.length === 0 && (
                            <tr><td colSpan={isStaff ? 9 : 8} className="px-3 py-8 text-center text-ash-500">Nessun lead in questa vista.</td></tr>
                        )}
                        {visibili.map(l => {
                            const stato = STATO[l.status] ?? { label: l.status, classe: "bg-ash-100 text-ash-700" }
                            return (
                                <tr key={l.id} className="border-t border-ash-100">
                                    <td className="px-3 py-2">
                                        <button
                                            onClick={() => setLeadAperto(l.id)}
                                            className="text-left font-semibold text-ash-900 hover:text-brand-orange hover:underline"
                                        >
                                            {l.nome}
                                        </button>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-ash-800">{l.telefono}</td>
                                    {isStaff && <td className="whitespace-nowrap px-3 py-2 text-ash-600">{etichettaGdo(l.gdoCode, l.gdoNome)}</td>}
                                    <td className="px-3 py-2 text-right font-semibold text-ash-900">{l.zoomMinuti ?? "—"}</td>
                                    <td className="px-3 py-2">
                                        <div className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${stato.classe}`}>{stato.label}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right text-ash-800">{l.callCount}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-ash-600">{quando(l.lastCallDate)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-ash-600">{quando(l.appointmentDate)}</td>
                                    <td className="px-3 py-2 text-ash-600">{esito(l)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {leadAperto && (
                <ContactDrawer
                    isOpen
                    leadId={leadAperto}
                    onClose={() => { setLeadAperto(null); router.refresh() }}
                />
            )}
        </div>
    )
}
