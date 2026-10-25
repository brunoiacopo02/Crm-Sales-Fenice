"use client"

// Citazione del giorno e consiglio di vendita (PO 25/10/2026).
// Si vede solo il testo (massimo due righe) e l'autore; "Approfondisci" apre
// opera e riflessione solo quando l'admin le ha approvate. Sotto, il consiglio
// di vendita del giorno con il suo "Approfondisci".
//
// Stile Diretta con le variabili --d-*, ma con i colori espliciti di riserva:
// venditori e admin lo vedono fuori da [data-ui="diretta"], con la UI vecchia.
// Senza `initial` legge da solo i dati del giorno (es. schermata d'inizio turno).

import Link from "next/link"
import { useEffect, useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { getTodayQuotes } from "@/app/actions/quoteActions"
import type { ShownQuote, TodayQuotes } from "@/lib/quotes/display"

interface Props {
    /** Dati già letti sul server; se manca, il componente li chiede da solo. */
    initial?: TodayQuotes | null
    /** Solo admin: link alla pagina di approvazione. */
    manageHref?: string
    className?: string
    /**
     * Riga compatta della home GDO (collaudo del 25/10/2026): la citazione resta
     * consultabile dopo la schermata d'inizio turno. Citazione in due righe al
     * massimo e autore; "Approfondisci" apre riflessione e consiglio di vendita.
     */
    compatta?: boolean
}

export function DailyQuoteSlot({ initial, manageHref, className = "", compatta = false }: Props) {
    const [data, setData] = useState<TodayQuotes | null>(initial ?? null)

    useEffect(() => {
        if (initial !== undefined) return
        let alive = true
        getTodayQuotes()
            .then(d => { if (alive) setData(d) })
            .catch(() => { /* niente citazione: lo spazio resta vuoto */ })
        return () => { alive = false }
    }, [initial])

    if (!data || (!data.citazione && !data.vendita)) return null

    if (compatta) return <RigaCompatta data={data} className={className} />

    return (
        <section
            aria-label="Citazione del giorno"
            className={`rounded-[16px] bg-[color:var(--d-surface,#262626)] px-4 py-4 text-[color:var(--d-text,#F2F2F2)] sm:px-5 ${className}`}
            style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
        >
            {data.citazione && <QuoteBlock kind="citazione" item={data.citazione} />}
            {data.citazione && data.vendita && <div className="my-3 h-px bg-[color:var(--d-line,#3D3D3D)]" />}
            {data.vendita && <QuoteBlock kind="vendita" item={data.vendita} />}
            {manageHref && (
                <div className="mt-3 flex justify-end">
                    <Link
                        href={manageHref}
                        className="rounded-[8px] px-2 py-1 text-[13px] text-[color:var(--d-muted,#BFBFBF)] transition-colors hover:bg-[color:var(--d-surface-2,#2E2E2E)] hover:text-[color:var(--d-text,#F2F2F2)]"
                    >
                        Calendario e approvazioni
                    </Link>
                </div>
            )}
        </section>
    )
}

export default DailyQuoteSlot

/** La frase del giorno in poco spazio: la citazione (o il consiglio, se manca) e un solo "Approfondisci". */
function RigaCompatta({ data, className }: { data: TodayQuotes; className: string }) {
    const [open, setOpen] = useState(false)
    const panelId = useId()
    const principale = data.citazione ?? data.vendita
    if (!principale) return null
    const altro = data.citazione ? data.vendita : null
    const haDettagli = !!principale.deepen || !!altro
    return (
        <section
            aria-label="Frase del giorno"
            className={`rounded-[16px] bg-[color:var(--d-surface,#262626)] px-4 py-3.5 text-[color:var(--d-text,#F2F2F2)] ${className}`}
            style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
        >
            <div className="text-[13px] text-[color:var(--d-muted,#BFBFBF)]">{data.citazione ? 'Frase del giorno' : 'Consiglio di vendita'}</div>
            {principale.text && (
                <blockquote className="mt-1 line-clamp-2 text-[14px] font-medium leading-snug" title={principale.text}>
                    {principale.text}
                </blockquote>
            )}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <div className="min-w-0 truncate text-[12px] text-[color:var(--d-muted,#BFBFBF)]">{principale.author}</div>
                {haDettagli && (
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] font-medium transition-colors hover:bg-[color:var(--d-surface-2,#2E2E2E)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--d-orange,#FF9330)]"
                    >
                        Approfondisci
                        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
                    </button>
                )}
            </div>
            {haDettagli && (
                <div id={panelId} hidden={!open} className="mt-2 space-y-3">
                    {principale.deepen && (
                        <div>
                            {principale.deepen.work && (
                                <div className="text-[12px] text-[color:var(--d-muted,#BFBFBF)]">{principale.deepen.work}</div>
                            )}
                            <div className="mt-1 whitespace-pre-line text-[13px] leading-relaxed">{principale.deepen.text}</div>
                        </div>
                    )}
                    {altro && (
                        <div className="border-t-2 border-[color:var(--d-line,#3D3D3D)] pt-3">
                            <QuoteBlock kind="vendita" item={altro} />
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}

/** Più la citazione è lunga, più il corpo scende: deve restare in due righe. */
function quoteSize(text: string): string {
    if (text.length > 150) return "text-[15px]"
    if (text.length > 110) return "text-base"
    return "text-[17px]"
}

function QuoteBlock({ kind, item }: { kind: "citazione" | "vendita"; item: ShownQuote }) {
    const [open, setOpen] = useState(false)
    const panelId = useId()

    return (
        <div>
            {kind === "vendita" && (
                <div className="mb-1 text-[13px] text-[color:var(--d-muted,#BFBFBF)]">Consiglio di vendita</div>
            )}
            {item.text && (kind === "citazione" ? (
                <blockquote className={`max-w-[46rem] font-medium leading-[1.45] text-balance ${quoteSize(item.text)}`}>
                    {item.text}
                </blockquote>
            ) : (
                <div className="max-w-[46rem] text-[15px] font-medium leading-snug text-balance">{item.text}</div>
            ))}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="text-[13px] text-[color:var(--d-muted,#BFBFBF)]">{item.author}</div>
                {item.deepen && (
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[color:var(--d-text,#F2F2F2)] transition-colors hover:bg-[color:var(--d-surface-2,#2E2E2E)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--d-orange,#FF9330)]"
                    >
                        Approfondisci
                        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
                    </button>
                )}
            </div>
            {item.deepen && (
                <div id={panelId} hidden={!open} className="mt-3 max-w-[46rem]">
                    {item.deepen.work && (
                        <div className="text-[13px] text-[color:var(--d-muted,#BFBFBF)]">{item.deepen.work}</div>
                    )}
                    <div className="mt-1 whitespace-pre-line text-[14px] leading-relaxed">{item.deepen.text}</div>
                </div>
            )}
        </div>
    )
}
