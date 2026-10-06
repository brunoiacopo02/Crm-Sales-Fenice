"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { CalendarClock, Check, CheckCircle2, Clock, Copy, Mail, MessageSquare, Phone, PhoneMissed, Rocket, XCircle } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import {
    getVenditoreLancioAppuntamenti,
    getVenditoreLancioLeads,
    recordLancioCallNowNoAnswer,
    saveLancioOutcome,
    setLancioRecall,
    type LancioAppuntamento,
    type LancioCallNowLead,
} from "@/app/actions/lancioActions"
import { NOT_CLOSED_REASONS } from "@/lib/surveys/questions"
import { onBusEvent } from "@/lib/realtimeBus"

type Vista = "stasera" | "domani"

/** Campi comuni alle due liste: bastano alla scheda del lead. */
type LeadScheda = {
    id: string; name: string; phone: string; email: string | null
    lancioBotInfo: { risposte?: string[]; richiamo?: { at: string; nota?: string | null } } | null; appointmentNote: string | null
    salespersonOutcome: string | null; version: number
}

const PACCHETTI = [
    { value: "advance", label: "Advance" },
    { value: "gold", label: "Gold" },
    { value: "exclusive", label: "Exclusive" },
] as const

const COLONNE_SERA = [
    { key: "richiami", title: "Richiami" },
    { key: "da_chiamare", title: "Da chiamare" },
    { key: "seconda", title: "Seconda chiamata" },
    { key: "terza", title: "Terza chiamata" },
    { key: "esitati", title: "Esitati" },
] as const

/** Richiamo fissato dal venditore e lead non ancora esitato: sta nella colonna Richiami. */
const haRichiamo = (l: { lancioBotInfo: LeadScheda["lancioBotInfo"]; salespersonOutcome: string | null }) =>
    !!l.lancioBotInfo?.richiamo?.at && !l.salespersonOutcome

const ora = (iso: string | null) => (iso ? format(new Date(iso), "HH:mm", { locale: it }) : null)

/**
 * Sezione "Lead del lancio" (PO 05/10/2026): stasera le chiamate subito,
 * domani gli appuntamenti del mattino. Telefono e racconto del bot sempre in
 * chiaro, esito diretto dalla scheda: niente "Inizia trattativa".
 */
export function LeadLancioClient({ sellerId }: { sellerId: string }) {
    const [vista, setVista] = useState<Vista>("stasera")
    const [sera, setSera] = useState<LancioCallNowLead[]>([])
    const [mattina, setMattina] = useState<LancioAppuntamento[]>([])
    const [loading, setLoading] = useState(true)
    // L'ora della lettura: i "richiama fra N minuti" si contano da qui.
    const [adesso, setAdesso] = useState(0)

    const carica = useCallback(async () => {
        try {
            const [s, m] = await Promise.all([getVenditoreLancioLeads(sellerId), getVenditoreLancioAppuntamenti(sellerId)])
            setSera(s)
            setMattina(m)
            setAdesso(Date.now())
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }, [sellerId])

    useEffect(() => {
        carica()
        // Ping a ogni cambio sui lead della company (stesso bus della dashboard):
        // la chiamata subito appena assegnata compare da sola.
        const off = onBusEvent("leads", () => { carica() })
        // Rete di sicurezza: i "richiama fra N minuti" vanno ricontati.
        const t = setInterval(carica, 60_000)
        return () => { off(); clearInterval(t) }
    }, [carica])

    const daChiamare = sera.filter(l => l.column !== "esitati").length
    const domaniAperti = mattina.filter(l => !l.salespersonOutcome).length

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-4 flex items-center gap-2">
                <Rocket className="h-6 w-6 text-amber-500" />
                <h1 className="text-2xl font-bold text-ash-900">Lead del lancio</h1>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
                <TabButton active={vista === "stasera"} onClick={() => setVista("stasera")} label="Stasera: chiamate subito" count={daChiamare} />
                <TabButton active={vista === "domani"} onClick={() => setVista("domani")} label="Appuntamenti di domani" count={domaniAperti} />
            </div>

            {loading ? (
                <div className="py-16 text-center text-sm text-ash-500">Caricamento…</div>
            ) : vista === "stasera" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                    {COLONNE_SERA.map(col => {
                        const items = col.key === "richiami"
                            ? sera.filter(haRichiamo).sort((a, b) => (a.lancioBotInfo?.richiamo?.at ?? "").localeCompare(b.lancioBotInfo?.richiamo?.at ?? ""))
                            : sera.filter(l => !haRichiamo(l) && l.column === col.key)
                        return (
                            <div key={col.key} className="rounded-xl border border-ash-200/60 bg-white p-3 shadow-soft">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-bold uppercase tracking-wide text-ash-700">{col.title}</h3>
                                    <span className="rounded-full bg-ash-100 px-2 py-0.5 text-xs font-bold text-ash-600">{items.length}</span>
                                </div>
                                <div className="space-y-3">
                                    {items.length === 0 && <div className="py-4 text-center text-xs text-ash-400">Nessun lead</div>}
                                    {items.map(lead => (
                                        <SchedaLead
                                            key={lead.id}
                                            lead={lead}
                                            orario={`Richiesta alle ${ora(lead.lancioSceltaAt) ?? "—"}`}
                                            richiamo={col.key !== "esitati" ? lead.lancioCallNowNextAt : null}
                                            adesso={adesso}
                                            conNonRisponde={col.key !== "esitati"}
                                            onChanged={carica}
                                        />
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {mattina.length === 0 && (
                        <div className="col-span-full rounded-xl border border-ash-200/60 bg-white py-10 text-center text-sm text-ash-500">
                            Nessun appuntamento del lancio per domani, per ora.
                        </div>
                    )}
                    {mattina.map(lead => (
                        <SchedaLead
                            key={lead.id}
                            lead={lead}
                            orario={lead.appointmentDate
                                ? format(new Date(lead.appointmentDate), "EEEE d MMMM 'alle' HH:mm", { locale: it })
                                : "Orario non indicato"}
                            esitoDettaglio={lead.salespersonOutcome === "Chiuso"
                                ? `${lead.closeProduct ?? ""} ${lead.closeAmountEur ? `€${lead.closeAmountEur}` : ""}`.trim()
                                : lead.notClosedReason}
                            richiamo={null}
                            adesso={adesso}
                            conNonRisponde={false}
                            onChanged={carica}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${active ? "bg-brand-orange text-white" : "border border-ash-200 bg-white text-ash-700 hover:border-brand-orange"}`}
        >
            {label}
            {count > 0 && (
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold ${active ? "bg-white text-brand-orange" : "bg-amber-500 text-white"}`}>{count}</span>
            )}
        </button>
    )
}

function SchedaLead({ lead, orario, richiamo, adesso, conNonRisponde, esitoDettaglio, onChanged }: {
    lead: LeadScheda
    orario: string
    richiamo: string | null
    adesso: number
    conNonRisponde: boolean
    esitoDettaglio?: string | null
    onChanged: () => void
}) {
    const [modo, setModo] = useState<null | "chiuso" | "non_chiuso">(null)
    const [importo, setImporto] = useState("")
    const [pacchetto, setPacchetto] = useState<"" | "advance" | "gold" | "exclusive">("")
    const [motivo, setMotivo] = useState("")
    const [note, setNote] = useState("")
    const [errore, setErrore] = useState<string | null>(null)
    // Esito già dato: si può correggere (PO 05/10).
    const [modifica, setModifica] = useState(false)
    // Richiamo (PO 06/10): giorno, ora e nota, come un GDO coi suoi lead.
    const [richiamoAperto, setRichiamoAperto] = useState(false)
    const [richiamoAt, setRichiamoAt] = useState("")
    const [richiamoNota, setRichiamoNota] = useState("")
    const fissato = lead.lancioBotInfo?.richiamo ?? null

    const salvaRichiamo = (togli = false) => {
        setErrore(null)
        start(async () => {
            try {
                // datetime-local e' l'ora di chi lo compila (Italia): new Date lo legge cosi'.
                const res = await setLancioRecall(lead.id, togli ? null : new Date(richiamoAt).toISOString(), richiamoNota || undefined)
                if (!res.ok) { setErrore(res.error); return }
                setRichiamoAperto(false)
                setRichiamoAt("")
                setRichiamoNota("")
                onChanged()
            } catch {
                setErrore("Errore di rete: il richiamo non è stato salvato. Riprova.")
            }
        })
    }
    const [pending, start] = useTransition()

    const [copiato, setCopiato] = useState(false)
    const copiaNumero = () => {
        navigator.clipboard?.writeText(lead.phone)
            .then(() => { setCopiato(true); setTimeout(() => setCopiato(false), 1500) })
            .catch(() => undefined)
    }

    const richiamaTra = richiamo ? Math.max(0, Math.round((new Date(richiamo).getTime() - adesso) / 60_000)) : null
    const risposte = lead.lancioBotInfo?.risposte ?? []

    const salva = () => {
        setErrore(null)
        start(async () => {
            try {
                const res = modo === "chiuso"
                    ? await saveLancioOutcome(lead.id, {
                        outcome: "Chiuso",
                        closeAmountEur: Number(importo.replace(",", ".")),
                        closeProduct: pacchetto || null,
                        notes: note || undefined,
                    }, lead.version)
                    : await saveLancioOutcome(lead.id, { outcome: "Non chiuso", notClosedReason: motivo, notes: note || undefined }, lead.version)
                if (!res.ok) { setErrore(res.error); return }
                setModo(null)
                setModifica(false)
                onChanged()
            } catch {
                setErrore("Errore di rete: l'esito non è stato salvato. Riprova.")
            }
        })
    }

    const nonRisponde = () => {
        setErrore(null)
        start(async () => {
            try {
                const res = await recordLancioCallNowNoAnswer(lead.id)
                if (!res.ok) { setErrore(res.error); return }
                if (res.handoff) alert(res.verso === "pool" ? "Terzo tentativo a vuoto: il lead torna nel pool GDO." : "Terzo tentativo a vuoto: il lead passa alle Conferme.")
                onChanged()
            } catch {
                setErrore("Errore di rete: il tentativo non è stato registrato. Riprova.")
            }
        })
    }

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <div className="font-bold text-ash-900">{lead.name}</div>
            <div className="mt-1 flex items-center gap-1.5">
                <Phone className="h-4 w-4 shrink-0 text-ash-400" />
                <span className="select-all text-base font-semibold text-ash-900">{lead.phone}</span>
                <button
                    type="button"
                    onClick={copiaNumero}
                    title="Copia il numero"
                    className="inline-flex items-center gap-1 rounded-md border border-ash-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-ash-600 transition-colors hover:border-brand-orange hover:text-brand-orange"
                >
                    {copiato ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiato ? "Copiato" : "Copia"}
                </button>
            </div>
            {lead.email && (
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ash-600">
                    <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{lead.email}</span>
                </div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-xs text-ash-600">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" /> {orario}
            </div>

            {(risposte.length > 0 || lead.appointmentNote) && (
                <div className="mt-2 space-y-1 rounded-md bg-white/80 p-2 text-sm text-ash-800">
                    <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ash-500">
                        <MessageSquare className="h-3 w-3" /> Cosa ha detto in chat
                    </div>
                    {risposte.map((r, i) => <div key={i}>• {r}</div>)}
                    {lead.appointmentNote && <div className="whitespace-pre-line text-ash-600">{lead.appointmentNote}</div>}
                </div>
            )}

            {fissato && !lead.salespersonOutcome && (
                <div className={`mt-2 rounded-md px-2 py-1 text-xs font-semibold ${new Date(fissato.at).getTime() <= adesso ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-800"}`}>
                    <div className="flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        Richiamo {format(new Date(fissato.at), "EEE d MMM 'alle' HH:mm", { locale: it })}
                        {new Date(fissato.at).getTime() <= adesso ? " · da fare ora" : ""}
                    </div>
                    {fissato.nota && <div className="mt-0.5 font-normal italic">{fissato.nota}</div>}
                </div>
            )}

            {richiamaTra !== null && !fissato && (
                <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {richiamaTra > 0 ? `richiama fra ${richiamaTra} min` : "da richiamare ora"}
                </div>
            )}

            {lead.salespersonOutcome && !modifica ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className={`text-sm font-bold ${lead.salespersonOutcome === "Chiuso" ? "text-emerald-700" : "text-red-700"}`}>
                        {lead.salespersonOutcome}{esitoDettaglio ? ` · ${esitoDettaglio}` : ""}
                    </div>
                    <button
                        onClick={() => { setModifica(true); setErrore(null) }}
                        className="rounded-lg border border-ash-200 bg-white px-2.5 py-1 text-xs font-semibold text-ash-700 transition-colors hover:border-brand-orange hover:text-brand-orange"
                    >
                        Modifica esito
                    </button>
                </div>
            ) : modo === null ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        onClick={() => setModo("chiuso")}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Chiuso
                    </button>
                    <button
                        onClick={() => setModo("non_chiuso")}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                        <XCircle className="h-3.5 w-3.5" /> Non chiuso
                    </button>
                    {conNonRisponde && !lead.salespersonOutcome && (
                        <button
                            onClick={nonRisponde}
                            disabled={pending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-xs font-semibold text-ash-700 transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                        >
                            <PhoneMissed className="h-3.5 w-3.5" /> Non risponde
                        </button>
                    )}
                    {conNonRisponde && !lead.salespersonOutcome && (
                        <button
                            onClick={() => { setRichiamoAperto(v => !v); setErrore(null) }}
                            disabled={pending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:border-sky-400 disabled:opacity-50"
                        >
                            <CalendarClock className="h-3.5 w-3.5" /> {fissato ? "Sposta richiamo" : "Richiamo"}
                        </button>
                    )}
                    {modifica && (
                        <button onClick={() => setModifica(false)} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-semibold text-ash-700">
                            Annulla
                        </button>
                    )}
                </div>
            ) : (
                <div className="mt-3 space-y-2 rounded-md border border-ash-200 bg-white p-2">
                    {modo === "chiuso" ? (
                        <>
                            <label className="block text-xs font-semibold text-ash-700">
                                Importo (€)
                                <input
                                    type="number" inputMode="decimal" min="1" value={importo}
                                    onChange={e => setImporto(e.target.value)}
                                    className="mt-1 w-full rounded-md border border-ash-200 px-2 py-1.5 text-sm"
                                    autoFocus
                                />
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {PACCHETTI.map(p => (
                                    <button
                                        key={p.value} type="button"
                                        onClick={() => setPacchetto(pacchetto === p.value ? "" : p.value)}
                                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pacchetto === p.value ? "bg-emerald-600 text-white" : "border border-ash-200 text-ash-700"}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <label className="block text-xs font-semibold text-ash-700">
                            Motivo
                            <select value={motivo} onChange={e => setMotivo(e.target.value)} className="mt-1 w-full rounded-md border border-ash-200 px-2 py-1.5 text-sm">
                                <option value="">Scegli…</option>
                                {NOT_CLOSED_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </label>
                    )}
                    <textarea
                        value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note (facoltative)"
                        className="w-full rounded-md border border-ash-200 px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={salva}
                            disabled={pending || (modo === "chiuso" ? !(Number(importo.replace(",", ".")) > 0) : !motivo)}
                            className="rounded-lg bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                        >
                            {pending ? "Salvo…" : "Salva esito"}
                        </button>
                        <button onClick={() => { setModo(null); setErrore(null) }} disabled={pending} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-semibold text-ash-700">
                            Annulla
                        </button>
                    </div>
                </div>
            )}
            {richiamoAperto && !lead.salespersonOutcome && (
                <div className="mt-3 space-y-2 rounded-md border border-sky-200 bg-white p-2">
                    <label className="block text-xs font-semibold text-ash-700">
                        Quando richiamare
                        <input
                            type="datetime-local" value={richiamoAt} onChange={e => setRichiamoAt(e.target.value)}
                            className="mt-1 w-full rounded-md border border-ash-200 px-2 py-1.5 text-sm"
                        />
                    </label>
                    <input
                        value={richiamoNota} onChange={e => setRichiamoNota(e.target.value)} placeholder="Nota (es. richiamare dopo il lavoro)"
                        className="w-full rounded-md border border-ash-200 px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => salvaRichiamo()}
                            disabled={pending || !richiamoAt}
                            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                        >
                            {pending ? "Salvo…" : "Salva richiamo"}
                        </button>
                        {fissato && (
                            <button onClick={() => salvaRichiamo(true)} disabled={pending} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-semibold text-ash-700">
                                Togli richiamo
                            </button>
                        )}
                        <button onClick={() => setRichiamoAperto(false)} disabled={pending} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-semibold text-ash-700">
                            Annulla
                        </button>
                    </div>
                </div>
            )}
            {errore && <div className="mt-2 text-xs font-semibold text-red-700">{errore}</div>}
        </div>
    )
}
