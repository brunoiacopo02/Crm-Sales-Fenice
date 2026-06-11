"use client"

/**
 * Avviso richiami cross-company: se l'utente sta lavorando su un'azienda ma ha
 * richiami imminenti/scaduti sull'ALTRA azienda (es. su Fenice ma richiamo
 * Serenamente), mostra un banner con l'etichetta dell'azienda di provenienza.
 * Montato nel layout dashboard; visibile solo a chi ha più aziende consentite.
 */

import { useState, useEffect, useCallback } from "react"
import { BellRing, X } from "lucide-react"
import { getCrossCompanyRecalls } from "@/app/actions/recallActions"

type CrossRecall = {
    id: string
    name: string
    phone: string
    recallDate: string | null
    companyId: string
}

const COMPANY_LABELS: Record<string, string> = {
    fenice: 'Fenice',
    serenamente: 'SerenaMente',
    fcd: 'FCD',
}

export function CrossCompanyRecallBanner() {
    const [recalls, setRecalls] = useState<CrossRecall[]>([])
    const [dismissed, setDismissed] = useState<Set<string>>(new Set())

    const load = useCallback(async () => {
        try {
            const rows = await getCrossCompanyRecalls()
            setRecalls(rows)
        } catch {
            // utente senza multi-azienda o errore transitorio: silenzioso
        }
    }, [])

    useEffect(() => {
        load()
        const interval = setInterval(load, 60_000)
        return () => clearInterval(interval)
    }, [load])

    const visible = recalls.filter(r => !dismissed.has(r.id))
    if (visible.length === 0) return null

    return (
        <div className="fixed bottom-4 right-4 z-[80] flex max-w-sm flex-col gap-2">
            {visible.map((r) => {
                const company = COMPANY_LABELS[r.companyId] || r.companyId
                const when = r.recallDate
                    ? new Date(r.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })
                    : ''
                const isExpired = r.recallDate ? new Date(r.recallDate).getTime() <= Date.now() : false
                return (
                    <div
                        key={r.id}
                        className={`flex items-start gap-3 rounded-xl border p-3 shadow-lg ${isExpired ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}
                    >
                        <div className={`mt-0.5 rounded-lg p-1.5 ${isExpired ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                            <BellRing className="h-4 w-4 animate-pulse" />
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                            <div className={`font-bold ${isExpired ? 'text-red-700' : 'text-amber-700'}`}>
                                Richiamo {company} {isExpired ? 'SCADUTO' : 'in arrivo'}
                            </div>
                            <div className="mt-0.5 text-ash-700">
                                <span className="font-semibold">{r.name}</span> · {r.phone}
                            </div>
                            <div className="text-ash-500">{when} — cambia azienda dal menu in alto per gestirlo</div>
                        </div>
                        <button
                            onClick={() => setDismissed(prev => new Set(prev).add(r.id))}
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
