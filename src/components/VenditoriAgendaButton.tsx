"use client"

import { useState } from "react"
import { Calendar as CalendarIcon } from "lucide-react"
import dynamic from "next/dynamic"

const VenditoriAgendaModal = dynamic(
    () => import("./VenditoriAgendaModal").then(m => ({ default: m.VenditoriAgendaModal })),
    { ssr: false },
)

/** `variant` 'diretta' = restyle scuro delle Conferme (PO 25/10/2026); la modale resta quella di sempre. */
export function VenditoriAgendaButton({ variant = 'classic' }: { variant?: 'classic' | 'diretta' }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className={variant === 'diretta'
                    ? "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border-2 border-[var(--d-line)] px-3.5 text-sm font-medium text-[var(--d-text)] transition-colors hover:bg-[var(--d-surface)]"
                    : "flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-xs font-semibold text-ash-700 hover:bg-ash-50 shadow-sm"}
                title="Vedi il carico degli appuntamenti venditori"
            >
                <CalendarIcon className={variant === 'diretta' ? "h-4 w-4" : "h-3.5 w-3.5 text-brand-orange"} strokeWidth={variant === 'diretta' ? 1.75 : undefined} />
                Agenda venditori
            </button>
            {open && <VenditoriAgendaModal isOpen={open} onClose={() => setOpen(false)} />}
        </>
    )
}
