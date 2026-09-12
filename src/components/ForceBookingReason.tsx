"use client"

import { useState } from "react"

/**
 * Blocco inline mostrato quando una delle tre action di fissaggio
 * (setConfermeOutcome / updateLeadDataConferme / scheduleConfermeRecall)
 * rifiuta con `needsForce: true` (Task 2, muro del fissaggio — PO 2026-09-12).
 *
 * Mostra il messaggio del server per intero (non riassunto), un campo
 * "Motivo" e un bottone "Fissa comunque" che richiama l'azione con
 * `forceReason` valorizzato. Il bottone resta disabilitato finché il motivo
 * è vuoto: è obbligatorio anche lato server, che rifiuta di nuovo se vuoto.
 *
 * Nessun window.confirm: tutto inline, come richiesto dal task.
 */
export function ForceBookingReason({ message, onConfirm, busy, compact }: {
    message: string
    onConfirm: (reason: string) => void
    busy?: boolean
    compact?: boolean
}) {
    const [reason, setReason] = useState("")
    const trimmed = reason.trim()

    return (
        <div className={`rounded-lg border border-amber-300 bg-amber-50 ${compact ? 'p-2 mt-2' : 'p-3 mt-3'}`}>
            <p className={`text-amber-800 font-semibold whitespace-pre-wrap leading-snug ${compact ? 'text-[11px]' : 'text-sm'}`}>
                {message}
            </p>
            <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Motivo per fissare comunque (es. cliente disponibile solo a quest'ora)..."
                rows={2}
                disabled={busy}
                className="mt-2 w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 bg-white resize-none disabled:opacity-60"
            />
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    onClick={() => { if (trimmed && !busy) onConfirm(trimmed) }}
                    disabled={!trimmed || busy}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-soft transition-all"
                >
                    {busy ? "..." : "Fissa comunque"}
                </button>
            </div>
        </div>
    )
}
