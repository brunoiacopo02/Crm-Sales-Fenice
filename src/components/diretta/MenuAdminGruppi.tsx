"use client"

// Menu dell'admin nella Rinascita a gruppi a tendina (PO 25/10/2026): la lista
// lunga diventa "Sales Manager", "GDO", "Conferme"… che si aprono al clic. Il
// gruppo con la pagina corrente si apre da solo; aperti e chiusi restano
// ricordati in questo browser (localStorage, sempre dentro try/catch: in una
// finestra privata il menu funziona lo stesso, solo non ricorda).

import Link from "next/link"
import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import { gruppoDellaPagina, voceAttiva, type GruppoMenu, type VoceGruppo } from "@/components/diretta/menu"

const CHIAVE = "fenice.menuAdmin.gruppiAperti.v1"

function leggiAperti(): Record<string, boolean> {
    try {
        const grezzo = window.localStorage.getItem(CHIAVE)
        if (!grezzo) return {}
        const v = JSON.parse(grezzo)
        if (!v || typeof v !== "object" || Array.isArray(v)) return {}
        const out: Record<string, boolean> = {}
        for (const [k, b] of Object.entries(v)) if (typeof b === "boolean") out[k] = b
        return out
    } catch {
        return {}
    }
}

function scriviAperti(aperti: Record<string, boolean>) {
    try {
        window.localStorage.setItem(CHIAVE, JSON.stringify(aperti))
    } catch { /* storage non disponibile: il menu non ricorda, nient'altro */ }
}

export function MenuAdminGruppi({ centro, gruppi, pathname }: {
    centro: VoceGruppo
    gruppi: GruppoMenu[]
    pathname: string | null
}) {
    const corrente = gruppoDellaPagina(gruppi, pathname)
    // Solo le scelte fatte a mano si ricordano; il gruppo della pagina corrente
    // è aperto in più, finché non lo si chiude (fino al prossimo cambio pagina).
    // Al primo disegno (anche lato server) le scelte salvate non ci sono ancora:
    // niente differenze di idratazione, arrivano dopo il mount.
    const [aperti, setAperti] = useState<Record<string, boolean>>({})
    const [chiusoQui, setChiusoQui] = useState<string | null>(null)

    useEffect(() => {
        setAperti(leggiAperti())
    }, [])

    // Cambio pagina: il gruppo che la contiene torna ad aprirsi da solo.
    useEffect(() => {
        setChiusoQui(null)
    }, [pathname])

    const isAperto = (label: string) => !!aperti[label] || (label === corrente && chiusoQui !== label)

    const alterna = (label: string) => {
        const ora = isAperto(label)
        if (label === corrente) setChiusoQui(ora ? label : null)
        setAperti(prima => {
            const dopo = { ...prima, [label]: !ora }
            scriviAperti(dopo)
            return dopo
        })
    }

    // Evidenziata una voce sola: quella più lunga che contiene la pagina
    // (su /admin/diretta/registro il registro, non il centro di controllo).
    const evidenziata = [centro, ...gruppi.flatMap(g => g.items)]
        .filter(v => voceAttiva(v.href, pathname))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href

    const voce = (item: VoceGruppo) => {
        const attiva = item.href === evidenziata
        return (
            <Link
                key={item.href}
                href={item.href}
                aria-current={attiva ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${attiva ? "bg-[#262626] font-medium text-[#F2F2F2]" : "text-[#BFBFBF] hover:text-[#F2F2F2]"}`}
            >
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                <span className="min-w-0 truncate">{item.name}</span>
                {item.badge !== undefined && item.badge > 0 && (
                    <span className="ml-auto text-[13px] font-semibold tabular-nums text-[#FF9330]">{item.badge}</span>
                )}
            </Link>
        )
    }

    return (
        <>
            <div className="space-y-1">{voce(centro)}</div>
            <div className="mt-3 space-y-1 border-t-2 border-[#262626] pt-3">
                {gruppi.map(g => {
                    // Voci senza gruppo (menu fatto di sole voci): niente tendina.
                    if (!g.label) return <div key="voci" className="space-y-0.5">{g.items.map(voce)}</div>
                    const aperto = isAperto(g.label)
                    const idVoci = `menu-gruppo-${g.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
                    const daFare = g.items.reduce((n, v) => n + (v.badge ?? 0), 0)
                    const contienePagina = g.label === corrente
                    return (
                        <div key={g.label}>
                            <button
                                type="button"
                                onClick={() => alterna(g.label)}
                                aria-expanded={aperto}
                                aria-controls={idVoci}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] font-medium transition-colors hover:bg-[#262626] hover:text-[#F2F2F2] ${contienePagina ? "text-[#F2F2F2]" : "text-[#BFBFBF]"}`}
                            >
                                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                                {!aperto && daFare > 0 && (
                                    <span className="text-[13px] font-semibold tabular-nums text-[#FF9330]">{daFare}</span>
                                )}
                                <ChevronDown
                                    aria-hidden="true"
                                    strokeWidth={1.5}
                                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${aperto ? "rotate-180" : ""}`}
                                />
                            </button>
                            {aperto && (
                                <div id={idVoci} className="mb-2 ml-3 space-y-0.5 border-l-2 border-[#2E2E2E] pl-2">
                                    {g.items.map(voce)}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </>
    )
}
