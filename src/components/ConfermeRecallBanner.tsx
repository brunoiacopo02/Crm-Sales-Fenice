"use client"

/**
 * Banner BLU per i richiami Conferme ("risentire dopo"): visibile su qualsiasi
 * pagina e per TUTTE le aziende consentite (Fenice + Serenamente) senza dover
 * cambiare azienda. L'azienda di provenienza è super-riconoscibile (chip brand).
 * QA Conferme 2026-06-12: prima la sveglia snooze esisteva solo dentro il board
 * della azienda attiva → notifiche perse.
 */

import { useState, useEffect, useCallback } from "react"
import { BellRing, X } from "lucide-react"
import { getConfermeRecallAlerts } from "@/app/actions/confermeActions"
import { useSalesCompany } from "@/components/providers/SalesCompanyProvider"

type RecallAlert = {
    id: string
    name: string
    phone: string | null
    snoozeAt: string
    notes: string | null
    companyId: string
}

const COMPANY_CHIP: Record<string, { label: string; className: string }> = {
    fenice: { label: 'FENICE', className: 'bg-orange-100 text-orange-700 border-orange-300' },
    serenamente: { label: 'SERENAMENTE', className: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    fcd: { label: 'FCD', className: 'bg-purple-100 text-purple-700 border-purple-300' },
}

export function ConfermeRecallBanner() {
    const [alerts, setAlerts] = useState<RecallAlert[]>([])
    const [dismissed, setDismissed] = useState<Set<string>>(new Set())
    const activeCompany = useSalesCompany()

    const load = useCallback(async () => {
        try {
            setAlerts(await getConfermeRecallAlerts())
        } catch {
            // errore transitorio: silenzioso, riprova al prossimo giro
        }
    }, [])

    useEffect(() => {
        load()
        const interval = setInterval(load, 60_000)
        const handler = () => load()
        window.addEventListener("realtime_update", handler)
        return () => {
            clearInterval(interval)
            window.removeEventListener("realtime_update", handler)
        }
    }, [load])

    // Chiave dismiss = id + orario: se il lead viene ri-snoozato, l'avviso torna.
    const keyOf = (a: RecallAlert) => `${a.id}|${a.snoozeAt}`
    const visible = alerts.filter(a => !dismissed.has(keyOf(a)))
    if (visible.length === 0) return null

    return (
        <div className="fixed bottom-4 right-4 z-[80] flex max-w-sm flex-col gap-2">
            {visible.map((a) => {
                const chip = COMPANY_CHIP[a.companyId] || { label: a.companyId.toUpperCase(), className: 'bg-gray-100 text-gray-700 border-gray-300' }
                const due = new Date(a.snoozeAt)
                const isExpired = due.getTime() <= Date.now()
                const isOtherCompany = a.companyId !== activeCompany
                return (
                    <div
                        key={keyOf(a)}
                        className="flex items-start gap-3 rounded-xl border border-sky-300 bg-sky-50 p-3 shadow-lg"
                    >
                        <div className="mt-0.5 rounded-lg bg-sky-100 p-1.5 text-sky-600">
                            <BellRing className={`h-4 w-4 ${isExpired ? 'animate-pulse' : ''}`} />
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black tracking-wider ${chip.className}`}>
                                    {chip.label}
                                </span>
                                <span className="font-bold text-sky-700">
                                    Richiamo Conferme {isExpired ? 'ADESSO' : 'in arrivo'}
                                </span>
                            </div>
                            <div className="mt-1 text-ash-700">
                                <span className="font-semibold">{a.name}</span>{a.phone ? ` · ${a.phone}` : ''}
                            </div>
                            <div className="text-ash-500">
                                {due.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                                {isOtherCompany ? ' — cambia azienda dal menu in alto per gestirlo' : ''}
                            </div>
                            {a.notes && (
                                <div className="mt-0.5 italic text-sky-600 line-clamp-2">"{a.notes}"</div>
                            )}
                        </div>
                        <button
                            onClick={() => setDismissed(prev => new Set(prev).add(keyOf(a)))}
                            className="rounded-md p-1 text-ash-400 hover:bg-black/5 hover:text-ash-600"
                            title="Nascondi"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
