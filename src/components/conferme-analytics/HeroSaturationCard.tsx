import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

function fmtMin(min: number): string {
    return `${Math.round(min)} min`;
}

export function HeroSaturationCard({ data }: { data: ConfermeAnalyticsResult }) {
    const pct = Math.round(data.hero.saturation * 100);
    const barWidth = Math.min(100, pct);
    const colorBar =
        pct < 80 ? "bg-emerald-500"
        : pct <= 100 ? "bg-amber-500"
        : "bg-rose-500";

    const peakLabel = data.hero.peakHour !== null
        ? `${data.hero.peakOperators.toFixed(1)} alle ${String(data.hero.peakHour).padStart(2, '0')}:00`
        : "—";

    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-6 shadow-card">
            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide">Capacità team</div>
                    <div className="text-2xl font-bold text-ash-800">{fmtMin(data.hero.capacityMin)}</div>
                    <div className="text-xs text-ash-400 mt-1">
                        {data.meta.nOperatoriAttivi} operatori × 6h
                    </div>
                </div>
                <div>
                    <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide">Fabbisogno</div>
                    <div className="text-2xl font-bold text-ash-800">{fmtMin(data.hero.demandMin)}</div>
                    <div className="text-xs text-ash-400 mt-1">media giornaliera nel periodo</div>
                </div>
            </div>

            <div className="mt-5">
                <div className="flex items-baseline justify-between mb-1.5">
                    <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide">Saturazione</div>
                    <div className="text-2xl font-bold text-ash-800">{pct}%</div>
                </div>
                <div className="w-full h-3 bg-ash-100 rounded-full overflow-hidden">
                    <div className={`h-full ${colorBar} transition-all`} style={{ width: `${barWidth}%` }} />
                </div>
            </div>

            <div className="mt-5 grid md:grid-cols-2 gap-4 text-sm">
                <div>
                    <span className="text-ash-500">Servono giornata media: </span>
                    <span className="font-bold text-ash-800">{data.hero.operatorsFullDay} operatori</span>
                </div>
                <div>
                    <span className="text-ash-500">Picco contemporaneo: </span>
                    <span className="font-bold text-ash-800">{peakLabel}</span>
                </div>
            </div>
        </div>
    );
}
