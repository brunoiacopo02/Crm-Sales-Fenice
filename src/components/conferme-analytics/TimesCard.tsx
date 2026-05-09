import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

function fmtMMSS(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function TimesCard({ data }: { data: ConfermeAnalyticsResult }) {
    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-card">
            <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide mb-2">Tempo medio chiamata</div>
            <div className="text-3xl font-bold text-ash-800">{fmtMMSS(data.times.mediaTotaleSec)}</div>
            <div className="mt-4 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-ash-500">Risposta:</span><span className="font-semibold text-emerald-700">{fmtMMSS(data.times.mediaRispostaSec)}</span></div>
                <div className="flex justify-between"><span className="text-ash-500">NR:</span><span className="font-semibold text-rose-700">{fmtMMSS(data.times.mediaNrSec)}</span></div>
            </div>
        </div>
    );
}
