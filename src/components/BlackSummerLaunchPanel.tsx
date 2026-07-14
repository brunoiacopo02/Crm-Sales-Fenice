import { Sun, PhoneCall, CalendarCheck, BadgeCheck, Trophy } from "lucide-react"
import type { BlackSummerLaunchStats, BlackSummerStageStats } from "@/lib/blackSummerStats"

function pct(num: number, den: number): string {
    if (den <= 0) return '0%'
    return `${Math.round((num / den) * 100)}%`
}

function eur(amount: number): string {
    return amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function StageRow({ label, stats, denomChiamati }: { label: string; stats: BlackSummerStageStats; denomChiamati: number }) {
    const cells = [
        { icon: PhoneCall, name: 'Chiamati ≥1', value: stats.chiamati, sub: denomChiamati > 0 ? `${pct(stats.chiamati, denomChiamati)} degli assegnati` : null, color: 'text-sky-600' },
        { icon: CalendarCheck, name: 'Fissati', value: stats.fissati, sub: `${pct(stats.fissati, stats.chiamati)} dei chiamati`, color: 'text-amber-600' },
        { icon: BadgeCheck, name: 'Confermati', value: stats.confermati, sub: `${pct(stats.confermati, stats.fissati)} dei fissati`, color: 'text-emerald-600' },
        { icon: Trophy, name: 'Chiusi', value: stats.chiusi, sub: `${pct(stats.chiusi, stats.confermati)} dei confermati`, color: 'text-purple-600', extra: eur(stats.fatturatoEur) },
    ] as Array<{ icon: typeof Trophy; name: string; value: number; sub: string | null; color: string; extra?: string }>
    return (
        <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">{label}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {cells.map((c) => (
                    <div key={c.name} className="bg-white rounded-lg border border-amber-100 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ash-500">
                            <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
                            {c.name}
                        </div>
                        <div className="flex items-baseline gap-2 mt-1">
                            <div className="text-2xl font-black text-ash-900">{c.value}</div>
                            {c.extra && <div className="text-sm font-bold text-emerald-700">{c.extra}</div>}
                        </div>
                        {c.sub && <div className="text-[11px] text-ash-500 mt-0.5">{c.sub}</div>}
                    </div>
                ))}
            </div>
        </div>
    )
}

export function BlackSummerLaunchPanel({ stats }: { stats: BlackSummerLaunchStats }) {
    if (stats.totale === 0) return null
    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-2xl border-2 border-amber-300 shadow-sm p-5 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Sun className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Monitor Lancio Black Summer</h2>
                        <div className="text-xs text-ash-500">Funnel &quot;Black Summer&quot; — dal pool e caricati a mano.</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Totale lancio: <strong className="text-ash-900">{stats.totale}</strong></div>
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Assegnati: <strong className="text-ash-900">{stats.assegnati}</strong></div>
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Nel pool: <strong className="text-ash-900">{stats.poolResiduo}</strong></div>
                </div>
            </div>
            <StageRow label="Oggi" stats={stats.oggi} denomChiamati={0} />
            <StageRow label="Totale lancio" stats={stats.totaleLancio} denomChiamati={stats.assegnati} />
        </div>
    )
}
