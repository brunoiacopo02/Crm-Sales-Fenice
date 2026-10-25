"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { approveQuoteDay, assignQuoteToDay, listQuoteChoices, unapproveQuoteDay } from "@/app/actions/quoteActions"
import { countLines, REFLECTION_MAX_LINES } from "@/lib/quotes/display"
import type { ActionResult, AdminCalendarDay, AdminDayEntry, AdminQuote, QuoteChoice } from "@/lib/quotes/adminTypes"

type Kind = "citazione" | "vendita"
type LoadChoices = (kind: Kind) => Promise<QuoteChoice[] | string>

const KIND_LABEL: Record<Kind, string> = { citazione: "Citazione", vendita: "Consiglio di vendita" }
const USAGE_LABEL: Record<string, string> = {
    applica: "da applicare",
    riconosci_e_difenditi: "da riconoscere, per difendersi",
}

const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

const BTN_PRIMARY = "rounded-lg bg-[#FF9330] px-3 py-1.5 text-sm font-medium text-[#171717] transition-colors hover:bg-[#F28420] disabled:cursor-not-allowed disabled:opacity-50"
const BTN_SECONDARY = "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
const BTN_TEXT = "rounded-lg px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"

export function CitazioniAdminClient({ days, closedDays }: { days: AdminCalendarDay[]; closedDays: string[] }) {
    // Elenco delle citazioni per il cambio: si carica alla prima richiesta e si
    // butta dopo ogni cambio (i "già in calendario" cambiano).
    const cache = useRef<Partial<Record<Kind, QuoteChoice[]>>>({})
    const loadChoices = useCallback<LoadChoices>(async (kind) => {
        const cached = cache.current[kind]
        if (cached) return cached
        const r = await listQuoteChoices(kind)
        if (!r.ok) return r.error
        cache.current[kind] = r.items
        return r.items
    }, [])
    const resetChoices = useCallback(() => { cache.current = {} }, [])

    if (days.length === 0) {
        return <div className="text-sm text-gray-600">Nessun giorno lavorativo nei prossimi tre mesi.</div>
    }

    return (
        <div className="space-y-8">
            {days.map(d => (
                <section key={d.day} aria-label={d.label} className="space-y-3">
                    <h2 className="text-base font-semibold text-gray-900">
                        {capitalize(d.label)}
                        {d.isToday && <span className="font-normal text-gray-500">, oggi</span>}
                    </h2>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {(["citazione", "vendita"] as const).map(kind => (
                            <EntryCard
                                key={`${kind}-${d[kind].quote?.id ?? "vuoto"}-${d[kind].approved ? 1 : 0}-${d[kind].reflection ?? ""}`}
                                day={d.day}
                                kind={kind}
                                entry={d[kind]}
                                loadChoices={loadChoices}
                                onAssigned={resetChoices}
                            />
                        ))}
                    </div>
                </section>
            ))}
            {closedDays.length > 0 && (
                <div className="text-sm text-gray-600">
                    Ufficio chiuso, giorni saltati: {closedDays.map(shortDate).join(", ")}.
                </div>
            )}
        </div>
    )
}

function statusOf(entry: AdminDayEntry): { text: string; tone: string } {
    if (!entry.quote) return { text: "Nessuna citazione", tone: "text-gray-500" }
    if (!entry.approved) return { text: "Da approvare", tone: "text-[#B45309]" }
    return entry.reflection
        ? { text: "Approvata, con approfondimento", tone: "text-green-700" }
        : { text: "Approvata, senza approfondimento", tone: "text-green-700" }
}

function EntryCard({ day, kind, entry, loadChoices, onAssigned }: {
    day: string
    kind: Kind
    entry: AdminDayEntry
    loadChoices: LoadChoices
    onAssigned: () => void
}) {
    const router = useRouter()
    const q = entry.quote
    const [text, setText] = useState(entry.reflection ?? q?.suggestedReflection ?? "")
    const [error, setError] = useState<string | null>(null)
    const [picking, setPicking] = useState(false)
    const [pending, startTransition] = useTransition()
    const lines = countLines(text)
    const tooLong = lines > REFLECTION_MAX_LINES
    const status = statusOf(entry)

    const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
        setError(null)
        startTransition(async () => {
            const r = await fn()
            if (!r.ok) {
                setError(r.error)
                return
            }
            after?.()
            router.refresh()
        })
    }

    return (
        <article className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900">{KIND_LABEL[kind]}</h3>
                <div className={`text-xs font-medium ${status.tone}`}>{status.text}</div>
            </div>

            {q ? (
                <>
                    <QuoteDetails quote={q} kind={kind} />

                    {q.suggestedReflection && (
                        <div className="space-y-1 border-t border-gray-100 pt-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-medium text-gray-500">
                                    {kind === "citazione" ? "Bozza di riflessione suggerita" : "Consiglio suggerito"}
                                </div>
                                <div className="flex items-center gap-1">
                                    {q.reflectionSource && <SourceLink href={q.reflectionSource} label="Fonte" />}
                                    <button type="button" className={BTN_TEXT} onClick={() => setText(q.suggestedReflection ?? "")} disabled={pending}>
                                        Usa la bozza
                                    </button>
                                </div>
                            </div>
                            <div className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{q.suggestedReflection}</div>
                        </div>
                    )}

                    <div className="space-y-1 border-t border-gray-100 pt-3">
                        <label htmlFor={`txt-${kind}-${day}`} className="text-xs font-medium text-gray-500">
                            {kind === "citazione" ? "Riflessione da mostrare in Approfondisci" : "Consiglio da mostrare in Approfondisci"}
                        </label>
                        <textarea
                            id={`txt-${kind}-${day}`}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            rows={8}
                            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed text-gray-900 focus:border-[#FF9330] focus:outline-none"
                            placeholder={kind === "citazione" ? "Vuoto: il giorno resta con la sola citazione." : "Vuoto: si vede solo la frase, se c'è."}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className={`text-xs tabular-nums ${tooLong ? "font-medium text-red-600" : "text-gray-500"}`}>
                                {lines}/{REFLECTION_MAX_LINES} righe
                            </div>
                            {kind === "vendita" && !entry.approved && (
                                <div className="text-xs text-gray-500">
                                    {q.text.trim() ? "Senza approvazione si vede solo la frase." : "Senza frase: senza approvazione quel giorno non c'è consiglio."}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className={BTN_PRIMARY} disabled={pending || tooLong} onClick={() => run(() => approveQuoteDay(day, kind, text))}>
                            Approva
                        </button>
                        <button type="button" className={BTN_SECONDARY} disabled={pending || !entry.approved} onClick={() => run(() => unapproveQuoteDay(day, kind))}>
                            Rimuovi approvazione
                        </button>
                        <button type="button" className={BTN_TEXT} disabled={pending || !text} onClick={() => setText("")}>
                            Svuota
                        </button>
                        <button type="button" className={`${BTN_TEXT} ml-auto`} disabled={pending} onClick={() => setPicking(p => !p)} aria-expanded={picking}>
                            {picking ? "Chiudi la scelta" : "Cambia citazione"}
                        </button>
                    </div>
                </>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-gray-600">Nessuna citazione assegnata a questo giorno.</div>
                    <button type="button" className={BTN_SECONDARY} disabled={pending} onClick={() => setPicking(p => !p)} aria-expanded={picking}>
                        {picking ? "Chiudi la scelta" : "Scegli una citazione"}
                    </button>
                </div>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}

            {picking && (
                <Picker
                    kind={kind}
                    approved={entry.approved}
                    currentId={q?.id ?? null}
                    pending={pending}
                    loadChoices={loadChoices}
                    onChoose={(id) => run(() => assignQuoteToDay(day, kind, id), () => { onAssigned(); setPicking(false) })}
                />
            )}
        </article>
    )
}

function SourceLink({ href, label }: { href: string; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-700 underline-offset-2 hover:bg-gray-100 hover:underline"
        >
            {label}
            <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        </a>
    )
}

function QuoteDetails({ quote, kind }: { quote: AdminQuote; kind: Kind }) {
    const phrase = quote.text.trim()
    return (
        <div className="space-y-2">
            {phrase ? (
                <blockquote className="text-[15px] font-medium leading-snug text-gray-900">{phrase}</blockquote>
            ) : (
                <div className="text-sm text-gray-500">Senza frase dell&apos;autore.</div>
            )}
            <div className="text-sm text-gray-700">
                {quote.author}
                {quote.work && <span className="text-gray-500">, {quote.work}</span>}
                {quote.reference && <span className="text-gray-500"> ({quote.reference})</span>}
            </div>
            {kind === "vendita" && (quote.technique || quote.usage) && (
                <div className="text-sm text-gray-700">
                    {quote.technique && <>Tecnica: {quote.technique}</>}
                    {quote.technique && quote.usage && USAGE_LABEL[quote.usage] && ", "}
                    {quote.usage && USAGE_LABEL[quote.usage]}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                {quote.theme && <div>Tema: {quote.theme}</div>}
                {quote.occasions.length > 0 && <div>Occasioni: {quote.occasions.join(", ")}</div>}
                {quote.translator && <div>Traduzione di {quote.translator}</div>}
            </div>
            {quote.originalText && (
                <div className="text-xs leading-relaxed text-gray-500">Originale: {quote.originalText}</div>
            )}
            {quote.translationUrl && (
                <div className="flex">
                    <SourceLink href={quote.translationUrl} label={kind === "citazione" ? "Controlla la traduzione" : "Controlla la fonte della frase"} />
                </div>
            )}
        </div>
    )
}

function Picker({ kind, approved, currentId, pending, loadChoices, onChoose }: {
    kind: Kind
    approved: boolean
    currentId: string | null
    pending: boolean
    loadChoices: LoadChoices
    onChoose: (id: string) => void
}) {
    const [items, setItems] = useState<QuoteChoice[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    useEffect(() => {
        let alive = true
        loadChoices(kind).then(r => {
            if (!alive) return
            if (typeof r === "string") setLoadError(r)
            else setItems(r)
        })
        return () => { alive = false }
    }, [kind, loadChoices])

    const shown = useMemo(() => {
        if (!items) return []
        const f = fold(query.trim())
        const list = items.filter(it => it.id !== currentId && (!f || fold(`${it.text} ${it.author} ${it.theme ?? ""} ${it.technique ?? ""} ${it.work ?? ""}`).includes(f)))
        // Prima quelle mai in calendario.
        return [...list].sort((a, b) => a.usedOn.length - b.usedOn.length).slice(0, 40)
    }, [items, query, currentId])

    return (
        <div className="space-y-2 border-t border-gray-100 pt-3">
            {approved && (
                <div className="text-xs text-[#B45309]">Il giorno è approvato: cambiando citazione l&apos;approvazione si toglie.</div>
            )}
            <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Cerca per testo, autore, tema"
                aria-label="Cerca una citazione"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#FF9330] focus:outline-none"
            />
            {loadError && <div className="text-sm text-red-600">{loadError}</div>}
            {!items && !loadError && <div className="text-sm text-gray-500">Caricamento…</div>}
            {items && shown.length === 0 && <div className="text-sm text-gray-500">Nessuna citazione trovata.</div>}
            <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
                {shown.map(it => (
                    <div key={it.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0 space-y-0.5">
                            <div className="line-clamp-2 text-sm text-gray-900">{it.text.trim() || it.technique || "Senza frase"}</div>
                            <div className="text-xs text-gray-500">
                                {it.author}{it.theme ? `, ${it.theme}` : ""}
                                {it.usedOn.length > 0 && `, in calendario il ${it.usedOn.slice(-3).map(shortDate).join(", ")}`}
                            </div>
                        </div>
                        <button type="button" className={`${BTN_SECONDARY} shrink-0`} disabled={pending} onClick={() => onChoose(it.id)}>
                            Usa questa
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
