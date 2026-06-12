import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getConfermeTlOverview } from "@/app/actions/confermeKpiActions"
import { isConfermeTl } from "@/lib/confermeTl"
import { Target, Users, Handshake, Trophy, Euro, CalendarCheck } from "lucide-react"

export const dynamic = "force-dynamic"

function fmtPct(v: number | null): string {
    if (v === null || !isFinite(v)) return "—"
    return `${Math.round(v * 100)}%`
}

function fmtEur(v: number): string {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v)
}

export default async function PanoramicaTlConfermePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    const authorized = !!user && (
        ["ADMIN", "MANAGER"].includes(role || "")
        || (role === "CONFERME" && isConfermeTl(user.email))
    )
    if (!authorized) redirect("/")

    const data = await getConfermeTlOverview()
    if (!data.success) {
        return (
            <div className="max-w-5xl mx-auto p-6 text-sm text-red-600">
                Errore caricamento panoramica: {data.error}
            </div>
        )
    }

    const kpis = [
        { key: "pctConferme", label: "% Conferme", value: fmtPct(data.month.pctConferme), sub: `${data.month.confermati} confermati su ${data.month.fissati} fissati`, icon: Target },
        { key: "pctPresenze", label: "% Presenze", value: fmtPct(data.month.pctPresenze), sub: `${data.month.presentati} presentati su ${data.month.confermati} confermati`, icon: Users },
        { key: "pctChiusure", label: "% Chiusure", value: fmtPct(data.month.pctChiusure), sub: `${data.month.chiusure} chiusure su ${data.month.presentati} presentati`, icon: Handshake },
        { key: "chiusureSett", label: "Chiusure settimana", value: String(data.week.chiusure), sub: "lun-dom corrente", icon: Trophy },
        { key: "fatturatoSett", label: "Fatturato settimana", value: fmtEur(data.week.fatturatoEur), sub: `mese: ${fmtEur(data.month.fatturatoEur)}`, icon: Euro },
    ]

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">Panoramica TL Conferme</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Funnel del mese corrente (appuntamenti schedulati nel mese) + chiusure della settimana. Azienda attiva: quella selezionata in alto.
                </p>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {kpis.map(k => (
                    <div key={k.key} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                            <k.icon className="h-3.5 w-3.5 text-brand-orange" /> {k.label}
                        </div>
                        <div className="mt-1 text-2xl font-bold text-ash-800">{k.value}</div>
                        <div className="mt-0.5 text-[11px] text-ash-400">{k.sub}</div>
                    </div>
                ))}
            </div>

            {/* Breakdown per operatore */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ash-700">
                    <CalendarCheck className="h-3.5 w-3.5 text-brand-orange" /> Operatori (mese corrente)
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                <th className="py-2 pr-4">Operatore</th>
                                <th className="py-2 pr-4 text-right">Confermati</th>
                                <th className="py-2 pr-4 text-right">Scartati</th>
                                <th className="py-2 pr-4 text-right">Chiusure</th>
                                <th className="py-2 text-right">Fatturato</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.perOperator.map(op => (
                                <tr key={op.userId} className="border-b border-gray-100 last:border-0">
                                    <td className="py-2 pr-4 font-medium text-ash-800">{op.name}</td>
                                    <td className="py-2 pr-4 text-right font-semibold text-emerald-600">{op.confermati}</td>
                                    <td className="py-2 pr-4 text-right text-rose-600">{op.scartati}</td>
                                    <td className="py-2 pr-4 text-right font-semibold text-ash-800">{op.chiusure}</td>
                                    <td className="py-2 text-right text-ash-600">{fmtEur(op.fatturatoEur)}</td>
                                </tr>
                            ))}
                            {data.perOperator.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-4 text-center text-xs text-ash-400">Nessun operatore Conferme attivo.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
