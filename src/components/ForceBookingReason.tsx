"use client"

import { useState } from "react"
import { forceReasonProblem } from "@/lib/venditore/calendarBooking"

/**
 * Blocco inline mostrato quando una delle tre action di fissaggio
 * (setConfermeOutcome / updateLeadDataConferme / scheduleConfermeRecall)
 * rifiuta con `needsForce: true` (Task 2, muro del fissaggio — PO 2026-09-12).
 *
 * Mostra il messaggio del server per intero (non riassunto), un campo
 * "Motivo" e un bottone "Fissa comunque" che richiama l'azione con
 * `forceReason` valorizzato. Il bottone resta disabilitato finché il motivo
 * non regge `forceReasonProblem` (la stessa regola che applica il server): così
 * il rifiuto arriva mentre si scrive, non dopo un round-trip.
 *
 * Nessun window.confirm: tutto inline, come richiesto dal task.
 */
export function ForceBookingReason({ message, onConfirm, busy, variant = 'classic' }: {
    message: string
    onConfirm: (reason: string) => void
    busy?: boolean
    /** Grafica: 'diretta' = restyle scuro delle Conferme (PO 25/10/2026). La logica non cambia. */
    variant?: 'classic' | 'diretta'
}) {
    const [reason, setReason] = useState("")
    const trimmed = reason.trim()
    const problem = forceReasonProblem(reason)

    if (variant === 'diretta') {
        return (
            <div className="mt-3 rounded-2xl border-2 border-[var(--d-orange)] p-4">
                <p className="whitespace-pre-wrap text-sm font-medium leading-snug text-[var(--d-text)]">
                    {message}
                </p>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Motivo per fissare comunque (es. cliente disponibile solo a quest'ora)..."
                    rows={2}
                    disabled={busy}
                    autoFocus
                    className="mt-3 w-full resize-none rounded-lg border-2 border-[var(--d-line)] bg-[var(--d-bg)] px-3 py-2 text-sm text-[var(--d-text)] outline-none transition-colors placeholder:text-[var(--d-faint)] focus:border-[var(--d-orange)] disabled:opacity-60"
                />
                {trimmed.length > 0 && problem && (
                    <div className="mt-1 text-xs text-[var(--d-orange)]">{problem}</div>
                )}
                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={() => { if (!problem && !busy) onConfirm(trimmed) }}
                        disabled={!!problem || busy}
                        className="inline-flex h-10 items-center rounded-lg bg-[var(--d-orange)] px-4 text-sm font-semibold text-[var(--d-orange-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy ? "..." : "Fissa comunque"}
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mt-3">
            <p className="text-sm text-amber-800 font-semibold whitespace-pre-wrap leading-snug">
                {message}
            </p>
            <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Motivo per fissare comunque (es. cliente disponibile solo a quest'ora)..."
                rows={2}
                disabled={busy}
                autoFocus
                className="mt-2 w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 bg-white resize-none disabled:opacity-60"
            />
            {/* Il rimprovero arriva solo dopo che qualcosa è stato scritto: su un
                campo ancora vuoto sarebbe un errore per una cosa non fatta. */}
            {trimmed.length > 0 && problem && (
                <div className="mt-1 text-[10px] text-amber-700">{problem}</div>
            )}
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    onClick={() => { if (!problem && !busy) onConfirm(trimmed) }}
                    disabled={!!problem || busy}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-soft transition-all"
                >
                    {busy ? "..." : "Fissa comunque"}
                </button>
            </div>
        </div>
    )
}
