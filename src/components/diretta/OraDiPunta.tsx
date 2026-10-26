"use client"

// Ora di punta nella barra in alto del GDO (PO 26/10/2026): finché dura,
// tre fiammelle che tremolano e "Ora di punta, fino alle 19" su ogni pagina;
// all'inizio un avviso in basso che sparisce da solo dopo 8 secondi, una
// volta al giorno. Niente suono, niente clic intercettati, niente spostamenti:
// le fiamme animano solo transform e opacità, e con le animazioni ridotte
// del sistema restano ferme. Le Conferme non hanno l'ora di punta.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Flame, X } from "lucide-react"
import { peakWindow, type GamificationTargets } from "@/lib/diretta/config"
import { oraParlata, statoFinestra } from "@/lib/diretta/home"
import { toRomeDateStr } from "@/lib/dateUtils"

const AVVISO_MS = 8_000
/** Entro questi minuti dall'inizio l'avviso dice "è partita", dopo "è in corso". */
const APPENA_PARTITA_MIN = 10
/** Negli ultimi minuti l'avviso non serve più. */
const ULTIMI_MIN = 5

interface Props {
    userId: string
    adesso: Date | null
    obiettivi: GamificationTargets | null
    /** Classi del testo facoltativo "fino alle 19", come gli altri testi della barra. */
    classeFacoltativo: string
}

export function OraDiPunta({ userId, adesso, obiettivi, classeFacoltativo }: Props) {
    const stato = adesso && obiettivi ? statoFinestra(adesso, peakWindow(adesso, obiettivi)) : null
    const durante = stato?.fase === 'durante'
    const [avviso, setAvviso] = useState<{ titolo: string; testo: string } | null>(null)
    const mostrato = useRef<string | null>(null)

    const inizioMs = stato?.start.getTime() ?? null
    const fineMs = stato?.end.getTime() ?? null

    // L'avviso parte da un timer (non nel corpo dell'effetto) e si segna come
    // mostrato solo quando appare davvero: una volta al giorno per persona.
    useEffect(() => {
        if (!durante || inizioMs === null || fineMs === null || !obiettivi) return
        const id = setTimeout(() => {
            const ora = new Date()
            if ((fineMs - ora.getTime()) / 60_000 <= ULTIMI_MIN) return
            const chiave = `d-punta-avviso:${userId}:${toRomeDateStr(ora)}`
            if (mostrato.current === chiave) return
            mostrato.current = chiave
            try {
                if (localStorage.getItem(chiave)) return
                localStorage.setItem(chiave, '1')
            } catch { /* senza storage vale il ricordo della pagina */ }
            const daMinuti = (ora.getTime() - inizioMs) / 60_000
            setAvviso({
                titolo: daMinuti < APPENA_PARTITA_MIN ? "È partita l'ora di punta" : "È in corso l'ora di punta",
                testo: `Fino alle ${oraParlata(new Date(fineMs))}. Obiettivo di squadra ${obiettivi.punta[0]}, poi ${obiettivi.punta[1]}.`,
            })
        }, 0)
        return () => clearTimeout(id)
    }, [durante, inizioMs, fineMs, obiettivi, userId])

    useEffect(() => {
        if (!avviso) return
        const id = setTimeout(() => setAvviso(null), AVVISO_MS)
        return () => clearTimeout(id)
    }, [avviso])

    if (!durante || !stato) return null

    return (
        <>
            <div
                className="pointer-events-none flex shrink-0 select-none items-center gap-2 whitespace-nowrap rounded-lg bg-[#262626] px-2.5 py-1.5 text-[13px]"
                title={`Ora di punta fino alle ${oraParlata(stato.end)}`}
            >
                <span aria-hidden="true" className="flex items-end">
                    {[0, 1, 2].map(i => (
                        <Flame
                            key={i}
                            className={`d-fiamma text-[#FF9330] ${i === 1 ? 'h-4 w-4' : '-mx-0.5 h-3 w-3'}`}
                            style={{ animationDelay: `${i * 220}ms` }}
                            strokeWidth={2}
                        />
                    ))}
                </span>
                <span className="hidden font-medium text-[#F2F2F2] sm:inline">Ora di punta</span>
                <span className={`${classeFacoltativo} text-[#BFBFBF]`}>fino alle {oraParlata(stato.end)}</span>
                <span className="sr-only sm:hidden">Ora di punta fino alle {oraParlata(stato.end)}</span>
            </div>

            {/* Fuori dalla barra (che fa da contesto di sovrapposizione a z-40): così sta
                sopra anche la schermata d'inizio turno (z-60), restando dentro la veste Diretta. */}
            {avviso && createPortal(
                <div role="status" className="pointer-events-none fixed bottom-6 left-6 z-[70] max-w-[min(22rem,calc(100vw-3rem))]">
                    <div className="d-entra relative rounded-2xl border-2 border-[#3D3D3D] bg-[#262626] p-4 pr-10 text-[#F2F2F2]">
                        <button
                            type="button"
                            onClick={() => setAvviso(null)}
                            aria-label="Chiudi"
                            className="pointer-events-auto absolute right-2 top-2 rounded-lg p-1 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                        >
                            <X className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                        <div className="flex items-center gap-2 text-[14px] font-semibold leading-tight">
                            <Flame className="h-4 w-4 shrink-0 text-[#FF9330]" strokeWidth={2} aria-hidden="true" />
                            {avviso.titolo}
                        </div>
                        <div className="mt-1 text-[13px] leading-snug text-[#BFBFBF]">{avviso.testo}</div>
                    </div>
                </div>,
                document.querySelector('[data-radice-dashboard]') ?? document.body,
            )}
        </>
    )
}
