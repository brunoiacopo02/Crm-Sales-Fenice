import type { ConfermeAnalyticsResult } from "@/app/actions/confermeAnalyticsActions"

export function LoadCard({ data }: { data: ConfermeAnalyticsResult }) {
    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-card">
            <div className="text-xs text-ash-500 font-semibold uppercase tracking-wide mb-2">App/giorno da chiamare</div>
            <div className="text-3xl font-bold text-ash-800">{data.load.mediaAppGiorno.toFixed(1)}</div>
            <div className="mt-4 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-ash-500">Pomeriggio (15–21):</span><span className="font-semibold text-ash-800">{data.load.splitPomeriggio.toFixed(1)}</span></div>
                <div className="flex justify-between"><span className="text-ash-500">Mattina (9–14):</span><span className="font-semibold text-ash-800">{data.load.splitMattina.toFixed(1)}</span></div>
            </div>
        </div>
    );
}
