"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts"
import type { VenditorePerformanceData } from "@/app/actions/venditorePerformanceActions"
import { Eye, EyeOff } from "lucide-react"
import { useHideAmounts, HIDDEN_AMOUNT } from "@/lib/venditore/hideAmounts"

function Kpi({ label, value, sub, action }: { label: string; value: string; sub?: string; action?: React.ReactNode }) {
    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
                {action}
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
    )
}

export function VenditorePerformanceView({ data }: { data: VenditorePerformanceData }) {
    const { closing: c, followUpFunnel: f, attemptsToClose: a } = data
    const [hideAmounts, toggleHideAmounts] = useHideAmounts()
    const eur = (n: number) => hideAmounts ? `€${HIDDEN_AMOUNT}` : `€${n.toLocaleString('it-IT')}`
    // Closing rate di coorte: denominatore = presenze del mese. Le trattative ancora
    // aperte stanno nel denominatore, quindi a metà mese il rate è fisiologicamente
    // basso: senza dirlo sembra un crollo.
    const closingSub = c.inLavorazione > 0
        ? `${c.chiusi}/${c.presenze} presenze · ${c.inLavorazione} in lavorazione`
        : `${c.chiusi}/${c.presenze} presenze`
    return (
        <div className="space-y-6">
            {/* KPI principali */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Closing rate" value={`${c.closingPct}%`} sub={closingSub} />
                <Kpi
                    label="Firmato"
                    value={eur(c.fatturato)}
                    sub={`Ticket medio ${eur(c.ticketMedio)}`}
                    action={
                        <button
                            type="button"
                            onClick={toggleHideAmounts}
                            title={hideAmounts ? "Mostra gli importi" : "Nascondi gli importi"}
                            aria-label={hideAmounts ? "Mostra gli importi" : "Nascondi gli importi"}
                            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                        >
                            {hideAmounts ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    }
                />
                <Kpi label="Conversione follow-up" value={`${f.conversionPct}%`} sub={`${f.closed}/${f.enteredFollowUp} chiusi da richiamo`} />
                <Kpi label="Tentativi medi a chiusura" value={`${a.avgAttempts}`} sub={`${a.firstShotPct}% chiusi al 1° colpo`} />
            </div>

            {/* Follow-up: lead entrati / chiusi / scaduti */}
            <div className="grid grid-cols-3 gap-3">
                <Kpi label="Lead a follow-up" value={`${f.enteredFollowUp}`} />
                <Kpi label="Chiusi da follow-up" value={`${f.closed}`} />
                <Kpi label="Follow-up scaduti (ora)" value={`${data.overdueFollowUps}`} sub="da lavorare" />
            </div>

            {/* Motivo top */}
            {data.topReason && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-orange-700 uppercase tracking-wider">Obiezione più frequente</div>
                    <div className="text-lg font-bold text-orange-900 mt-1">{data.topReason.reason} <span className="text-orange-600">({data.topReason.pct}%)</span></div>
                </div>
            )}

            {/* Distribuzione motivi */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Motivi di non chiusura</h3>
                {data.reasonDistribution.length ? (
                    <ResponsiveContainer width="100%" height={Math.max(160, data.reasonDistribution.length * 40)}>
                        <BarChart data={data.reasonDistribution} layout="vertical" margin={{ left: 40, right: 20 }}>
                            <XAxis type="number" hide />
                            <YAxis type="category" dataKey="reason" width={180} tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(v: number | undefined, _n, p: any) => [`${v ?? 0} (${p.payload.pct}%)`, 'Conteggio']} />
                            <Bar dataKey="count" fill="#f97316" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="text-sm text-gray-400 py-6 text-center">Nessun dato nel periodo.</div>
                )}
            </div>

            {/* Trend mensile */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Trend (ultimi 6 mesi)</h3>
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.trend} margin={{ left: 0, right: 20 }}>
                        <XAxis dataKey="yearMonth" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} unit="%" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="closingPct" name="Closing %" stroke="#16a34a" strokeWidth={2} />
                        <Line type="monotone" dataKey="followUpConversionPct" name="Conv. follow-up %" stroke="#f97316" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
