"use client"

// La pagina dei lead brochure si rilegge da sola una volta al minuto, solo a
// scheda visibile (niente giri a scheda nascosta: Disk IO e costi Vercel).
// Tornando sulla scheda, subito se l'ultimo giro è vecchio. "Aggiorna ora"
// butta la cache del server e rilegge. Niente canali Realtime.

import { useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { aggiornaBrochure } from "@/app/actions/brochureActions"

const OGNI_MS = 60_000

export function AggiornaBrochure({ oraDati }: { oraDati: string }) {
    const router = useRouter()
    const ultimo = useRef(0)
    const [inCorso, avvia] = useTransition()

    useEffect(() => {
        ultimo.current = Date.now()
        const giro = () => {
            if (document.hidden) return
            if (Date.now() - ultimo.current < OGNI_MS) return
            ultimo.current = Date.now()
            router.refresh()
        }
        const id = setInterval(giro, 15_000)
        document.addEventListener("visibilitychange", giro)
        return () => {
            clearInterval(id)
            document.removeEventListener("visibilitychange", giro)
        }
    }, [router])

    const aggiornaOra = () => {
        avvia(async () => {
            ultimo.current = Date.now()
            await aggiornaBrochure()
            router.refresh()
        })
    }

    return (
        <div className="flex items-center gap-3 rounded-lg border border-ash-200 bg-white p-2 pl-4 shadow-sm">
            <div className="text-sm leading-tight" aria-live="polite">
                <div className="font-medium text-ash-700">
                    {inCorso ? "Aggiornamento in corso…" : <>Dati delle <span className="text-brand-orange">{oraDati}</span></>}
                </div>
                <div className="text-xs text-ash-500">Si aggiorna da solo ogni minuto</div>
            </div>
            <button
                type="button"
                onClick={aggiornaOra}
                disabled={inCorso}
                className="flex h-9 items-center gap-2 rounded-md bg-brand-orange px-3 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <RefreshCw aria-hidden="true" className={`h-4 w-4 ${inCorso ? "animate-spin" : ""}`} />
                Aggiorna ora
            </button>
        </div>
    )
}
