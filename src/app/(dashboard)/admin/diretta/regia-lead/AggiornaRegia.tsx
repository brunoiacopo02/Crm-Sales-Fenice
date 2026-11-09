"use client"

// La regia si rilegge da sola una volta al minuto, solo a scheda visibile
// (niente giri a scheda nascosta: Disk IO e costi Vercel). Tornando sulla
// scheda, subito se l'ultimo giro è vecchio. "Aggiorna ora" butta la cache del
// server (45 s) e rilegge. Niente canali Realtime.

import { useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { aggiornaRegia } from "@/app/actions/regiaLeadActions"
import { bottone } from "@/components/diretta/admin/ui"

const OGNI_MS = 60_000

export function AggiornaRegia({ oraDati }: { oraDati: string }) {
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
            await aggiornaRegia()
            router.refresh()
        })
    }

    return (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[16px] bg-[#262626] px-5 py-3 sm:px-6">
            <div className="min-w-0 flex-1 text-[14px] leading-snug">
                <div className="font-semibold text-[#F2F2F2]" aria-live="polite">
                    {inCorso ? "Aggiornamento in corso…" : <>Dati delle <span className="text-[#FF9330]">{oraDati}</span></>}
                </div>
                <div className="text-[13px] text-[#BFBFBF]">Si aggiorna da solo ogni minuto mentre la pagina è aperta e visibile.</div>
            </div>
            <button type="button" onClick={aggiornaOra} disabled={inCorso} className={bottone("linea", "piccola")}>
                <RefreshCw aria-hidden="true" className={`h-4 w-4 ${inCorso ? "animate-spin" : ""}`} strokeWidth={1.75} />
                Aggiorna ora
            </button>
        </div>
    )
}
