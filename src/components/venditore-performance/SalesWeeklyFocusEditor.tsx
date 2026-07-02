"use client"

import { useEffect, useState } from "react"
import { NOT_CLOSED_REASONS } from "@/lib/surveys/questions"
import { getSalesWeeklyFocus, setSalesWeeklyFocus } from "@/app/actions/salesWeeklyFocusActions"

export function SalesWeeklyFocusEditor({ salesUserId, weekStart, suggestedObjection, readOnly }: {
    salesUserId: string
    weekStart: string
    suggestedObjection?: string | null
    readOnly?: boolean
}) {
    const [objection, setObjection] = useState<string>("")
    const [taskNote, setTaskNote] = useState<string>("")
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        let alive = true
        getSalesWeeklyFocus(salesUserId, weekStart).then(f => {
            if (!alive) return
            setObjection(f?.objection ?? suggestedObjection ?? "")
            setTaskNote(f?.taskNote ?? "")
        })
        return () => { alive = false }
    }, [salesUserId, weekStart, suggestedObjection])

    const save = async () => {
        setSaving(true); setSaved(false)
        const r = await setSalesWeeklyFocus({ salesUserId, weekStart, objection: objection || null, taskNote })
        setSaving(false)
        if (r.success) setSaved(true); else alert(r.error || "Errore salvataggio focus")
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-700">Focus della settimana ({weekStart})</h3>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Obiezione da lavorare</label>
                <select value={objection} onChange={e => setObjection(e.target.value)} disabled={readOnly} className="input-fenice text-sm">
                    <option value="">— Nessuna —</option>
                    {NOT_CLOSED_REASONS.map(r => <option key={r} value={r}>{r}{suggestedObjection === r ? ' (più frequente)' : ''}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Task / nota</label>
                <textarea rows={3} value={taskNote} onChange={e => setTaskNote(e.target.value)} disabled={readOnly} className="input-fenice text-sm" placeholder="Es. Provare lo script alternativo sull'obiezione prezzo…" />
            </div>
            {!readOnly && (
                <div className="flex items-center gap-3">
                    <button onClick={save} disabled={saving} className="btn-primary text-sm py-2 px-5 disabled:opacity-50">{saving ? "Salvataggio…" : "Salva focus"}</button>
                    {saved && <span className="text-xs text-green-600 font-medium">Salvato ✓</span>}
                </div>
            )}
        </div>
    )
}
