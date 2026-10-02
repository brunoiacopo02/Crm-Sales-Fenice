import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { FIRST_MONTH, monthsFrom, pickMonth } from "@/lib/gestionale/metrics"
import { loadSellerMonth, loadLastOkAt } from "@/lib/gestionale/queries"
import { MonthSelect } from "@/components/gestionale/MonthSelect"
import { AtRiskTable } from "@/components/gestionale/AtRiskTable"
import { formatEur, formatDate } from "@/components/gestionale/format"

export const dynamic = "force-dynamic"

function Tile({ label, value, tone = "text-ash-800" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-4">
            <div className="text-xs uppercase text-ash-500">{label}</div>
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
        </div>
    )
}

export default async function MieiIncassiPage({ searchParams }: { searchParams: Promise<{ mese?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "VENDITORE") redirect("/unauthorized")

    const current = currentYearMonthRome()
    const mese = pickMonth((await searchParams).mese, current)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    const [view, lastOk] = await Promise.all([loadSellerMonth(user.id, mese, today), loadLastOkAt()])
    const s = view.summary

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">I miei incassi</h1>
                    <div className="mt-1 text-sm text-ash-500">
                        {lastOk ? `Aggiornato al ${lastOk.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}` : "Dati non ancora disponibili"}
                    </div>
                </div>
                <MonthSelect months={monthsFrom(FIRST_MONTH, current)} value={mese} />
            </div>

            {!view.hasData ? (
                <div className="rounded-xl border border-ash-200 bg-white p-8 text-center text-ash-500">
                    Dati dal gestionale non ancora disponibili per questo mese.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Tile label="Incassato" value={formatEur(s.incassatoCents)} />
                        <Tile label="Commissione" value={formatEur(s.imponibileCents)} />
                        <Tile label="Multe del mese" value={formatEur(s.multeCents)} tone="text-red-700" />
                        <Tile label="Netto" value={formatEur(s.nettoCents)} tone="text-emerald-700" />
                    </div>
                    <div className="text-xs text-ash-500">
                        Commissione = 10% dell&apos;incassato senza IVA, calcolata dall&apos;amministrazione. Le multe sono quelle registrate nel CRM per questo mese.
                    </div>

                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-3 font-semibold text-ash-800">Incassi che maturano commissione questo mese</h2>
                        {view.incassi.length === 0 ? <div className="text-sm text-ash-500">Nessun incasso.</div> : (
                            <ul className="divide-y divide-ash-100 text-sm">
                                {view.incassi.map(i => (
                                    <li key={i.id} className="flex justify-between py-1.5">
                                        <div>
                                            {formatDate(i.data)} · {i.cliente} · {i.voce ?? "—"}
                                            {!i.contaCommissione && <span className="ml-1 text-xs text-ash-400">(non conta)</span>}
                                        </div>
                                        <div className={i.importoCents < 0 ? "text-red-700" : ""}>{formatEur(i.importoCents)}</div>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {view.commissionableCents !== s.incassatoCents && (
                            <div className="mt-2 text-xs text-ash-500">
                                Il totale dell&apos;amministrazione ({formatEur(s.incassatoCents)}) può differire dalla somma qui sopra ({formatEur(view.commissionableCents)}): fa fede l&apos;amministrazione.
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="rounded-xl border border-ash-200 bg-white p-4">
                <h2 className="mb-3 font-semibold text-ash-800">I miei contratti a rischio</h2>
                <AtRiskTable rows={view.atRisk} showSeller={false} />
            </div>
        </div>
    )
}
