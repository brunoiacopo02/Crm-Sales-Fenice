"use client"

// Consigli fissi dall'admin (PO 26/10/2026), lato GDO e Conferme. Una striscia
// sottile sotto la barra in alto, su ogni pagina, finché l'admin non li toglie:
// non copre niente, sposta solo il contenuto di una riga per consiglio (al
// massimo tre). Il testo lungo si legge per intero con un clic. Senza consigli
// fissi non c'è niente.

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Pin } from "lucide-react"
import { getMieiConsigliFissi, type Consiglio } from "@/app/actions/consigliActions"
import { onBusEvent } from "@/lib/realtimeBus"

const RISERVA_MS = 60_000

export function ConsigliFissi() {
    const [fissi, setFissi] = useState<Consiglio[]>([])
    const [aperto, setAperto] = useState(false)

    const carica = useCallback(() => {
        getMieiConsigliFissi().then(setFissi).catch(() => { /* resta quello che c'era */ })
    }, [])

    useEffect(() => {
        const id = setTimeout(carica, 0)
        const off = onBusEvent("callTips", carica)
        const onVisibile = () => { if (document.visibilityState === "visible") carica() }
        document.addEventListener("visibilitychange", onVisibile)
        // Riserva se il realtime cade in silenzio: una lettura leggera, solo a pagina in vista.
        const riserva = setInterval(() => { if (document.visibilityState === "visible") carica() }, RISERVA_MS)
        return () => {
            clearTimeout(id)
            clearInterval(riserva)
            off()
            document.removeEventListener("visibilitychange", onVisibile)
        }
    }, [carica])

    if (fissi.length === 0) return null

    return (
        <section
            aria-label="Consigli da ricordare"
            className="shrink-0 border-b-2 border-[#3D3D3D] bg-[#262626] px-4 py-1.5 text-[#F2F2F2] lg:px-6"
            style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
        >
            <button
                type="button"
                onClick={() => setAperto(v => !v)}
                aria-expanded={aperto}
                className="flex w-full items-start gap-2.5 text-left"
            >
                <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-[#FF9330]" strokeWidth={2} aria-hidden="true" />
                <ul className="min-w-0 flex-1">
                    {fissi.map(c => (
                        <li key={c.id} className={`py-0.5 text-[14px] font-medium leading-snug ${aperto ? "whitespace-pre-line" : "truncate"}`}>
                            {c.message}
                        </li>
                    ))}
                </ul>
                <ChevronDown
                    className={`mt-1 h-4 w-4 shrink-0 text-[#BFBFBF] transition-transform ${aperto ? "rotate-180" : ""}`}
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                <span className="sr-only">{aperto ? "Riduci" : "Leggi per intero"}</span>
            </button>
        </section>
    )
}
