"use client"

import { useEffect, useState } from "react"
import { Target } from "lucide-react"
import { getSalesWeeklyFocus } from "@/app/actions/salesWeeklyFocusActions"

export function WeeklyFocusBanner({ salesUserId }: { salesUserId: string }) {
    const [focus, setFocus] = useState<{ objection: string | null; taskNote: string } | null>(null)
    useEffect(() => {
        let alive = true
        getSalesWeeklyFocus(salesUserId).then(f => { if (alive) setFocus(f) })
        return () => { alive = false }
    }, [salesUserId])

    if (!focus || (!focus.objection && !focus.taskNote)) return null
    return (
        <div className="bg-gradient-to-r from-brand-orange/10 to-amber-50 border border-brand-orange/30 rounded-xl p-4 flex items-start gap-3">
            <Target className="h-5 w-5 text-brand-orange shrink-0 mt-0.5" />
            <div>
                <div className="text-xs font-bold text-brand-orange uppercase tracking-wider">Focus della settimana</div>
                {focus.objection && <div className="text-sm font-semibold text-gray-900 mt-1">Obiezione da lavorare: {focus.objection}</div>}
                {focus.taskNote && <div className="text-sm text-gray-700 mt-1">{focus.taskNote}</div>}
            </div>
        </div>
    )
}
