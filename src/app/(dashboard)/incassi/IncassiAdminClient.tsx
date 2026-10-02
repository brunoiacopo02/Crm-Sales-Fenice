"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { AdminMonth } from "@/lib/gestionale/queries"
import { aggiornaIncassiAdesso } from "@/app/actions/gestionaleSyncActions"
import { MonthSelect } from "@/components/gestionale/MonthSelect"
import { AtRiskTable } from "@/components/gestionale/AtRiskTable"
import { formatEur, formatDate } from "@/components/gestionale/format"

type RunInfo = { status: string; startedAt: string; finishedAt: string | null; error: string | null; warnings: string[] } | null

const RUN_LABEL: Record<string, string> = { ok: "riuscito", running: "in corso", error: "fallito", skipped: "saltato" }

function Tile({ label, sub, value, tone = "text-ash-800" }: { label: string; sub?: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-4">
            <div className="text-xs uppercase text-ash-500">{label}</div>
            {sub && <div className="text-xs text-ash-400">{sub}</div>}
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
        </div>
    )
}

export default function IncassiAdminClient({ mese, months, data, lastRun, hasSynced }: { mese: string; months: string[]; data: AdminMonth; lastRun: RunInfo; hasSynced: boolean }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [msg, setMsg] = useState<string | null>(null)
    const [seller, setSeller] = useState<string | null>(null)
    const [riskSeller, setRiskSeller] = useState<string>("")

    const refresh = () => startTransition(async () => {
        setMsg(null)
        try {
            const r = await aggiornaIncassiAdesso()
            setMsg(r.status === "ok" ? `Aggiornato: ${r.inserted} nuovi, ${r.updated} aggiornati, ${r.deleted} eliminati.`
                : r.status === "skipped" ? `Non eseguito: ${r.reason}` : `Errore: ${r.error}`)
            router.refresh()
        } catch {
            setMsg("Errore: aggiornamento non riuscito")
        }
    })

    const totImponibile = data.sellers.reduce((s, r) => s + r.summary.imponibileCents, 0)
    const totMulte = data.multeCents
    const scaduto = data.atRisk.reduce((s, r) => s + r.scadutoCents, 0)
    const riskRows = riskSeller ? data.atRisk.filter(r => (r.venditoreCode ?? "") === riskSeller) : data.atRisk
    const riskSellers = Array.from(new Set(data.atRisk.map(r => r.venditoreCode ?? ""))).sort()
    const sellerIncassi = seller ? data.incassi.filter(i => i.venditoreCode === seller) : []

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Incassi</h1>
                    <div className="mt-1 text-sm text-ash-500">
                        Dati dal gestionale amministrazione.{" "}
                        {lastRun ? `Ultimo aggiornamento: ${new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" })} (${RUN_LABEL[lastRun.status] ?? lastRun.status})` : "Mai aggiornato."}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <MonthSelect months={months} value={mese} />
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={pending}
                        className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {pending ? "Aggiorno…" : "Aggiorna adesso"}
                    </button>
                </div>
            </div>

            {msg && <div className="rounded-md border border-ash-200 bg-ash-50 px-3 py-2 text-sm text-ash-700">{msg}</div>}
            {lastRun?.status === "error" && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    L&apos;ultimo aggiornamento è fallito: {lastRun.error}. Restano visibili i dati dell&apos;ultimo aggiornamento riuscito.
                </div>
            )}
            {lastRun && lastRun.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{lastRun.warnings.join(" · ")}</div>
            )}

            {!data.hasData ? (
                <div className="rounded-xl border border-ash-200 bg-white p-8 text-center text-ash-500">
                    Dati dal gestionale non ancora disponibili per questo mese.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Tile label="Incassato del mese" sub="per data incasso" value={formatEur(data.cashCents)} />
                        <Tile label="Commissioni (imponibile)" value={formatEur(totImponibile)} />
                        <Tile label="Multe venditori" value={formatEur(totMulte)} tone="text-red-700" />
                        <Tile label={`A rischio (${data.atRisk.length})`} value={formatEur(scaduto)} tone="text-red-700" />
                    </div>

                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-3 font-semibold text-ash-800">Per venditore</h2>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-ash-200 text-left text-xs uppercase text-ash-500">
                                        <th className="py-2 pr-4">Venditore</th>
                                        <th className="py-2 pr-4 text-right">Incassato (prospetto compensi)</th>
                                        <th className="py-2 pr-4 text-right">Comm. lorda</th>
                                        <th className="py-2 pr-4 text-right">Imponibile</th>
                                        <th className="py-2 pr-4 text-right">Multe</th>
                                        <th className="py-2 text-right">Netto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.sellers.map(s => (
                                        <tr key={s.venditoreCode} className="border-b border-ash-100">
                                            <td className="py-2 pr-4">
                                                <button type="button" onClick={() => setSeller(seller === s.venditoreCode ? null : s.venditoreCode)} className="font-medium text-brand-orange hover:underline">
                                                    {s.venditoreCode}
                                                </button>
                                            </td>
                                            <td className="py-2 pr-4 text-right">{formatEur(s.summary.incassatoCents)}</td>
                                            {s.missingCommission ? (
                                                <td className="py-2 pr-4 text-right italic text-ash-500" colSpan={2}>non calcolata</td>
                                            ) : (
                                                <>
                                                    <td className="py-2 pr-4 text-right">{formatEur(s.summary.lordaCents)}</td>
                                                    <td className="py-2 pr-4 text-right">{formatEur(s.summary.imponibileCents)}</td>
                                                </>
                                            )}
                                            <td className="py-2 pr-4 text-right text-red-700">{formatEur(s.summary.multeCents)}</td>
                                            <td className="py-2 text-right font-semibold">{s.missingCommission ? "—" : formatEur(s.summary.nettoCents)}</td>
                                        </tr>
                                    ))}
                                    <tr className="text-ash-600">
                                        <td className="py-2 pr-4">DIREZIONE</td>
                                        <td className="py-2 pr-4 text-right">{formatEur(data.direzioneCashCents)}</td>
                                        <td className="py-2 text-right" colSpan={4}>senza commissione</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-2 text-xs text-ash-500">
                            La somma delle righe può differire dalla tessera: il prospetto compensi include rate di contratti firmati prima di settembre.
                        </div>
                        {seller && (
                            <div className="mt-4">
                                <h3 className="mb-2 text-sm font-semibold text-ash-700">Incassi di {seller} con data nel mese</h3>
                                {sellerIncassi.length === 0 ? <div className="text-sm text-ash-500">Nessun incasso con data in questo mese.</div> : (
                                    <ul className="divide-y divide-ash-100 text-sm">
                                        {sellerIncassi.map(i => (
                                            <li key={i.id} className="flex justify-between py-1.5">
                                                <div>{formatDate(i.data)} · {i.cliente} · {i.voce ?? "—"}{i.stato === "stornato" ? " (stornato)" : ""}</div>
                                                <div className={i.importoCents < 0 ? "text-red-700" : ""}>{formatEur(i.importoCents)}</div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}

            {hasSynced && (
                <div className="rounded-xl border border-ash-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-semibold text-ash-800">Contratti a rischio</h2>
                        <select value={riskSeller} onChange={e => setRiskSeller(e.target.value)} className="rounded-md border border-ash-200 px-2 py-1 text-sm">
                            <option value="">Tutti i venditori</option>
                            {riskSellers.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                        </select>
                    </div>
                    <AtRiskTable rows={riskRows} showSeller />
                </div>
            )}
        </div>
    )
}
