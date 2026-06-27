"use client"

import type { LeadBriefing } from "@/lib/briefing/normalize"
import {
    CONFERME_PAIN_POINT_OPTIONS,
    CONFERME_URGENCY_OPTIONS,
    CONFERME_BUDGET_OPTIONS,
} from "@/lib/surveys/questions"

function labelFor(
    options: ReadonlyArray<{ readonly value: string; readonly label: string }>,
    value: string
): string {
    return options.find(o => o.value === value)?.label ?? value
}

interface LeadBriefingCardProps {
    briefing: LeadBriefing | null
}

export function LeadBriefingCard({ briefing }: LeadBriefingCardProps) {
    if (!briefing) {
        return (
            <div className="rounded-lg border border-ash-200 bg-ash-50 p-3">
                <div className="text-sm text-ash-500">Nessun briefing disponibile</div>
            </div>
        )
    }

    const title = briefing.source === "bot"
        ? "🤖 Briefing dal bot"
        : "📋 Briefing dalle Conferme"

    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 text-sm font-semibold text-amber-800">{title}</div>
            {briefing.summary && (
                <p className="mb-2 text-sm text-gray-700">{briefing.summary}</p>
            )}
            {briefing.levaConsigliata && (
                <div className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900">
                    Leva consigliata: {briefing.levaConsigliata}
                </div>
            )}
            <div className="mb-2 flex flex-wrap gap-1">
                {briefing.budgetSignal && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-amber-200">
                        Budget: {labelFor(CONFERME_BUDGET_OPTIONS, briefing.budgetSignal)}
                    </span>
                )}
                {briefing.urgency && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-amber-200">
                        Urgenza: {labelFor(CONFERME_URGENCY_OPTIONS, briefing.urgency)}
                    </span>
                )}
                {briefing.works !== null && (
                    <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${briefing.works
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-red-50 text-red-700 ring-red-200"
                        }`}
                    >
                        Lavora: {briefing.works ? "Sì" : "No"}
                    </span>
                )}
            </div>
            {briefing.painPoints.length > 0 && (
                <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-500">Pain point</div>
                    <ul className="ml-4 list-disc text-sm text-gray-700">
                        {briefing.painPoints.map((p, i) => (
                            <li key={i}>{labelFor(CONFERME_PAIN_POINT_OPTIONS, p)}</li>
                        ))}
                    </ul>
                </div>
            )}
            {briefing.objections.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-gray-500">Obiezioni</div>
                    <ul className="ml-4 list-disc text-sm text-gray-600">
                        {briefing.objections.map((o, i) => (
                            <li key={i}>{o}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
