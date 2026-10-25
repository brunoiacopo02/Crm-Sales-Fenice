"use client"

import { useState, useEffect, memo } from "react"
import { Phone, Mail, Calendar as CalendarIcon, CalendarClock, Clock, CheckCircle2, MoreVertical, Copy, AlertTriangle, Zap, FileText, X, MessageSquare, StickyNote, Sparkles, Users, Loader2, PhoneMissed, Pencil, Star } from "lucide-react"
import { useRouter } from "next/navigation"
import { GdoQuickActions } from "./GdoQuickActions"
import { ScriptWidget } from "./ScriptWidget"
import { AgendaButton } from "./AgendaButton"
import { CompanyBadge } from "./CompanyBadge"
import { RecallDateTimePicker } from "./DateTimePickers"
import { useDirettaUi } from "./diretta/DirettaUi"
import { getLeadsWithSamePhone } from "@/app/actions/pipelineActions"
import { updateRecallDetails } from "@/app/actions/recallActions"
import { tempoDaArrivo } from "@/lib/diretta/arrivo"
import { funnelLeggibile } from "@/lib/diretta/funnel"
import { dataOraRoma } from "@/lib/diretta/formato"

type LeadProps = {
    lead: {
        id: string
        name: string
        phone: string
        email: string | null
        funnel: string | null
        companyId?: string | null
        callCount: number
        lastCallDate: Date | null
        status: string
        version: number
        recallDate?: Date | null
        appointmentDate?: Date | null
        lastCallNote?: string | null
        recallNote?: string | null
        agendaSentAt?: Date | null
        agendaStatus?: string | null
        createdAt?: Date | null
        source?: string | null
        phoneSuspicious?: boolean | null
        duplicatePhone?: boolean
        /** Tornato dal bot con un si' gia' dato: aveva confermato, o ha risposto dopo il 3o NR. */
        confermatoAlBot?: boolean
        /** Ridato dal bot con chat interrotta: da chiamare per primo (PO 19/10/2026). */
        chiamaPerPrimo?: boolean
        /** Ha chiesto di parlare con una persona: richiesta di contatto ancora aperta. */
        tiHaCercato?: boolean
        /** Solo le parole del lead nella richiesta (tooltip del badge "Ti ha cercato"). */
        cercatoMotivo?: string | null
        recallMissedAt?: Date | null
        /** Ultima assegnazione al GDO che lo ha in mano: "arrivato X fa", calcolato nel browser. */
        arrivedAt?: Date | string | null
        /** Lead fresco di oggi mai toccato: in cima alla 1ª chiamata con la riga "Appena arrivato: chiamalo subito". */
        vergine?: boolean
    }
    onOutcomeClick: (leadId: string) => void
    isRowLayout?: boolean
}

const ONE_HOUR_MS = 60 * 60 * 1000

// --- Funnel Rarity System (styling only) ---
type FunnelRarity = 'gold' | 'silver' | 'bronze'

const FUNNEL_RARITY_MAP: Record<string, FunnelRarity> = {
    'CORSO 10 ORE': 'gold',
    'JOB SIMULATOR': 'gold',
    'TELEGRAM': 'silver',
    'TELEGRAM-TK': 'silver',
    'GOOGLE': 'silver',
    'ORG': 'bronze',
    'DATABASE': 'bronze',
    'SOCIAL': 'bronze',
}

const RARITY_STYLES: Record<FunnelRarity, {
    border: string
    hoverGlow: string
    badgeBg: string
    badgeText: string
    badgeBorder: string
    accentGradient: string
}> = {
    gold: {
        border: 'border-l-amber-400',
        hoverGlow: 'hover:shadow-[0_0_18px_-4px_rgba(255,215,0,0.35)]',
        badgeBg: 'bg-amber-50',
        badgeText: 'text-amber-700',
        badgeBorder: 'border-amber-300/70',
        accentGradient: 'before:from-amber-400 before:via-yellow-300 before:to-amber-500',
    },
    silver: {
        border: 'border-l-slate-400',
        hoverGlow: 'hover:shadow-[0_0_18px_-4px_rgba(148,163,184,0.35)]',
        badgeBg: 'bg-slate-50',
        badgeText: 'text-slate-600',
        badgeBorder: 'border-slate-300/70',
        accentGradient: 'before:from-slate-400 before:via-slate-300 before:to-slate-400',
    },
    bronze: {
        border: 'border-l-orange-400/70',
        hoverGlow: 'hover:shadow-[0_0_18px_-4px_rgba(194,130,80,0.3)]',
        badgeBg: 'bg-orange-50/70',
        badgeText: 'text-orange-700/80',
        badgeBorder: 'border-orange-300/50',
        accentGradient: 'before:from-orange-400/70 before:via-orange-300/60 before:to-orange-400/70',
    },
}

function getFunnelRarity(funnel: string | null): FunnelRarity {
    if (!funnel) return 'bronze'
    return FUNNEL_RARITY_MAP[funnel.toUpperCase()] ?? 'bronze'
}

type DuplicateInfo = {
    id: string
    name: string
    funnel: string | null
    status: string
    callCount: number
    lastCallDate: string | null
    recallDate: string | null
    appointmentDate: string | null
    salespersonOutcome: string | null
    discardReason: string | null
    assignedToName: string | null
    /** Numero in mano al bot, visto da un GDO: si dice solo che è in lavorazione. */
    inLavorazione?: boolean
}

function describeDuplicate(d: DuplicateInfo): string {
    if (d.salespersonOutcome) return `Esito venditore: ${d.salespersonOutcome}`
    if (d.status === 'APPOINTMENT') return `Appuntamento ${d.appointmentDate ? new Date(d.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : 'fissato'}`
    if (d.status === 'REJECTED') return `Scartato${d.discardReason ? ` (${d.discardReason})` : ''}`
    if (d.recallDate) return `Richiamo ${new Date(d.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}`
    if (d.callCount > 0) return `${d.callCount} tentativ${d.callCount === 1 ? 'o' : 'i'}${d.lastCallDate ? `, ultimo ${new Date(d.lastCallDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}` : ''}`
    return 'Mai chiamato'
}

function toLocalInputValue(d: Date): string {
    const dt = new Date(d)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

export const LeadCard = memo(function LeadCard({ lead, onOutcomeClick, isRowLayout = false }: LeadProps) {
    const router = useRouter()
    // Diretta (PO 25/10/2026): sotto il provider della board la card prende la veste scura.
    const direttaUi = useDirettaUi()
    const [showScript, setShowScript] = useState(false)
    const [showNoteModal, setShowNoteModal] = useState(false)
    const [showDupModal, setShowDupModal] = useState(false)
    const [dupList, setDupList] = useState<DuplicateInfo[] | null>(null)
    const [showEditRecall, setShowEditRecall] = useState(false)
    const [editRecallDate, setEditRecallDate] = useState("")
    const [editRecallNote, setEditRecallNote] = useState("")
    const [savingRecall, setSavingRecall] = useState(false)

    const openEditRecall = (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault()
        setEditRecallDate(lead.recallDate ? toLocalInputValue(new Date(lead.recallDate)) : "")
        setEditRecallNote(lead.recallNote || "")
        setShowEditRecall(true)
    }

    const saveEditRecall = async () => {
        if (!editRecallDate) return
        setSavingRecall(true)
        try {
            const res = await updateRecallDetails(lead.id, new Date(editRecallDate), editRecallNote || null)
            if (!res.success) {
                alert(res.error)
            } else {
                setShowEditRecall(false)
                router.refresh()
            }
        } catch {
            alert("Errore nel salvataggio del richiamo")
        } finally {
            setSavingRecall(false)
        }
    }

    const openDupModal = (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault()
        setShowDupModal(true)
        if (dupList === null) {
            getLeadsWithSamePhone(lead.id).then((res) => {
                setDupList(res.success ? res.duplicates : [])
            }).catch(() => setDupList([]))
        }
    }
    // Client-side time for expiry checks (avoids hydration mismatch)
    const [clientNow, setClientNow] = useState(0)
    useEffect(() => { setClientNow(Date.now()) }, [])
    // "Arrivato X fa" va avanti da solo: un passo al minuto, solo sulle card che lo mostrano.
    useEffect(() => {
        if (!lead.arrivedAt) return
        const t = setInterval(() => setClientNow(Date.now()), 60_000)
        return () => clearInterval(t)
    }, [lead.arrivedAt])
    const arrivoMs = lead.arrivedAt ? new Date(lead.arrivedAt).getTime() : NaN
    const arrivato = clientNow > 0 && Number.isFinite(arrivoMs) ? tempoDaArrivo(arrivoMs, clientNow) : null

    // Status badge config with gradient styling
    let statusText = "Nuovo"
    let statusClasses = "bg-blue-50 text-blue-700 border-blue-200/60"
    let statusDot = "bg-blue-400"
    let leftAccent = ""

    if (lead.status === 'IN_PROGRESS') {
        if (lead.callCount === 1) {
            statusText = "2ª Chiamata"
            statusClasses = "bg-gold-50 text-gold-700 border-gold-200/60"
            statusDot = "bg-gold-400"
        } else if (lead.callCount === 2) {
            statusText = "3ª Chiamata"
            statusClasses = "bg-ember-50 text-ember-700 border-ember-200/60"
            statusDot = "bg-ember-400"
        }

        if (lead.recallDate) {
            const isExpired = clientNow > 0 && new Date(lead.recallDate).getTime() < clientNow
            if (isExpired) {
                statusText = "Richiamo Scaduto"
                statusClasses = "bg-ember-100 text-ember-700 border-ember-300 font-bold"
                statusDot = "bg-ember-500 animate-glow-pulse"
                leftAccent = "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-gradient-to-b before:from-ember-400 before:to-ember-600 before:rounded-l-xl"
            } else {
                statusText = "Richiamo Arrivo"
                statusClasses = "bg-brand-orange-50 text-brand-orange-700 border-brand-orange-200/60"
                statusDot = "bg-brand-orange-400"
            }
        }
    } else if (lead.status === 'APPOINTMENT') {
        statusText = "Fissato"
        statusClasses = "bg-emerald-50 text-emerald-700 border-emerald-200/60"
        statusDot = "bg-emerald-500"
    }

    const rarity = getFunnelRarity(lead.funnel)
    const rarityStyle = RARITY_STYLES[rarity]

    // Lead "appena arrivato" (creato < 1h fa) — segnalato SOLO per lead
    // importati automaticamente da ActiveCampaign (source='activecampaign').
    // Gli import CSV manuali / storici non accendono il badge.
    // Check client-side per evitare hydration mismatch.
    const isJustArrived = !!(clientNow > 0 && lead.createdAt &&
        lead.source === 'activecampaign' &&
        (clientNow - new Date(lead.createdAt).getTime()) < ONE_HOUR_MS)

    // Note shown in the card: prefer recallNote (preserved across outcomes) over lastCallNote
    const displayNote = lead.recallNote || lead.lastCallNote || ''

    // Script, modifica del richiamo, duplicati e note: le stesse modali per la
    // card classica e per la veste Diretta (frammento: nessun nodo in più).
    const modali = (
        <>
            {/* Script Drawer: nella Diretta il foglio è scuro (collaudo del 25/10/2026),
                colori scritti per esteso perché .fixed rimette la palette chiara. */}
            {showScript && direttaUi.attiva && (
                <div className="fixed inset-0 z-[60] flex justify-end" onClick={(e) => { e.stopPropagation(); setShowScript(false); }}>
                    <div className="absolute inset-0 bg-black/60" />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Script della chiamata con ${lead.name}`}
                        className="relative h-full w-full max-w-2xl overflow-y-auto overflow-x-hidden border-l-2 border-[#262626] bg-[#171717] font-[family-name:var(--font-poppins)] text-[#F2F2F2] [color-scheme:dark]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-[#262626] bg-[#171717] px-4 py-3.5 sm:px-5">
                            <div className="min-w-0">
                                <div className="text-[17px] font-semibold">Script della chiamata</div>
                                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[#BFBFBF]">
                                    <div className="min-w-0 truncate">{lead.name}</div>
                                    <div className="whitespace-nowrap">{lead.phone}</div>
                                </div>
                            </div>
                            <button type="button" onClick={() => setShowScript(false)} aria-label="Chiudi lo script" className="rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                                <X className="h-5 w-5" strokeWidth={1.5} />
                            </button>
                        </div>
                        <div className="p-4 sm:p-5">
                            <ScriptWidget
                                leadId={lead.id}
                                funnel={lead.funnel}
                                leadEmail={lead.email}
                                leadName={lead.name}
                                leadPhone={lead.phone}
                                agendaSentAt={lead.agendaSentAt ?? null}
                                agendaStatus={lead.agendaStatus ?? null}
                                variant="diretta"
                            />
                        </div>
                    </div>
                </div>
            )}
            {showScript && !direttaUi.attiva && (
                <div className="fixed inset-0 z-[60] flex justify-end" onClick={() => setShowScript(false)}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div
                        className="relative w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto animate-slide-in-right"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 bg-white border-b border-ash-200 px-5 py-3 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-ash-800">Script Chiamata</div>
                                <div className="text-xs text-ash-500">{lead.name} — {lead.phone}</div>
                            </div>
                            <button onClick={() => setShowScript(false)} className="p-2 rounded-lg hover:bg-ash-100 transition-colors">
                                <X className="w-5 h-5 text-ash-500" />
                            </button>
                        </div>
                        <div className="p-5">
                            <ScriptWidget
                                leadId={lead.id}
                                funnel={lead.funnel}
                                leadEmail={lead.email}
                                leadName={lead.name}
                                leadPhone={lead.phone}
                                agendaSentAt={lead.agendaSentAt ?? null}
                                agendaStatus={lead.agendaStatus ?? null}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Modifica Richiamo Modal */}
            {showEditRecall && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowEditRecall(false); }}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div
                        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-r from-blue-50 to-blue-100 border-b border-blue-200 px-5 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Pencil className="h-4 w-4 text-blue-600" />
                                <div>
                                    <div className="text-sm font-bold text-ash-900">Modifica Richiamo</div>
                                    <div className="text-xs text-ash-500">{lead.name} — nessuna chiamata registrata</div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setShowEditRecall(false); }} className="p-1.5 rounded-lg hover:bg-blue-200/50 transition-colors">
                                <X className="w-5 h-5 text-ash-600" />
                            </button>
                        </div>
                        <div className="p-4">
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-ash-400 mb-1">Nuova data e ora *</label>
                            <div className="mb-3">
                                <RecallDateTimePicker value={editRecallDate} onChange={setEditRecallDate} compact />
                            </div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-ash-400 mb-1">Note (già compilate)</label>
                            <textarea
                                value={editRecallNote}
                                onChange={(e) => setEditRecallNote(e.target.value)}
                                className="input-fenice !text-xs !py-2 !px-2.5 resize-none h-20 mb-3 w-full"
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={(e) => { e.stopPropagation(); setShowEditRecall(false); }} className="px-2 py-1 text-xs text-ash-500 font-semibold">Annulla</button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); saveEditRecall(); }}
                                    disabled={savingRecall || !editRecallDate}
                                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold disabled:opacity-50"
                                >
                                    {savingRecall ? 'Salvataggio…' : 'Salva richiamo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Duplicati Modal */}
            {showDupModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowDupModal(false); }}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div
                        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-r from-orange-50 to-orange-100 border-b border-orange-200 px-5 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-orange-600" />
                                <div>
                                    <div className="text-sm font-bold text-ash-900">Numero presente su altri lead</div>
                                    <div className="text-xs text-ash-500">{lead.phone} — verifica prima di richiamare</div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setShowDupModal(false); }} className="p-1.5 rounded-lg hover:bg-orange-200/50 transition-colors">
                                <X className="w-5 h-5 text-ash-600" />
                            </button>
                        </div>
                        <div className="p-4 max-h-[60vh] overflow-y-auto">
                            {dupList === null ? (
                                <div className="flex items-center gap-2 py-4 text-sm text-ash-500">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
                                </div>
                            ) : dupList.length === 0 ? (
                                <div className="py-4 text-sm text-ash-500">Nessun altro lead trovato con questo numero.</div>
                            ) : (
                                <div className="space-y-2">
                                    {dupList.map((d) => (
                                        <div key={d.id} className="rounded-lg border border-ash-200 bg-ash-50/50 px-3 py-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm font-semibold text-ash-800 truncate">{d.name}</div>
                                                {d.funnel && <div className="text-[10px] font-bold uppercase text-ash-400 shrink-0">{d.funnel}</div>}
                                            </div>
                                            <div className="mt-0.5 text-xs text-ash-600">
                                                {d.inLavorazione
                                                    ? 'In lavorazione'
                                                    : <>In carico a: <span className="font-semibold">{d.assignedToName}</span></>}
                                            </div>
                                            <div className="text-xs text-ash-500">{describeDuplicate(d)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Note Modal */}
            {showNoteModal && displayNote && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowNoteModal(false)}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div
                        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-r from-amber-50 to-amber-100 border-b border-amber-200 px-5 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <StickyNote className="h-5 w-5 text-amber-600" />
                                <div>
                                    <div className="text-sm font-bold text-ash-900">
                                        {lead.recallNote ? 'Note Richiamo' : 'Note Chiamata Precedente'}
                                    </div>
                                    <div className="text-xs text-ash-500">{lead.name} — {lead.phone}</div>
                                </div>
                            </div>
                            <button onClick={() => setShowNoteModal(false)} className="p-1.5 rounded-lg hover:bg-amber-200/50 transition-colors">
                                <X className="w-5 h-5 text-ash-600" />
                            </button>
                        </div>
                        <div className="p-5">
                            {lead.lastCallDate && (
                                <div className="text-[11px] text-ash-400 mb-2 uppercase tracking-wider font-semibold">
                                    {new Date(lead.lastCallDate).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                                </div>
                            )}
                            <div className="text-sm text-ash-800 leading-relaxed whitespace-pre-wrap">
                                {displayNote}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )

    // ── Veste Diretta (collaudo del 25/10/2026): due righe pulite a 1366, 1600
    // e 1920. Riga 1: nome, segnali, telefono, quando, funnel e gli attrezzi a
    // icone (modifica del richiamo, note, script, agenda). Riga 2: gli esiti e,
    // finché c'è posto, la nota dell'ultima chiamata. Il lead aperto (in cima
    // alla coda) ha il nome più grande, i bottoni esito grandi e la nota sotto.
    // Gli spazi si decidono sulla larghezza della card (@container), così la
    // stessa card vale nella home e in /richiami. Stessi gestori e stesse
    // modali della card classica.
    if (direttaUi.attiva) {
        const aperto = direttaUi.aperto
        const funnel = funnelLeggibile(lead.funnel)
        const richiamo = lead.recallDate ? new Date(lead.recallDate) : null
        const richiamoScaduto = !!richiamo && clientNow > 0 && richiamo.getTime() < clientNow
        const ultima = lead.lastCallDate ? new Date(lead.lastCallDate) : null
        // Quando: il richiamo se c'è, poi l'ultima chiamata, poi l'arrivo.
        let quandoLungo = 'mai chiamato'
        let quandoBreve = 'mai chiamato'
        let IconaQuando = Clock
        if (richiamo) {
            quandoLungo = `${richiamoScaduto ? 'richiamo scaduto' : 'richiamo'} ${dataOraRoma(richiamo)}`
            quandoBreve = dataOraRoma(richiamo)
            IconaQuando = CalendarClock
        } else if (ultima) {
            quandoLungo = `ultima chiamata ${dataOraRoma(ultima)}`
            quandoBreve = dataOraRoma(ultima)
        } else if (arrivato) {
            quandoLungo = `arrivato ${arrivato}`
            quandoBreve = arrivato
        }
        const arrivoInPiu = (richiamo || ultima) && arrivato ? `arrivato ${arrivato}` : null

        const segnale = "inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#3D3D3D] px-2 py-0.5 text-[12px] font-medium text-[#F2F2F2]"
        const attrezzo = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-[#3D3D3D] text-[#F2F2F2] transition-colors hover:border-[#8C8C8C]"
        const icona = "h-4 w-4"

        return (
            <div
                data-lead-card={lead.id}
                className={`@container relative flex flex-col rounded-2xl border-2 bg-[#262626] text-[#F2F2F2] transition-colors ${aperto ? 'gap-3 border-[#FF9330] px-5 py-4' : 'gap-2.5 border-transparent px-4 py-3 hover:border-[#3D3D3D]'}`}
            >
                {/* Vergine del giorno (PO 25/10 mattina): una riga sobria, il lead è già in cima. */}
                {lead.vergine && (
                    <div className="truncate text-[13px] font-medium leading-tight text-[#FF9330]">
                        Appena arrivato: chiamalo subito
                    </div>
                )}

                {/* Riga 1 */}
                <div className="flex min-w-0 items-center gap-x-3 gap-y-2 @max-[560px]:flex-wrap">
                    <div className="flex min-w-0 flex-1 items-center gap-x-3 gap-y-1 @max-[560px]:flex-wrap">
                        {lead.chiamaPerPrimo && (
                            <Star className="h-4 w-4 shrink-0 fill-[#FF9330] text-[#FF9330]" aria-label="Da chiamare per primo" />
                        )}
                        <div
                            className={`min-w-0 max-w-[16rem] shrink truncate font-semibold leading-tight ${aperto ? 'text-[20px]' : 'text-[16px]'} @min-[1000px]:max-w-[22rem]`}
                            title={lead.name}
                        >
                            {lead.name}
                        </div>
                        {lead.tiHaCercato && (
                            <div className={segnale} title={lead.cercatoMotivo ? `Ti ha cercato: "${lead.cercatoMotivo}"` : 'Ti ha cercato'}>
                                <Phone className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                                <div className="sr-only @min-[760px]:not-sr-only">Ti ha cercato</div>
                            </div>
                        )}
                        {lead.confermatoAlBot && (
                            <div className={segnale} title="Aveva già detto sì e l'appuntamento non è mai nato: il sì c'è già.">
                                <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                                <div className="sr-only @min-[760px]:not-sr-only">Aveva detto sì</div>
                            </div>
                        )}
                        {lead.recallMissedAt && (
                            <div className={segnale} title={`Aveva un richiamo e non ha risposto (${dataOraRoma(new Date(lead.recallMissedAt))})`}>
                                <PhoneMissed className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                                <div className="sr-only @min-[760px]:not-sr-only">Richiamo NR</div>
                            </div>
                        )}

                        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] tabular-nums">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-[#8C8C8C]" strokeWidth={1.5} aria-hidden="true" />
                            <div>{lead.phone}</div>
                            {lead.phoneSuspicious && (
                                <AlertTriangle
                                    className="h-3.5 w-3.5 shrink-0 text-[#FF9330]"
                                    aria-label="Telefono forse incompleto: verificalo prima di chiamare"
                                />
                            )}
                            {lead.duplicatePhone && (
                                <button
                                    type="button"
                                    onClick={openDupModal}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#3D3D3D] px-1.5 py-0.5 text-[12px] font-medium text-[#F2F2F2] transition-colors hover:border-[#8C8C8C]"
                                    title="Numero presente su altri lead: clicca per i dettagli"
                                >
                                    <Users className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                                    <div className="sr-only @min-[760px]:not-sr-only">Duplicato</div>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                                className="rounded-lg p-1 text-[#8C8C8C] transition-colors hover:text-[#F2F2F2]"
                                title="Copia numero"
                                aria-label="Copia numero"
                            >
                                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                        </div>

                        <div className="min-w-0 flex-1 truncate text-[13px] text-[#BFBFBF]">
                            <span className={richiamoScaduto ? 'font-medium text-[#FF9330]' : undefined} title={quandoLungo}>
                                <span className="@min-[800px]:hidden">
                                    <IconaQuando className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" strokeWidth={1.5} aria-hidden="true" />
                                    {quandoBreve}
                                </span>
                                <span className="hidden @min-[800px]:inline">{quandoLungo}</span>
                            </span>
                            {funnel && <span className="ml-4 hidden @min-[600px]:inline">{funnel}</span>}
                            {arrivoInPiu && <span className="ml-4 hidden @min-[960px]:inline">{arrivoInPiu}</span>}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        {lead.recallDate && (
                            <button
                                type="button"
                                onClick={openEditRecall}
                                className={attrezzo}
                                title="Modifica data e note del richiamo, senza registrare una chiamata"
                                aria-label="Modifica il richiamo"
                            >
                                <Pencil className={icona} strokeWidth={1.5} />
                            </button>
                        )}
                        {displayNote && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setShowNoteModal(true); }}
                                className={attrezzo}
                                title={displayNote}
                                aria-label="Leggi le note"
                            >
                                <StickyNote className={icona} strokeWidth={1.5} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setShowScript(true); }}
                            className={attrezzo}
                            title="Apri lo script della chiamata"
                            aria-label="Script"
                        >
                            <FileText className={icona} strokeWidth={1.5} />
                        </button>
                        <AgendaButton
                            leadId={lead.id}
                            leadName={lead.name}
                            leadPhone={lead.phone}
                            agendaSentAt={lead.agendaSentAt}
                            agendaStatus={lead.agendaStatus ?? null}
                            variant="diretta"
                        />
                    </div>
                </div>

                {/* Riga 2: gli esiti. Nella card chiusa la nota usa lo spazio che avanza. */}
                {aperto ? (
                    <GdoQuickActions leadId={lead.id} leadVersion={lead.version} recallPrefillNote={lead.recallNote || lead.lastCallNote || null} />
                ) : (
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="shrink-0 @max-[560px]:shrink">
                            <GdoQuickActions leadId={lead.id} leadVersion={lead.version} recallPrefillNote={lead.recallNote || lead.lastCallNote || null} />
                        </div>
                        {displayNote && (
                            <div className="hidden min-w-0 flex-1 truncate text-[13px] text-[#8C8C8C] @min-[640px]:block" title={displayNote}>
                                {displayNote}
                            </div>
                        )}
                    </div>
                )}

                {aperto && displayNote && (
                    <div className="flex min-w-0 items-start gap-2 text-[13px] text-[#BFBFBF]">
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8C8C8C]" strokeWidth={1.5} aria-hidden="true" />
                        <div className="min-w-0 line-clamp-2">{displayNote}</div>
                    </div>
                )}

                {modali}
            </div>
        )
    }


    if (isRowLayout) {
        return (
            <div data-lead-card={lead.id} className={`relative bg-white border border-ash-200/80 border-l-[3px] ${rarityStyle.border} rounded-xl px-4 py-3 shadow-soft ${rarityStyle.hoverGlow} hover:border-brand-orange/30 transition-all duration-200 flex flex-col gap-2 group cursor-pointer ${leftAccent}`}>
                {/* flex-wrap (collaudo del 25/10/2026): in /richiami, largo 1024 px,
                    le azioni di una card con richiamo e note non ci stavano e
                    "Richiamo" e "App Preso" finivano fuori dalla card, con la
                    Diretta accesa o spenta. Ora vanno a capo sotto i dati. */}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">

                {/* 1. Nome & Contatti */}
                <div className="flex-1 min-w-0 sm:min-w-[200px] flex flex-col justify-center">
                    {/* Vergine del giorno (PO 25/10 mattina): una riga sobria al posto
                        del vecchio badge; il lead sta già in cima alla 1ª chiamata. */}
                    {lead.vergine && (
                        <div className="mb-1 text-[13px] font-medium leading-tight text-ash-800">
                            Appena arrivato: chiamalo subito
                        </div>
                    )}
                    <div className="font-bold text-ash-900 text-[15px] leading-tight flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            {lead.chiamaPerPrimo && (
                                <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-label="Da chiamare per primo" />
                            )}
                            {lead.name}
                            {!lead.vergine && isJustArrived && (
                                <span className="shrink-0 text-emerald-500 animate-pulse" title="Appena arrivato (meno di 1 ora fa)">
                                    <Sparkles className="h-4 w-4" />
                                </span>
                            )}
                            {lead.status === 'APPOINTMENT' && (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            )}
                            {lead.callCount > 0 && (
                                <div className="text-[10px] font-bold text-ash-500 bg-ash-100 px-1.5 py-0.5 rounded-md">{lead.callCount}° ch.</div>
                            )}
                            {lead.chiamaPerPrimo && (
                                <div
                                    className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 shrink-0"
                                    title="Da chiamare per primo."
                                >
                                    <Star className="h-3 w-3 fill-amber-400 text-amber-500" /> Chiama per primo
                                </div>
                            )}
                            {lead.tiHaCercato && (
                                <div
                                    className="flex items-center gap-1 rounded-md border border-brand-orange-300 bg-brand-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-orange-700 shrink-0"
                                    title={lead.cercatoMotivo ? `Ti ha cercato\n"${lead.cercatoMotivo}"` : 'Ti ha cercato'}
                                >
                                    <Phone className="h-3 w-3" /> Ti ha cercato
                                </div>
                            )}
                            {lead.confermatoAlBot && (
                                <div
                                    className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 shrink-0"
                                    title="Aveva già detto sì e l'appuntamento non è mai nato. Chiamalo per primo: il sì c'è già."
                                >
                                    <CheckCircle2 className="h-3 w-3" /> Aveva detto sì
                                </div>
                            )}
                            {lead.recallMissedAt && (
                                <div
                                    className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600 shrink-0"
                                    title={`Aveva un richiamo e non ha risposto (${new Date(lead.recallMissedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })})`}
                                >
                                    <PhoneMissed className="h-3 w-3" /> Richiamo NR
                                </div>
                            )}
                            <CompanyBadge companyId={lead.companyId} />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ash-500 mt-1">
                        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap group/phone">
                            <Phone className="h-3 w-3 shrink-0 text-ash-400" />
                            <div className="font-medium text-ash-600">{lead.phone}</div>
                            {lead.phoneSuspicious && (
                                <AlertTriangle
                                    className="h-3 w-3 text-amber-500 shrink-0"
                                    aria-label="Telefono potenzialmente incompleto — verifica prima di chiamare"
                                />
                            )}
                            {lead.duplicatePhone && (
                                <button
                                    onClick={openDupModal}
                                    className="flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 hover:bg-orange-100 transition-colors shrink-0"
                                    title="Numero presente su altri lead — clicca per i dettagli"
                                >
                                    <Users className="h-3 w-3" />
                                    Duplicato
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                                className="ml-0.5 p-1 hover:bg-brand-orange-50 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/phone:opacity-100"
                                title="Copia numero"
                            >
                                <Copy className="h-3 w-3" />
                            </button>
                        </div>
                        {lead.email && (
                            <div className="flex items-center gap-1.5 max-w-[170px] group/email">
                                <Mail className="h-3 w-3 text-ash-400 shrink-0" />
                                <div className="truncate text-ash-500" title={lead.email}>{lead.email}</div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.email ?? ''); alert('Email copiata!'); }}
                                    className="ml-0.5 p-1 hover:bg-brand-orange-50 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/email:opacity-100 shrink-0"
                                    title="Copia email"
                                >
                                    <Copy className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                        {arrivato && (
                            <div
                                className="shrink-0 tabular-nums text-ash-400"
                                title={new Date(arrivoMs).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                            >
                                arrivato {arrivato}
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Funnel & Status Pills */}
                <div className="w-44 hidden md:flex flex-col items-start gap-1.5">
                    {lead.funnel ? (
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${rarityStyle.badgeBg} ${rarityStyle.badgeText} ${rarityStyle.badgeBorder}`}>
                            {lead.funnel}
                        </div>
                    ) : <div className="text-[10px] text-ash-300 italic">No funnel</div>}

                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${statusClasses}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDot} shrink-0`} />
                        {statusText}
                    </div>
                </div>

                {/* 3. Last Activity Info */}
                <div className="w-48 hidden lg:flex flex-col text-xs justify-center">
                    {lead.recallDate ? (
                        <div className="flex items-center gap-2 font-semibold text-brand-orange-600">
                            <div className="w-7 h-7 rounded-lg bg-brand-orange-50 flex items-center justify-center shrink-0">
                                <CalendarIcon className="h-3.5 w-3.5 text-brand-orange-500" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Richiamo</div>
                                <div>{new Date(lead.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                                {lead.lastCallDate && (
                                    <div className="text-[10px] font-normal text-ash-400">
                                        Ultima ch. {new Date(lead.lastCallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : lead.appointmentDate ? (
                        <div className="flex items-center gap-2 font-bold text-emerald-600">
                            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                                <CalendarIcon className="h-3.5 w-3.5 text-emerald-500" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Appuntamento</div>
                                <div>{new Date(lead.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                            </div>
                        </div>
                    ) : lead.lastCallDate ? (
                        <div className="flex items-center gap-2 text-ash-500">
                            <div className="w-7 h-7 rounded-lg bg-ash-100 flex items-center justify-center shrink-0">
                                <Clock className="h-3.5 w-3.5 text-ash-400" />
                            </div>
                            <div className="flex flex-col">
                                <div className="text-[10px] text-ash-400 font-medium">Ultima chiamata</div>
                                <div>{new Date(lead.lastCallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-ash-400 italic">
                            <div className="w-7 h-7 rounded-lg bg-ash-50 flex items-center justify-center shrink-0">
                                <Zap className="h-3.5 w-3.5 text-ash-300" />
                            </div>
                            <div className="text-xs">Mai chiamato</div>
                        </div>
                    )}
                </div>

                {/* 4. Actions Right */}
                <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 pl-2">
                    {lead.recallDate && (
                        <button
                            onClick={openEditRecall}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                            title="Modifica data/note del richiamo (senza registrare una chiamata)"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">Modifica</span>
                        </button>
                    )}
                    {displayNote && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowNoteModal(true); }}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors animate-pulse-slow"
                            title="Leggi note precedenti"
                        >
                            <StickyNote className="w-3.5 h-3.5" />
                            Note
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowScript(true); }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-brand-orange/30 bg-brand-orange-50/50 text-brand-orange-700 hover:bg-brand-orange/10 transition-colors"
                        title="Apri script chiamata"
                    >
                        <FileText className="w-3.5 h-3.5" />
                        Script
                    </button>
                    <AgendaButton
                        leadId={lead.id}
                        leadName={lead.name}
                        leadPhone={lead.phone}
                        agendaSentAt={lead.agendaSentAt}
                        agendaStatus={lead.agendaStatus ?? null}
                    />
                    <GdoQuickActions leadId={lead.id} leadVersion={lead.version} recallPrefillNote={lead.recallNote || lead.lastCallNote || null} />
                </div>

                </div>{/* end main row */}

                {/* Note row — shown when there's any note */}
                {displayNote && (
                    <div className="flex items-start gap-2 px-1 pt-1 border-t border-ash-100">
                        <MessageSquare className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-xs text-ash-600 leading-relaxed line-clamp-2">{displayNote}</div>
                    </div>
                )}

                {modali}
            </div>
        )
    }

    // Default Fallback (vertical layout for other contexts)
    return (
        <div data-lead-card={lead.id} className={`bg-white border border-ash-200/80 border-l-[3px] ${rarityStyle.border} rounded-xl p-4 shadow-soft ${rarityStyle.hoverGlow} transition-all duration-200 mb-3 flex flex-col relative group`}>
            <div className="flex justify-between items-start mb-2">
                <div>
                    <div className="font-bold text-ash-900 text-[15px] leading-tight flex items-center gap-2">
                        {lead.name}
                        {isJustArrived && (
                            <span className="shrink-0 text-emerald-500 animate-pulse" title="Appena arrivato (meno di 1 ora fa)">
                                <Sparkles className="h-4 w-4" />
                            </span>
                        )}
                        <CompanyBadge companyId={lead.companyId} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-ash-500 mt-1 group/phone">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                        {lead.phoneSuspicious && (
                            <AlertTriangle
                                className="h-3 w-3 text-amber-500 shrink-0"
                                aria-label="Telefono potenzialmente incompleto — verifica prima di chiamare"
                            />
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigator.clipboard.writeText(lead.phone); alert('Numero copiato!'); }}
                            className="ml-1 p-1 hover:bg-ash-100 text-ash-400 hover:text-brand-orange rounded-md transition-colors opacity-0 group-hover/phone:opacity-100"
                            title="Copia numero"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <button className="text-ash-400 hover:text-ash-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="h-4 w-4" />
                </button>
            </div>
            {lead.funnel && (
                <div className="mb-4">
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${rarityStyle.badgeBg} ${rarityStyle.badgeText} ${rarityStyle.badgeBorder}`}>
                        {lead.funnel}
                    </div>
                </div>
            )}
            <div className="mt-auto pt-3 border-t border-ash-100 flex items-center justify-between">
                <GdoQuickActions leadId={lead.id} leadVersion={lead.version} recallPrefillNote={lead.recallNote || lead.lastCallNote || null} />
            </div>
        </div>
    )
})
