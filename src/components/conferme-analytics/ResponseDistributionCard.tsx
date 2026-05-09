import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

const ROWS = [
    { key: "pctRisp1" as const, label: "Risponde alla 1ª", color: "bg-emerald-500" },
    { key: "pctRisp2" as const, label: "Risponde alla 2ª", color: "bg-sky-500" },
    { key: "pctRisp3" as const, label: "Risponde alla 3ª", color: "bg-amber-500" },
    { key: "pctMai" as const, label: "Mai risponde (3 NR)", color: "bg-rose-500" },
];

export function ResponseDistributionCard({ data }: { data: ConfermeAnalyticsResult }) {
    const r = data.responseDistribution;
    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-card">
            <div className="flex items-baseline justify-between mb-3">
                <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide">% risposta per tentativo</div>
                <div className="text-xs text-ash-400">{r.denom} lead nel periodo</div>
            </div>
            <div className="space-y-2">
                {ROWS.map(row => {
                    const pct = (r[row.key] || 0) * 100;
                    return (
                        <div key={row.key}>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-ash-700">{row.label}</span>
                                <span className="font-bold text-ash-800">{pct.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-2 bg-ash-100 rounded-full overflow-hidden">
                                <div className={`h-full ${row.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
