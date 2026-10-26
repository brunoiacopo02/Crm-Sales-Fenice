"use client"

// Consigli in chiamata dall'admin (PO 26/10/2026), lato GDO e Conferme.
// Non c'è nessuna sezione fissa: il riquadro compare solo quando arriva un
// consiglio e sparisce con "Letto". Non blocca niente (nessun velo, i clic
// passano ovunque tranne sul riquadro), sta in alto a destra sotto la barra
// per non coprire la scheda del lead né i promemoria in basso. Niente suono:
// chi lo riceve ha la cuffia sull'orecchio.

import { useCallback, useEffect, useState } from "react"
import { Lightbulb } from "lucide-react"
import { getMieiConsigli, segnaConsigliLetti, type Consiglio } from "@/app/actions/consigliActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { oraBreve } from "@/lib/diretta/home"

const RISERVA_MS = 45_000

export function ConsigliInArrivo() {
    const [consigli, setConsigli] = useState<Consiglio[]>([])
    const [chiudendo, setChiudendo] = useState(false)

    const carica = useCallback(() => {
        getMieiConsigli().then(setConsigli).catch(() => { /* riprova al prossimo ping */ })
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

    if (consigli.length === 0) return null

    const letto = async () => {
        setChiudendo(true)
        const ids = consigli.map(c => c.id)
        try {
            await segnaConsigliLetti(ids)
            setConsigli(cs => cs.filter(c => !ids.includes(c.id)))
        } finally {
            setChiudendo(false)
        }
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed right-4 top-20 z-[85] w-[min(26rem,calc(100vw-2rem))] rounded-2xl border-2 border-[#FF9330] bg-[#262626] p-5 text-[#F2F2F2] shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
            style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
        >
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#FF9330]">
                <Lightbulb className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {consigli.length === 1 ? "Un consiglio per te" : `${consigli.length} consigli per te`}
            </div>
            <ol className="mt-3 flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
                {consigli.map(c => (
                    <li key={c.id}>
                        <div className="whitespace-pre-line text-[18px] font-medium leading-snug">{c.message}</div>
                        <div className="mt-1 text-[12px] tabular-nums text-[#A6A6A6]">{oraBreve(new Date(c.createdAt))}</div>
                    </li>
                ))}
            </ol>
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={letto}
                    disabled={chiudendo}
                    className="h-10 rounded-lg bg-[#FF9330] px-5 text-[14px] font-semibold text-[#171717] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    Letto
                </button>
            </div>
        </div>
    )
}
