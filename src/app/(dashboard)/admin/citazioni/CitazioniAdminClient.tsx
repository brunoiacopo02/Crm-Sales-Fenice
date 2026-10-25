"use client"

// Approvazione di citazioni e consigli di vendita, giorno per giorno (PO 25/10/2026).
// In cima quanti giorni sono ancora senza riflessione o consiglio approvati,
// con il filtro "da sistemare"; sotto, per ogni giorno, citazione e consiglio:
// testo, autore e opera, fonte della traduzione, riflessione suggerita con la
// sua fonte, campo per modificarla o riscriverla (al massimo 10 righe) e i
// pulsanti Approva, Togli approvazione e Cambia frase. I giorni approvati si
// chiudono in una scheda corta, che si riapre con Modifica.
// Ogni giorno l'admin può anche saltare la frase ed estrarne un'altra a caso
// (con la sua spiegazione), scegliere se la spiegazione va online e scrivere
// una frase sua, con autore e spiegazione.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { approveQuoteDay, assignQuoteToDay, drawAnotherQuote, listQuoteChoices, unapproveQuoteDay, writeOwnQuote } from "@/app/actions/quoteActions"
import { countLines, REFLECTION_MAX_LINES } from "@/lib/quotes/display"
import type { ActionResult, AdminCalendarDay, AdminDayEntry, AdminQuote, QuoteChoice } from "@/lib/quotes/adminTypes"
import { giornoDaSistemare, giorniTesto, maiuscola, riepilogoCalendario, statoVoce, statoVoceTesto } from "@/lib/diretta/centro"
import { bottone } from "@/components/diretta/admin/ui"

type Kind = "citazione" | "vendita"
type LoadChoices = (kind: Kind) => Promise<QuoteChoice[] | string>

const KIND_LABEL: Record<Kind, string> = { citazione: "Citazione", vendita: "Consiglio di vendita" }
const USAGE_LABEL: Record<string, string> = {
    applica: "da applicare",
    riconosci_e_difenditi: "da riconoscere, per difendersi",
}

const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

const CAMPO_BASE = "w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] placeholder:text-[#8C8C8C] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"
const CAMPO = `${CAMPO_BASE} py-2 leading-relaxed`
const CERCA = `${CAMPO_BASE} h-10`

export function CitazioniAdminClient({ days, closedDays }: { days: AdminCalendarDay[]; closedDays: string[] }) {
    const [soloDaSistemare, setSoloDaSistemare] = useState(false)

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

    const riepilogo = useMemo(() => riepilogoCalendario(days), [days])
    const daSistemare = useMemo(() => days.filter(giornoDaSistemare), [days])
    const mostrati = soloDaSistemare ? daSistemare : days

    if (days.length === 0) {
        return <div className="mt-8 text-[15px] text-[#BFBFBF]">Nessun giorno lavorativo nei prossimi tre mesi.</div>
    }

    return (
        <div className="mt-8 flex flex-col gap-8">
            <section aria-label="Da approvare" className="rounded-[16px] bg-[#262626] p-5 sm:p-6">
                <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
                    <Conteggio etichetta="Senza riflessione approvata" n={riepilogo.citazioni.length} su={riepilogo.giorni} />
                    <Conteggio etichetta="Senza consiglio approvato" n={riepilogo.consigli.length} su={riepilogo.giorni} />
                </div>
                {daSistemare.length > 0 ? (
                    <div className="mt-5 border-t-2 border-[#2E2E2E] pt-4">
                        <div className="text-[14px] text-[#BFBFBF]">
                            Da sistemare: {giorniTesto(daSistemare.length)}, con una frase da approvare o mancante.
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {daSistemare.map(d => (
                                <a
                                    key={d.day}
                                    href={`#giorno-${d.day}`}
                                    className="rounded-[8px] border-2 border-[#3D3D3D] px-2.5 py-1 text-[13px] tabular-nums text-[#F2F2F2] transition-colors hover:border-[#BFBFBF]"
                                >
                                    {shortDate(d.day)}
                                </a>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="mt-5 border-t-2 border-[#2E2E2E] pt-4 text-[14px] text-[#BFBFBF]">
                        Tutti i giorni hanno citazione e consiglio approvati.
                    </div>
                )}
                <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Quali giorni mostrare">
                    <button type="button" aria-pressed={!soloDaSistemare} onClick={() => setSoloDaSistemare(false)} className={bottone(!soloDaSistemare ? "scelto" : "linea", "piccola")}>
                        Tutti i giorni
                    </button>
                    <button type="button" aria-pressed={soloDaSistemare} onClick={() => setSoloDaSistemare(true)} className={bottone(soloDaSistemare ? "scelto" : "linea", "piccola")}>
                        Solo da sistemare
                    </button>
                </div>
            </section>

            {mostrati.length === 0 && (
                <div className="text-[15px] text-[#BFBFBF]">Nessun giorno da sistemare.</div>
            )}

            {mostrati.map(d => (
                <section key={d.day} id={`giorno-${d.day}`} aria-label={d.label} className="scroll-mt-6">
                    <h2 className="text-[20px] font-semibold leading-snug">
                        {maiuscola(d.label)}
                        {d.isToday && <span className="font-normal text-[#BFBFBF]">, oggi</span>}
                    </h2>
                    <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
                        {(["citazione", "vendita"] as const).map(kind => (
                            <EntryCard
                                key={`${kind}-${d[kind].quote?.id ?? "vuoto"}-${d[kind].approved ? 1 : 0}-${d[kind].showReflection ? 1 : 0}-${d[kind].reflection ?? ""}`}
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
                <div className="text-[14px] text-[#BFBFBF]">
                    Ufficio chiuso, giorni saltati: {closedDays.map(shortDate).join(", ")}.
                </div>
            )}
        </div>
    )
}

function Conteggio({ etichetta, n, su }: { etichetta: string; n: number; su: number }) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <div className="text-[15px]">{etichetta}</div>
            <div className="shrink-0 tabular-nums">
                <span className={`text-[28px] font-semibold leading-none ${n > 0 ? "text-[#FF9330]" : ""}`}>{n}</span>
                <span className="ml-1.5 text-[14px] text-[#BFBFBF]">su {giorniTesto(su)}</span>
            </div>
        </div>
    )
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
    const iniziale = entry.reflection ?? q?.suggestedReflection ?? ""
    const [text, setText] = useState(iniziale)
    const [error, setError] = useState<string | null>(null)
    const [picking, setPicking] = useState(false)
    const [aperta, setAperta] = useState(!entry.approved)
    const [online, setOnline] = useState(entry.showReflection)
    const [scrivendo, setScrivendo] = useState(false)
    const [pending, startTransition] = useTransition()
    const lines = countLines(text)
    const tooLong = lines > REFLECTION_MAX_LINES
    const stato = statoVoce(entry)
    const nomeTesto = kind === "citazione" ? "riflessione" : "consiglio"
    const nonSalvato = entry.approved && (text.trim() !== (entry.reflection ?? "").trim() || online !== entry.showReflection)

    const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
        setError(null)
        startTransition(async () => {
            try {
                const r = await fn()
                if (!r.ok) {
                    setError(r.error)
                    return
                }
                after?.()
                router.refresh()
            } catch {
                setError("Connessione assente. Riprova tra poco.")
            }
        })
    }

    const approva = () => run(() => approveQuoteDay(day, kind, text, online))
    const estrai = () => run(() => drawAnotherQuote(day, kind), () => { onAssigned(); setPicking(false); setScrivendo(false) })
    const apriScelta = () => { setScrivendo(false); setPicking(p => !p) }
    const apriScrivi = () => { setPicking(false); setScrivendo(s => !s) }
    const altreAzioni = (
        <div className="ml-auto flex flex-wrap items-center gap-1">
            <button type="button" className={bottone("testo", "piccola")} disabled={pending} onClick={estrai}>
                {q ? "Salta, estrai un'altra" : "Estrai a caso"}
            </button>
            <button type="button" className={bottone("testo", "piccola")} disabled={pending} onClick={apriScelta} aria-expanded={picking}>
                {picking ? "Chiudi la scelta" : q ? "Cambia frase" : "Scegli tu"}
            </button>
            <button type="button" className={bottone("testo", "piccola")} disabled={pending} onClick={apriScrivi} aria-expanded={scrivendo}>
                {scrivendo ? "Chiudi" : "Scrivi la tua"}
            </button>
        </div>
    )

    return (
        <article className="flex min-w-0 flex-col gap-4 rounded-[16px] bg-[#262626] p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-semibold">{KIND_LABEL[kind]}</h3>
                <div className={`text-[13px] ${stato === "da_approvare" || stato === "manca" ? "font-semibold text-[#FF9330]" : "text-[#BFBFBF]"}`}>
                    {statoVoceTesto(stato, kind)}
                </div>
            </div>

            {q ? (
                <>
                    <QuoteDetails quote={q} kind={kind} />

                    {!aperta ? (
                        <>
                            {entry.reflection?.trim() ? (
                                <div className="border-t-2 border-[#2E2E2E] pt-4">
                                    <div className="text-[13px] text-[#BFBFBF]">
                                        {kind === "citazione" ? "Riflessione approvata" : "Consiglio approvato"}
                                        {!entry.showReflection && <span className="font-semibold text-[#FF9330]">, non online: si vede solo la frase</span>}
                                    </div>
                                    <div className={`mt-1 whitespace-pre-line text-[14px] leading-relaxed ${entry.showReflection ? "" : "text-[#8C8C8C]"}`}>{entry.reflection}</div>
                                </div>
                            ) : (
                                <div className="border-t-2 border-[#2E2E2E] pt-4 text-[14px] text-[#BFBFBF]">
                                    {kind === "citazione" ? "Si vede solo la citazione, senza Approfondisci." : "Si vede solo la frase, senza consiglio."}
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" className={bottone("linea", "piccola")} disabled={pending} onClick={() => setAperta(true)}>
                                    Modifica
                                </button>
                                <button type="button" className={bottone("linea", "piccola")} disabled={pending} onClick={() => run(() => unapproveQuoteDay(day, kind))}>
                                    Togli approvazione
                                </button>
                                {altreAzioni}
                            </div>
                        </>
                    ) : (
                        <>
                            {q.suggestedReflection && (
                                <div className="border-t-2 border-[#2E2E2E] pt-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-[13px] text-[#BFBFBF]">
                                            {kind === "citazione" ? "Riflessione suggerita" : "Consiglio suggerito"}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {q.reflectionSource && <SourceLink href={q.reflectionSource} label="Fonte" />}
                                            <button
                                                type="button"
                                                className={bottone("testo", "piccola")}
                                                onClick={() => setText(q.suggestedReflection ?? "")}
                                                disabled={pending || text === q.suggestedReflection}
                                            >
                                                Usa questo testo
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-[#BFBFBF]">{q.suggestedReflection}</div>
                                </div>
                            )}

                            <div className="border-t-2 border-[#2E2E2E] pt-4">
                                <label htmlFor={`txt-${kind}-${day}`} className="text-[13px] text-[#BFBFBF]">
                                    {kind === "citazione" ? "Riflessione da mostrare in Approfondisci" : "Consiglio da mostrare in Approfondisci"}
                                </label>
                                <textarea
                                    id={`txt-${kind}-${day}`}
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                    rows={8}
                                    className={`${CAMPO} mt-1.5 resize-y`}
                                    placeholder={kind === "citazione" ? "Vuoto: il giorno resta con la sola citazione." : "Vuoto: si vede solo la frase, se c'è."}
                                />
                                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                                    <div className={`tabular-nums ${tooLong ? "font-semibold text-[#FF9330]" : "text-[#BFBFBF]"}`}>
                                        {lines} righe su {REFLECTION_MAX_LINES}{tooLong ? ", troppe: va accorciato" : ""}
                                    </div>
                                    {nonSalvato && <div className="text-[#BFBFBF]">Modifiche non salvate</div>}
                                </div>
                                <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[14px]">
                                    <input
                                        type="checkbox"
                                        checked={online && !!text.trim()}
                                        disabled={pending || !text.trim()}
                                        onChange={e => setOnline(e.target.checked)}
                                        className="h-5 w-5 accent-[#FF9330]"
                                    />
                                    <span>
                                        {kind === "citazione" ? "Metti online la riflessione" : "Metti online il consiglio"}
                                        <span className="text-[#BFBFBF]">{online || !text.trim() ? ", in Approfondisci" : ": spento, si vede solo la frase"}</span>
                                    </span>
                                </label>
                                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                                    {kind === "vendita" && !entry.approved && (
                                        <div className="text-[#BFBFBF]">
                                            {q.text.trim() ? "Senza approvazione si vede solo la frase." : "Senza frase e senza approvazione quel giorno non c'è consiglio."}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" className={bottone("primario")} disabled={pending || tooLong} onClick={approva}>
                                    {text.trim() ? "Approva" : `Approva senza ${nomeTesto}`}
                                </button>
                                {entry.approved && (
                                    <button type="button" className={bottone("linea")} disabled={pending} onClick={() => run(() => unapproveQuoteDay(day, kind))}>
                                        Togli approvazione
                                    </button>
                                )}
                                {entry.approved && (
                                    <button type="button" className={bottone("testo")} disabled={pending} onClick={() => { setText(iniziale); setOnline(entry.showReflection); setAperta(false) }}>
                                        Annulla
                                    </button>
                                )}
                                <button type="button" className={bottone("testo")} disabled={pending || !text} onClick={() => setText("")}>
                                    Svuota
                                </button>
                                {altreAzioni}
                            </div>
                        </>
                    )}
                </>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[14px] text-[#BFBFBF]">Nessuna frase assegnata a questo giorno.</div>
                    {altreAzioni}
                </div>
            )}

            {error && <div role="alert" className="text-[14px] font-semibold text-[#FF9330]">{error}</div>}

            {scrivendo && (
                <OwnQuoteForm
                    day={day}
                    kind={kind}
                    approved={entry.approved}
                    pending={pending}
                    onSave={(input) => run(() => writeOwnQuote(day, kind, input), () => { onAssigned(); setScrivendo(false) })}
                />
            )}

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

const FRASE_MAX_RIGHE = 2

function OwnQuoteForm({ day, kind, approved, pending, onSave }: {
    day: string
    kind: Kind
    approved: boolean
    pending: boolean
    onSave: (input: { text: string; author: string; reflection: string; showReflection: boolean }) => void
}) {
    const [frase, setFrase] = useState("")
    const [autore, setAutore] = useState("")
    const [spiegazione, setSpiegazione] = useState("")
    const [online, setOnline] = useState(true)
    const righeFrase = countLines(frase)
    const righe = countLines(spiegazione)
    const troppa = righeFrase > FRASE_MAX_RIGHE || righe > REFLECTION_MAX_LINES
    const id = `own-${kind}-${day}`
    return (
        <div className="flex flex-col gap-3 border-t-2 border-[#2E2E2E] pt-4">
            <div className="text-[13px] text-[#BFBFBF]">
                {approved ? "Il giorno è approvato: la tua frase prende il suo posto, già approvata." : "La tua frase prende il posto di quella del giorno, già approvata."}
            </div>
            <div>
                <label htmlFor={`${id}-frase`} className="text-[13px] text-[#BFBFBF]">{kind === "citazione" ? "Citazione" : "Frase del consiglio"}</label>
                <textarea id={`${id}-frase`} value={frase} onChange={e => setFrase(e.target.value)} rows={2} className={`${CAMPO} mt-1.5 resize-y`} />
                <div className={`mt-1 text-[13px] tabular-nums ${righeFrase > FRASE_MAX_RIGHE ? "font-semibold text-[#FF9330]" : "text-[#BFBFBF]"}`}>
                    {righeFrase} righe su {FRASE_MAX_RIGHE}
                </div>
            </div>
            <div>
                <label htmlFor={`${id}-autore`} className="text-[13px] text-[#BFBFBF]">Autore</label>
                <input id={`${id}-autore`} value={autore} onChange={e => setAutore(e.target.value)} maxLength={80} className={`${CERCA} mt-1.5`} />
            </div>
            <div>
                <label htmlFor={`${id}-spieg`} className="text-[13px] text-[#BFBFBF]">
                    {kind === "citazione" ? "Riflessione (facoltativa)" : "Consiglio (facoltativo)"}
                </label>
                <textarea id={`${id}-spieg`} value={spiegazione} onChange={e => setSpiegazione(e.target.value)} rows={6} className={`${CAMPO} mt-1.5 resize-y`} />
                <div className={`mt-1 text-[13px] tabular-nums ${righe > REFLECTION_MAX_LINES ? "font-semibold text-[#FF9330]" : "text-[#BFBFBF]"}`}>
                    {righe} righe su {REFLECTION_MAX_LINES}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-[14px]">
                    <input
                        type="checkbox"
                        checked={online && !!spiegazione.trim()}
                        disabled={pending || !spiegazione.trim()}
                        onChange={e => setOnline(e.target.checked)}
                        className="h-5 w-5 accent-[#FF9330]"
                    />
                    <span>{kind === "citazione" ? "Metti online la riflessione" : "Metti online il consiglio"}</span>
                </label>
            </div>
            <div>
                <button
                    type="button"
                    className={bottone("primario")}
                    disabled={pending || troppa || !frase.trim() || !autore.trim()}
                    onClick={() => onSave({ text: frase, author: autore, reflection: spiegazione, showReflection: online })}
                >
                    Salva e approva
                </button>
            </div>
        </div>
    )
}

function SourceLink({ href, label }: { href: string; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2.5 text-[14px] text-[#F2F2F2] underline-offset-2 transition-colors hover:bg-[#2E2E2E] hover:underline"
        >
            {label}
            <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        </a>
    )
}

function QuoteDetails({ quote, kind }: { quote: AdminQuote; kind: Kind }) {
    const phrase = quote.text.trim()
    const meta = [
        quote.theme ? `Tema: ${quote.theme}` : null,
        quote.occasions.length > 0 ? `Occasioni: ${quote.occasions.join(", ")}` : null,
        quote.translator ? `Traduzione di ${quote.translator}` : null,
    ].filter(Boolean)
    return (
        <div className="flex flex-col gap-2">
            {phrase ? (
                <blockquote className="text-[17px] font-medium leading-snug">{phrase}</blockquote>
            ) : (
                <div className="text-[14px] text-[#BFBFBF]">Senza frase dell&apos;autore.</div>
            )}
            <div className="text-[14px]">
                {quote.author}
                {quote.work && <span className="text-[#BFBFBF]">, {quote.work}</span>}
                {quote.reference && <span className="text-[#BFBFBF]"> ({quote.reference})</span>}
            </div>
            {kind === "vendita" && (quote.technique || quote.usage) && (
                <div className="text-[14px] text-[#BFBFBF]">
                    {quote.technique && <>Tecnica: {quote.technique}</>}
                    {quote.technique && quote.usage && USAGE_LABEL[quote.usage] && ", "}
                    {quote.usage && USAGE_LABEL[quote.usage]}
                </div>
            )}
            {meta.length > 0 && <div className="text-[13px] text-[#BFBFBF]">{meta.join(". ")}.</div>}
            {quote.originalText && (
                <div className="text-[13px] leading-relaxed text-[#BFBFBF]">Originale: {quote.originalText}</div>
            )}
            {quote.translationUrl ? (
                <div className="-ml-2.5 flex">
                    <SourceLink href={quote.translationUrl} label={kind === "citazione" ? "Fonte della traduzione" : "Fonte della frase"} />
                </div>
            ) : (
                <div className="text-[13px] text-[#BFBFBF]">{kind === "citazione" ? "Manca il link alla traduzione." : "Manca il link alla fonte."}</div>
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
        }).catch(() => { if (alive) setLoadError("Elenco non disponibile.") })
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
        <div className="flex flex-col gap-2 border-t-2 border-[#2E2E2E] pt-4">
            {approved && (
                <div className="text-[13px] text-[#BFBFBF]">Il giorno è approvato: cambiando frase l&apos;approvazione si toglie.</div>
            )}
            <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Cerca per testo, autore, tema"
                aria-label={kind === "citazione" ? "Cerca una citazione" : "Cerca un consiglio"}
                className={CERCA}
            />
            {loadError && <div className="text-[14px] font-semibold text-[#FF9330]">{loadError}</div>}
            {!items && !loadError && <div className="text-[14px] text-[#BFBFBF]">Caricamento</div>}
            {items && shown.length === 0 && <div className="text-[14px] text-[#BFBFBF]">Nessuna frase trovata.</div>}
            <div className="max-h-96 overflow-y-auto">
                {shown.map(it => (
                    <div key={it.id} className="flex items-start justify-between gap-3 border-t-2 border-[#2E2E2E] py-2.5 first:border-t-0">
                        <div className="min-w-0">
                            <div className="line-clamp-2 text-[14px]">{it.text.trim() || it.technique || "Senza frase"}</div>
                            <div className="text-[13px] text-[#BFBFBF]">
                                {it.author}{it.theme ? `, ${it.theme}` : ""}
                                {it.usedOn.length > 0 && `, in calendario il ${it.usedOn.slice(-3).map(shortDate).join(", ")}`}
                            </div>
                        </div>
                        <button type="button" className={bottone("linea", "piccola")} disabled={pending} onClick={() => onChoose(it.id)}>
                            Usa questa
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
