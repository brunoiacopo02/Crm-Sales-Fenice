"use client"

// Avviso richiami del GDO (PO 27/10/2026): prima i GDO non avevano nessun
// avviso all'ora del richiamo. In basso a destra, su ogni pagina, compare
// 5 minuti prima ("tra 4 minuti") e resta all'ora ("adesso") finché il
// richiamo non viene fatto (cambia recallDate o l'esito) o lo si nasconde.
// Non blocca niente; "Apri" apre la scheda del lead sul posto. Al massimo
// tre richiami in vista, gli altri come "e altri N nella coda Richiami".

import { useCallback, useEffect, useState } from "react"
import { BellRing, X } from "lucide-react"
import { getGdoRichiamiDaFare, type RichiamoDaFare } from "@/app/actions/direttaActions"
import { ContactDrawer } from "@/components/ContactDrawer"
import { oraBreve } from "@/lib/diretta/home"
import { useOrologio } from "./useOrologio"

const OGNI_MS = 30_000

export function RichiamiAvviso() {
    const [dati, setDati] = useState<{ richiami: RichiamoDaFare[]; totale: number }>({ richiami: [], totale: 0 })
    const [nascosti, setNascosti] = useState<Set<string>>(new Set())
    const [aperto, setAperto] = useState<string | null>(null)
    const adesso = useOrologio(15_000)

    const carica = useCallback(() => {
        getGdoRichiamiDaFare().then(setDati).catch(() => { /* riprova al prossimo giro */ })
    }, [])

    useEffect(() => {
        const id = setTimeout(carica, 0)
        const giro = setInterval(() => { if (document.visibilityState === "visible") carica() }, OGNI_MS)
        const onVisibile = () => { if (document.visibilityState === "visible") carica() }
        document.addEventListener("visibilitychange", onVisibile)
        // Dopo un esito (la scheda o la pipeline rileggono i lead) l'avviso si aggiorna subito.
        window.addEventListener("realtime_update", carica)
        return () => {
            clearTimeout(id)
            clearInterval(giro)
            document.removeEventListener("visibilitychange", onVisibile)
            window.removeEventListener("realtime_update", carica)
        }
    }, [carica])

    // Chiave = lead + ora: se il richiamo viene spostato, l'avviso torna.
    const chiave = (r: RichiamoDaFare) => `${r.id}|${r.recallDate}`
    const visibili = dati.richiami.filter(r => !nascosti.has(chiave(r)))
    const altri = Math.max(0, dati.totale - dati.richiami.length)

    return (
        <>
            {visibili.length > 0 && (
                <div
                    data-ui="diretta"
                    className="d-a-sinistra-della-scheda fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
                    style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
                >
                    {visibili.map(r => {
                        const ora = new Date(r.recallDate)
                        const minuti = adesso ? Math.ceil((ora.getTime() - adesso.getTime()) / 60_000) : 0
                        const scaduto = minuti <= 0
                        return (
                            <div
                                key={chiave(r)}
                                role="status"
                                className={`flex items-start gap-3 rounded-2xl border-2 bg-[#262626] p-4 text-[#F2F2F2] shadow-[0_12px_32px_rgba(0,0,0,0.35)] ${scaduto ? "border-[#FF9330]" : "border-[#3D3D3D]"}`}
                            >
                                <BellRing className={`mt-0.5 h-4 w-4 shrink-0 ${scaduto ? "text-[#FF9330]" : "text-[#BFBFBF]"}`} strokeWidth={1.75} aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-[14px] font-semibold">
                                        {scaduto ? "Richiamo da fare adesso" : `Richiamo tra ${minuti} ${minuti === 1 ? "minuto" : "minuti"}`}
                                    </div>
                                    <div className="mt-1 truncate text-[15px] font-medium">{r.name}</div>
                                    <div className="text-[13px] tabular-nums text-[#BFBFBF]">
                                        alle {oraBreve(ora)}{r.phone ? `, ${r.phone}` : ""}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setAperto(r.id)}
                                        className="mt-2.5 h-9 rounded-lg bg-[#FF9330] px-4 text-[13px] font-semibold text-[#171717] transition-opacity hover:opacity-90"
                                    >
                                        Apri la scheda
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setNascosti(prev => new Set(prev).add(chiave(r)))}
                                    aria-label="Nascondi"
                                    title="Nascondi"
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#BFBFBF] transition-colors hover:bg-[#2E2E2E] hover:text-[#F2F2F2]"
                                >
                                    <X className="h-4 w-4" strokeWidth={1.75} />
                                </button>
                            </div>
                        )
                    })}
                    {altri > 0 && (
                        <div className="rounded-xl bg-[#262626] px-4 py-2 text-[13px] text-[#BFBFBF]">
                            E altri {altri} nella coda Richiami della pipeline.
                        </div>
                    )}
                </div>
            )}
            <ContactDrawer
                isOpen={aperto !== null}
                leadId={aperto}
                onClose={() => { setAperto(null); carica() }}
                diretta
            />
        </>
    )
}
