"use client"

import { useState } from "react"
import { Calendar as CalendarIcon } from "lucide-react"
import dynamic from "next/dynamic"

const VenditoriAgendaModal = dynamic(
    () => import("./VenditoriAgendaModal").then(m => ({ default: m.VenditoriAgendaModal })),
    { ssr: false },
)

export function VenditoriAgendaButton() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-xs font-semibold text-ash-700 hover:bg-ash-50 shadow-sm"
                title="Vedi il carico degli appuntamenti venditori"
            >
                <CalendarIcon className="h-3.5 w-3.5 text-brand-orange" />
                Agenda venditori
            </button>
            {open && <VenditoriAgendaModal isOpen={open} onClose={() => setOpen(false)} />}
        </>
    )
}
