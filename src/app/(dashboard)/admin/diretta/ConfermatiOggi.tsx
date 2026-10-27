"use client"

// Lista dei confermati di oggi nel centro di controllo (PO 27/10/2026): la
// stessa riga di "Appuntamenti venditori" in Monitor Vendite (data e ora
// dell'appuntamento, lead che apre la scheda, GDO, funnel, telefono, nota,
// venditore e stato), con in più l'ora della conferma e chi l'ha fatta.
// Colori scuri della Diretta al posto di quelli chiari del monitor.

import { useState } from "react"
import dynamic from "next/dynamic"
import { Phone } from "lucide-react"
import { useRouter } from "next/navigation"
import type { ConfermatoCentro } from "@/app/actions/centroDirettaActions"
import { oraBreve } from "@/lib/diretta/home"

// Stessa scheda contatto della ricerca in alto (caricata solo al primo clic).
const ContactDrawer = dynamic(
    () => import("@/components/ContactDrawer").then(mod => mod.ContactDrawer),
    { ssr: false },
)

function dataOra(iso: string): string {
    const p = new Intl.DateTimeFormat("it-IT", {
        timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso))
    const v = (t: string) => p.find(x => x.type === t)?.value ?? ""
    return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`
}

/** Stato come in Monitor Vendite: l'esito del venditore se c'è, altrimenti Confermato. */
function stato(r: ConfermatoCentro): { label: string; cls: string } {
    if (r.esitoVenditore === "Chiuso") return { label: "Chiuso", cls: "border-[#1F6B4F] bg-[#173D2F] text-[#8FE6BF]" }
    if (r.esitoVenditore === "Non chiuso") return { label: "Non chiuso", cls: "border-[#7A2E3A] bg-[#3D1A20] text-[#F5A3B0]" }
    if (r.esitoVenditore === "Sparito") return { label: "Sparito", cls: "border-[#4D4D4D] bg-[#333333] text-[#CCCCCC]" }
    return { label: "Confermato", cls: "border-[#1F5D46] bg-[#163A2D] text-[#7FE0B5]" }
}

export function ConfermatiOggi({ righe }: { righe: ConfermatoCentro[] }) {
    const [aperto, setAperto] = useState<string | null>(null)
    const router = useRouter()

    if (righe.length === 0) {
        return <div className="py-4 text-center text-[14px] text-[#A6A6A6]">Oggi le Conferme non hanno ancora confermato appuntamenti.</div>
    }

    return (
        <>
            <ul className="-mx-1 max-h-[32rem] divide-y-2 divide-[#2E2E2E] overflow-y-auto">
                {righe.map(r => {
                    const badge = stato(r)
                    return (
                        <li key={r.leadId} className="flex flex-wrap items-center gap-3 px-1 py-3">
                            <div className="w-[112px] shrink-0 font-mono text-[12px] font-bold text-[#F2F2F2]">
                                {r.appuntamento ? dataOra(r.appuntamento) : "—"}
                            </div>
                            <div className="min-w-0 flex-1">
                                <button
                                    type="button"
                                    onClick={() => setAperto(r.leadId)}
                                    title="Apri la scheda del lead"
                                    className="block max-w-full truncate text-left text-[14px] font-semibold text-[#F2F2F2] hover:text-[#FF9330] hover:underline"
                                >
                                    {r.lead || "Senza nome"}
                                </button>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#A6A6A6]">
                                    {r.gdo && <span className="rounded border border-[#4B3F7A] bg-[#2A2340] px-1.5 py-0.5 font-bold text-[#C9B8FF]">{r.gdo}</span>}
                                    {r.funnel && <span className="uppercase">{r.funnel}</span>}
                                    {r.telefono && <span className="flex items-center gap-0.5 font-mono"><Phone className="h-3 w-3" aria-hidden="true" />{r.telefono}</span>}
                                    {r.nota && <span className="max-w-[200px] truncate italic" title={r.nota}>— {r.nota}</span>}
                                </div>
                                <div className="mt-0.5 text-[12px] text-[#BFBFBF]">
                                    Confermato alle <span className="tabular-nums text-[#F2F2F2]">{oraBreve(new Date(r.confermatoAlle))}</span>
                                    {r.conferme ? <> da <span className="text-[#F2F2F2]">{r.conferme}</span></> : null}
                                </div>
                            </div>
                            <div className="shrink-0 text-[12px] font-semibold text-[#E6E6E6]">{r.venditore || "—"}</div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                        </li>
                    )
                })}
            </ul>
            {aperto && (
                <ContactDrawer
                    isOpen
                    leadId={aperto}
                    onClose={() => { setAperto(null); router.refresh() }}
                    diretta
                />
            )}
        </>
    )
}
