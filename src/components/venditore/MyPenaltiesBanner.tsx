"use client"

import { useState } from "react"
import { ChevronDown, Timer } from "lucide-react"
import type { MyPenaltyItem } from "@/app/actions/venditoriMonitorActions"
import { OVERDUE_GRACE_HOURS } from "@/lib/venditore/constants"

export interface MyPenaltiesData {
    count: number
    openCount: number
    totalEur: number
    items: MyPenaltyItem[]
}

const romeDateTime = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
})

const romeDate = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
})

function hoursLabel(h: number): string {
    if (h < 24) return `${Math.round(h)} h`
    const days = Math.floor(h / 24)
    const rest = Math.round(h - days * 24)
    return rest > 0 ? `${days} g ${rest} h` : `${days} g`
}

/** Titolo e spiegazione di una trattenuta: il motivo, mai chi l'ha segnalata. */
function describe(p: MyPenaltyItem): { title: string; detail: string } {
    const due = new Date(p.dueAtIso)
    const lead = p.leadName || "lead senza nome"
    switch (p.kind) {
        case "APPOINTMENT":
            return {
                title: `Esito appuntamento in ritardo — ${lead}`,
                detail: p.resolvedAtIso
                    ? `Appuntamento del ${romeDateTime.format(due)}: esito registrato dopo ${hoursLabel(p.hoursLate ?? 0)} (limite ${OVERDUE_GRACE_HOURS} h).`
                    : `Appuntamento del ${romeDateTime.format(due)}: esito ancora da registrare (${hoursLabel(p.hoursLate ?? 0)} dalla scadenza, limite ${OVERDUE_GRACE_HOURS} h).`,
            }
        case "FOLLOWUP":
            return {
                title: `Esito follow-up in ritardo — ${lead}`,
                detail: p.resolvedAtIso
                    ? `Follow-up del ${romeDateTime.format(due)}: esito registrato dopo ${hoursLabel(p.hoursLate ?? 0)} (limite ${OVERDUE_GRACE_HOURS} h).`
                    : `Follow-up del ${romeDateTime.format(due)}: esito ancora da registrare (${hoursLabel(p.hoursLate ?? 0)} dalla scadenza, limite ${OVERDUE_GRACE_HOURS} h).`,
            }
        case "ABSENT_SLOT":
            return {
                title: p.leadName ? `Assente all'ora dichiarata — ${p.leadName}` : "Assente all'ora dichiarata",
                detail: `Avevi dichiarato libera l'ora di ${romeDateTime.format(due)} nel calendario disponibilità, ma a quell'ora risultavi assente.`,
            }
        case "CALENDAR_MISSING":
            return {
                title: "Calendario disponibilità non compilato",
                detail: p.note || `Calendario della settimana del ${romeDate.format(due)} non compilato entro lunedì 14:00.`,
            }
        default:
            return { title: "Trattenuta", detail: romeDateTime.format(due) }
    }
}

/**
 * Trattenute del mese sulla dashboard venditore: il riepilogo (registro unico
 * dei 10 € dei ritardi e dei 50 € del calendario, ruling PO 2026-09-12) che si
 * apre sul dettaglio di ogni singola trattenuta (ruling PO 2026-10-10).
 */
export function MyPenaltiesBanner({ data }: { data: MyPenaltiesData }) {
    const [open, setOpen] = useState(false)

    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
            >
                <Timer className="h-5 w-5 shrink-0 text-rose-600" />
                <div className="min-w-0 flex-1 text-sm text-rose-900">
                    <span className="font-bold">
                        {data.count} {data.count === 1 ? "trattenuta" : "trattenute"} questo mese
                    </span>
                    <span className="mx-1.5 text-rose-400">&middot;</span>
                    <span className="font-semibold">-{data.totalEur.toFixed(0)} &euro;</span>
                    <span className="ml-2 text-rose-700/80">
                        Ritardi sugli esiti e multe del calendario disponibilità.
                    </span>
                </div>
                {data.openCount > 0 && (
                    <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white">
                        {data.openCount} {data.openCount === 1 ? "ritardo" : "ritardi"} ancora da esitare
                    </span>
                )}
                <span className="flex items-center gap-1 text-xs font-semibold text-rose-700">
                    {open ? "Nascondi" : "Vedi il dettaglio"}
                    <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
            </button>

            {open && (
                <ul className="divide-y divide-rose-100 border-t border-rose-200">
                    {data.items.map(p => {
                        const { title, detail } = describe(p)
                        const stillOpen = (p.kind === "APPOINTMENT" || p.kind === "FOLLOWUP") && !p.resolvedAtIso
                        return (
                            <li key={p.id} className="flex items-start gap-3 px-4 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-rose-900">
                                        {title}
                                        {stillOpen && (
                                            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                                da esitare
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-rose-700/90">{detail}</div>
                                </div>
                                <div className="shrink-0 text-sm font-bold text-rose-700">
                                    -{p.amountEur.toFixed(0)} &euro;
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
