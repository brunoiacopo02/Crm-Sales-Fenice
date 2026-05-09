import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

export function RecallLoadCard({ data }: { data: ConfermeAnalyticsResult }) {
    const s = (data.recall.pctSnoozeGiornata * 100).toFixed(1);
    const p = (data.recall.pctParcheggiati * 100).toFixed(1);
    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-card">
            <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide mb-3">Carico residuo (re-tentativi)</div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <div className="text-2xl font-bold text-amber-700">{s}%</div>
                    <div className="text-xs text-ash-500 mt-1">Snooze in giornata</div>
                </div>
                <div>
                    <div className="text-2xl font-bold text-blue-700">{p}%</div>
                    <div className="text-xs text-ash-500 mt-1">Parcheggiati altri giorni</div>
                </div>
            </div>
            <div className="text-[11px] text-ash-400 mt-3">su {data.recall.leadToccati} lead toccati nel periodo</div>
        </div>
    );
}
