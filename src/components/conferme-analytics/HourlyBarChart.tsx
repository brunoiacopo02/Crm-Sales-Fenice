import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

export function HourlyBarChart({ data }: { data: ConfermeAnalyticsResult }) {
    const hours = data.hourlyDistribution;
    const max = Math.max(0.001, ...hours.map(h => h.mediaApp));
    const peakHour = data.hero.peakHour;

    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-card">
            <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide mb-3">App/giorno per slot orario</div>
            <div className="space-y-1.5">
                {hours.map(({ hour, mediaApp }) => {
                    const w = (mediaApp / max) * 100;
                    const isPeak = hour === peakHour;
                    return (
                        <div key={hour} className="flex items-center gap-3 text-xs">
                            <div className="w-12 text-ash-500 font-mono">{String(hour).padStart(2, '0')}:00</div>
                            <div className="flex-1 h-5 bg-ash-50 rounded overflow-hidden">
                                <div
                                    className={`h-full ${isPeak ? 'bg-rose-500' : 'bg-sky-400'} transition-all`}
                                    style={{ width: `${w}%` }}
                                />
                            </div>
                            <div className="w-12 text-right font-bold text-ash-800">{mediaApp.toFixed(1)}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
