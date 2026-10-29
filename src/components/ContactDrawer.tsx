"use client"

import { useState, useEffect, useCallback } from "react"
import { getLeadProfile, updateLeadContactInfo } from "@/app/actions/eventActions"
import { X, CalendarCheck, Phone, Mail, User, Clock, AlertCircle, History, FileText, CheckCircle2, Pencil, Save, Loader2, Trash2, MessageSquare, ShieldAlert } from "lucide-react"
import { GdoQuickActions } from "./GdoQuickActions"
import { AgendaButton } from "./AgendaButton"
import { useAuth } from "./AuthProvider"
import { useRouter } from "next/navigation"
import { SurveysReadOnlyPanel } from "./surveys/SurveysReadOnlyPanel"
import { ScriptWidget } from "./ScriptWidget"
import { ConfermeScriptWidget } from "./ConfermeScriptWidget"
import { DirettaUiProvider } from "./diretta/DirettaUi"
import { funnelLeggibile } from "@/lib/diretta/funnel"
import { dataOraBreveRoma } from "@/lib/diretta/formato"

/** Stato del lead in parole, per la veste Diretta (niente "APPOINTMENT" grezzo). */
const STATO_LEAD: Record<string, string> = {
    NEW: 'Da chiamare',
    IN_PROGRESS: 'In lavorazione',
    APPOINTMENT: 'Appuntamento',
    REJECTED: 'Scartato',
}

function DrawerSkeleton() {
    return (
        <div className="space-y-6 p-6">
            {/* Name skeleton */}
            <div className="space-y-3">
                <div className="skeleton-line w-1/3 h-5" />
                <div className="skeleton-line w-1/2 h-3" />
            </div>
            {/* Fields skeleton */}
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="skeleton-circle w-8 h-8" />
                    <div className="skeleton-line flex-1 h-4" />
                </div>
                <div className="flex items-center gap-3">
                    <div className="skeleton-circle w-8 h-8" />
                    <div className="skeleton-line flex-1 h-4" />
                </div>
                <div className="flex items-center gap-3">
                    <div className="skeleton-circle w-8 h-8" />
                    <div className="skeleton-line w-2/3 h-4" />
                </div>
            </div>
            {/* CRM status skeleton */}
            <hr className="border-ash-100" />
            <div className="grid grid-cols-2 gap-4">
                <div className="skeleton-card h-20" />
                <div className="skeleton-card h-20" />
                <div className="skeleton-card h-20" />
            </div>
        </div>
    )
}

export function ContactDrawer({
    isOpen,
    leadId,
    onClose,
    diretta = false,
}: {
    isOpen: boolean
    leadId: string | null
    onClose: () => void
    /** Veste Diretta (barra in alto della Diretta): cornice scura, stesse azioni. */
    diretta?: boolean
}) {
    const [profile, setProfile] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState<'details' | 'timeline' | 'surveys' | 'script'>('details')
    const { user: authUser } = useAuth()
    const router = useRouter()

    // Edit mode state
    const [isEditing, setIsEditing] = useState(false)
    const [editName, setEditName] = useState("")
    const [editPhone, setEditPhone] = useState("")
    const [editEmail, setEditEmail] = useState("")
    const [editNote, setEditNote] = useState("")
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const [isDeletingLead, setIsDeletingLead] = useState(false)

    const isAdmin = authUser?.user_metadata?.role === 'ADMIN'

    const handleDeleteLead = async () => {
        if (!lead?.id) return
        // Doppia conferma per ridurre rischio errori — operazione IRREVERSIBILE
        const first = confirm(
            `⚠️ CANCELLAZIONE DEFINITIVA\n\nStai per cancellare il lead "${lead.name || ''}" e tutti i dati collegati (chiamate, eventi, note, sondaggi).\n\nQuesta azione NON è reversibile.\n\nVuoi procedere?`,
        )
        if (!first) return
        const typed = prompt(`Per confermare digita ELIMINA (maiuscolo):`)
        if (typed !== 'ELIMINA') {
            alert('Cancellazione annullata.')
            return
        }
        setIsDeletingLead(true)
        try {
            const { deleteLeadCompletely } = await import("@/app/actions/appointmentActions")
            const res = await deleteLeadCompletely(lead.id)
            if (!res.success) {
                alert(`Errore: ${res.error}`)
                return
            }
            alert(`Lead "${res.deletedName || lead.name}" cancellato.`)
            onClose()
            router.refresh()
        } catch (e: any) {
            alert(`Errore: ${e?.message || e}`)
        } finally {
            setIsDeletingLead(false)
        }
    }

    const refreshProfile = () => {
        if (!leadId) return
        setIsLoading(true)
        getLeadProfile(leadId).then(data => {
            setProfile(data)
            setIsLoading(false)
        }).catch(err => {
            console.error(err)
            setIsLoading(false)
        })
    }

    // ESC key handler
    const handleEsc = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") onClose()
    }, [onClose])

    useEffect(() => {
        if (!isOpen) return
        document.addEventListener("keydown", handleEsc)
        return () => document.removeEventListener("keydown", handleEsc)
    }, [isOpen, handleEsc])

    // Scheda aperta segnata sulla pagina (PO 27/10/2026): avvisi richiami e
    // consigli si spostano alla sua sinistra invece di coprire gli esiti.
    // Un contatore, perché le schede montate sono più d'una.
    useEffect(() => {
        if (!isOpen) return
        const html = document.documentElement
        html.dataset.schedeAperte = String(Number(html.dataset.schedeAperte ?? 0) + 1)
        return () => {
            const n = Number(html.dataset.schedeAperte ?? 1) - 1
            if (n > 0) html.dataset.schedeAperte = String(n)
            else delete html.dataset.schedeAperte
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen || !leadId) {
            setProfile(null)
            setActiveTab('details')
            setIsEditing(false)
            setSaveMessage(null)
            return
        }

        refreshProfile()

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, leadId])

    // Sync edit fields when entering edit mode or when profile changes
    const enterEditMode = () => {
        if (!lead) return
        setEditName(lead.name || "")
        setEditPhone(lead.phone || "")
        setEditEmail(lead.email || "")
        setEditNote(lead.lastCallNote || "")
        setSaveMessage(null)
        setIsEditing(true)
    }

    const cancelEdit = () => {
        setIsEditing(false)
        setSaveMessage(null)
    }

    const handleSave = async () => {
        if (!lead) return
        setIsSaving(true)
        setSaveMessage(null)

        const result = await updateLeadContactInfo(lead.id, lead.version, {
            name: editName,
            phone: editPhone,
            email: editEmail,
            lastCallNote: editNote,
        })

        setIsSaving(false)

        if (result.success) {
            setSaveMessage({ type: 'success', text: 'Salvato con successo!' })
            setIsEditing(false)
            refreshProfile()
            router.refresh()
        } else if (result.error === 'CONCURRENCY_ERROR') {
            setSaveMessage({ type: 'error', text: 'Il lead è stato modificato da un altro utente. Ricaricamento...' })
            refreshProfile()
        } else {
            setSaveMessage({ type: 'error', text: result.error || 'Errore durante il salvataggio.' })
        }
    }

    if (!isOpen) return null

    const lead = profile?.lead
    const events = profile?.events || []

    // Chiusura protetta: se ci sono modifiche non salvate (es. note digitate),
    // chiedi conferma prima di scartarle — evita di perdere il lavoro con un
    // click accidentale fuori dal drawer.
    const requestClose = () => {
        if (isEditing && lead) {
            const dirty =
                editName !== (lead.name || "") ||
                editPhone !== (lead.phone || "") ||
                editEmail !== (lead.email || "") ||
                editNote !== (lead.lastCallNote || "")
            if (dirty && !window.confirm('Hai modifiche non salvate (note/dati). Chiudere comunque e perderle?')) {
                return
            }
        }
        onClose()
    }

    const formatTimestamp = (ts: Date) => {
        return new Date(ts).toLocaleString('it-IT', {
            timeZone: 'Europe/Rome',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        })
    }

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'IMPORTED': return <FileText className="h-4 w-4 text-blue-500" />
            case 'ASSIGNED': return <User className="h-4 w-4 text-purple-500" />
            case 'CALL_LOGGED': return <Phone className="h-4 w-4 text-orange-500" />
            case 'SECTION_MOVED': return <History className="h-4 w-4 text-brand-orange" />
            case 'DISCARDED': return <AlertCircle className="h-4 w-4 text-red-500" />
            case 'RECALL_SET': return <Clock className="h-4 w-4 text-gold-600" />
            case 'APPOINTMENT_SET': return <CalendarCheck className="h-4 w-4 text-green-500" />
            case 'BOT_NOTE': return <FileText className="h-4 w-4 text-sky-500" />
            case 'REASSIGNED_TO_BOT': return <User className="h-4 w-4 text-indigo-500" />
            case 'BOT_APPOINTMENT_RESCHEDULED': return <CalendarCheck className="h-4 w-4 text-sky-500" />
            case 'BOT_CONTACT_REQUEST': return <Phone className="h-4 w-4 text-sky-500" />
            // Tipi neutri della timeline GDO (getLeadProfile li rinomina lato server).
            case 'CONTACT_REQUEST': return <Phone className="h-4 w-4 text-sky-500" />
            case 'NOTE': return <FileText className="h-4 w-4 text-sky-500" />
            case 'APPOINTMENT_RESCHEDULED': return <CalendarCheck className="h-4 w-4 text-green-500" />
            case 'INBOUND_MESSAGE': return <MessageSquare className="h-4 w-4 text-emerald-500" />
            case 'LANCIO_INTAKE': return <CalendarCheck className="h-4 w-4 text-amber-500" />
            case 'appointment_forced': return <ShieldAlert className="h-4 w-4 text-amber-500" />
            default: return <CheckCircle2 className="h-4 w-4 text-ash-400" />
        }
    }

    const getEventLabel = (type: string) => {
        switch (type) {
            case 'IMPORTED': return 'Lead Importato'
            case 'ASSIGNED': return 'Assegnato a GDO'
            case 'CALL_LOGGED': return 'Chiamata Registrata'
            case 'SECTION_MOVED': return 'Spostato di Sezione'
            case 'DISCARDED': return 'Lead Scartato'
            case 'RECALL_SET': return 'Richiamo Programmato'
            case 'APPOINTMENT_SET': return 'Appuntamento Fissato'
            case 'contact_info_edited': return 'Dati Contatto Modificati'
            case 'followup_rescheduled': return 'Follow-up spostato'
            case 'lead_parked': return 'Messo in lavorazione'
            case 'salesperson_outcome_cleared': return 'Esito venditore rimosso'
            case 'venditore_appointment_rescheduled': return 'Appuntamento spostato dal venditore'
            case 'BOT_NOTE': return '📋 Nota dal Fissatore'
            case 'REASSIGNED_TO_BOT': return '🤖 Lead ripreso dal Fissatore'
            case 'BOT_APPOINTMENT_RESCHEDULED': return '🔄 Appuntamento spostato dal Fissatore'
            case 'BOT_CONTACT_REQUEST': return '☎️ Richiesta di contatto umano'
            case 'INBOUND_MESSAGE': return '💬 Ha scritto lui su WhatsApp'
            case 'LANCIO_INTAKE': return '🚀 Ingresso nel lancio Web Dev AI'
            case 'appointment_forced': return 'Appuntamento forzato'
            // Pipeline autonoma venditore. Senza queste due righe la timeline
            // li mostrava come "Evento Sconosciuto" — proprio dove si va a
            // cercare l'audit di questi lead.
            case 'SALES_SELF_BOOKED': return '🎯 Appuntamento fissato dal venditore'
            case 'SALES_PIPELINE_ASSIGNED': return '➡️ Passato alla pipeline del venditore'
            case 'MARKETING_QUEUE': return '📈 Nella coda del giorno del marketing'
            default: return 'Evento Sconosciuto'
        }
    }

    // ── Veste Diretta (collaudo del 25/10/2026): cornice scura ed esiti con le
    // stesse etichette della card ("Non risponde", "Richiamo", "Da scartare",
    // "Appuntamento"). Stessi dati, stessi gestori, stessa logica: cambiano
    // solo la grafica e le parole. Lo script del GDO è scuro come nelle card
    // (stesso testo); script delle Conferme e sondaggi restano su un foglio chiaro.
    if (diretta) {
        const tab = (attiva: boolean) => `shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-[14px] transition-colors ${attiva
            ? 'border-[#FF9330] font-semibold text-[#F2F2F2]'
            : 'border-transparent text-[#BFBFBF] hover:text-[#F2F2F2]'}`
        const etichettaEvento = (ev: any) => String(ev.label ?? getEventLabel(ev.eventType)).replace(/^[^\p{L}\p{N}]+/u, '')
        const funnel = funnelLeggibile(lead?.funnel)
        return (
            <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
                <div className="absolute inset-0 bg-black/60" onClick={requestClose} />

                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={lead?.name ? `Scheda di ${lead.name}` : 'Scheda del lead'}
                    className="relative z-50 flex h-full w-full max-w-md flex-col border-l-2 border-[#262626] bg-[#171717] font-[family-name:var(--font-poppins)] text-[#F2F2F2] tabular-nums"
                >
                    {/* Intestazione */}
                    <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
                        <div className="min-w-0 flex-1">
                            <h2 className="truncate text-[20px] font-semibold leading-tight">{lead?.name || 'Caricamento'}</h2>
                            {(funnel || lead?.phone) && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-[#BFBFBF]">
                                    {lead?.phone && <div className="whitespace-nowrap">{lead.phone}</div>}
                                    {funnel && <div>{funnel}</div>}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            {isAdmin && lead?.id && (
                                <button
                                    type="button"
                                    onClick={handleDeleteLead}
                                    disabled={isDeletingLead}
                                    title="Cancella definitivamente il lead (solo admin)"
                                    aria-label="Cancella il lead"
                                    className="rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] disabled:opacity-50"
                                >
                                    {isDeletingLead ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" strokeWidth={1.5} />}
                                </button>
                            )}
                            <button type="button" onClick={requestClose} aria-label="Chiudi" className="rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                                <X className="h-5 w-5" strokeWidth={1.5} />
                            </button>
                        </div>
                    </div>

                    {/* Schede */}
                    <div role="tablist" aria-label="Scheda del lead" className="flex gap-1 overflow-x-auto border-b-2 border-[#262626] px-3">
                        <button type="button" role="tab" aria-selected={activeTab === 'details'} onClick={() => setActiveTab('details')} className={tab(activeTab === 'details')}>Dettagli</button>
                        <button type="button" role="tab" aria-selected={activeTab === 'script'} onClick={() => setActiveTab('script')} className={tab(activeTab === 'script')}>Script</button>
                        <button type="button" role="tab" aria-selected={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} className={tab(activeTab === 'timeline')}>Storia</button>
                        <button type="button" role="tab" aria-selected={activeTab === 'surveys'} onClick={() => setActiveTab('surveys')} className={tab(activeTab === 'surveys')}>Sondaggi</button>
                    </div>

                    <div className="custom-scrollbar flex-1 overflow-y-auto">
                        {isLoading ? (
                            <div className="space-y-3 p-5" aria-hidden="true">
                                <div className="h-5 w-1/3 rounded-lg bg-[#262626]" />
                                <div className="h-4 w-1/2 rounded-lg bg-[#262626]" />
                                <div className="h-24 rounded-2xl bg-[#262626]" />
                                <div className="h-24 rounded-2xl bg-[#262626]" />
                            </div>
                        ) : activeTab === 'details' && lead ? (
                            <div className="space-y-5 p-5">
                                {saveMessage && (
                                    <div role="status" className={`rounded-lg border-2 px-4 py-2.5 text-[14px] ${saveMessage.type === 'success' ? 'border-[#3D3D3D] text-[#F2F2F2]' : 'border-[#FF9330] text-[#F2F2F2]'}`}>
                                        {saveMessage.text}
                                    </div>
                                )}

                                {/* Esito della chiamata: in alto, è la cosa da fare adesso */}
                                <section className="rounded-2xl bg-[#262626] p-4">
                                    <h3 className="text-[15px] font-semibold">Esito della chiamata</h3>
                                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                        <DirettaUiProvider>
                                            {/* Verso il basso (26/10/2026): l'esito è in cima alla scheda, aperto
                                                verso l'alto il richiamo usciva dalla parte visibile e non si compilava. */}
                                            <GdoQuickActions leadId={lead.id} leadVersion={lead.version} onSettled={refreshProfile} popoverDirection="down" />
                                        </DirettaUiProvider>
                                        <AgendaButton
                                            leadId={lead.id}
                                            leadName={lead.name}
                                            leadPhone={lead.phone}
                                            agendaSentAt={lead.agendaSentAt}
                                            agendaStatus={lead.agendaStatus ?? null}
                                            variant="diretta"
                                        />
                                    </div>
                                </section>

                                {/* Dati */}
                                <section>
                                    <div className="flex items-center justify-between gap-3">
                                        <h3 className="text-[15px] font-semibold">Dati</h3>
                                        {!isEditing ? (
                                            <button type="button" onClick={enterEditMode} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                                                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} /> Modifica
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <button type="button" onClick={cancelEdit} disabled={isSaving} className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                                                    Annulla
                                                </button>
                                                <button type="button" onClick={handleSave} disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#F2F2F2] px-3 py-1.5 text-[13px] font-semibold text-[#171717] disabled:opacity-50">
                                                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.5} />}
                                                    Salva
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {isEditing ? (
                                        <div className="mt-3 space-y-3">
                                            {([
                                                ['Nome', editName, setEditName, 'text'],
                                                ['Telefono', editPhone, setEditPhone, 'tel'],
                                                ['Email', editEmail, setEditEmail, 'email'],
                                            ] as const).map(([etichetta, valore, imposta, tipo]) => (
                                                <label key={etichetta} className="block">
                                                    <div className="mb-1 text-[13px] text-[#BFBFBF]">{etichetta}</div>
                                                    <input
                                                        type={tipo}
                                                        value={valore}
                                                        onChange={(e) => imposta(e.target.value)}
                                                        className="h-10 w-full rounded-lg border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"
                                                    />
                                                </label>
                                            ))}
                                            <label className="block">
                                                <div className="mb-1 text-[13px] text-[#BFBFBF]">Note</div>
                                                <textarea
                                                    value={editNote}
                                                    onChange={(e) => setEditNote(e.target.value)}
                                                    rows={3}
                                                    className="w-full resize-none rounded-lg border-2 border-[#3D3D3D] bg-[#171717] px-3 py-2 text-[14px] text-[#F2F2F2] focus:border-[#FF9330] focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    ) : (
                                        <dl className="mt-3 space-y-2 text-[14px]">
                                            <div className="flex items-center gap-3">
                                                <dt className="sr-only">Telefono</dt>
                                                <Phone className="h-4 w-4 shrink-0 text-[#8C8C8C]" strokeWidth={1.5} aria-hidden="true" />
                                                <dd className="whitespace-nowrap font-medium">{lead.phone}</dd>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <dt className="sr-only">Email</dt>
                                                <Mail className="h-4 w-4 shrink-0 text-[#8C8C8C]" strokeWidth={1.5} aria-hidden="true" />
                                                <dd className="min-w-0 truncate text-[#BFBFBF]">{lead.email || 'nessuna email'}</dd>
                                            </div>
                                            {lead.lastCallNote && (
                                                <div className="flex items-start gap-3">
                                                    <dt className="sr-only">Note</dt>
                                                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#8C8C8C]" strokeWidth={1.5} aria-hidden="true" />
                                                    <dd className="text-[#BFBFBF]">{lead.lastCallNote}</dd>
                                                </div>
                                            )}
                                        </dl>
                                    )}
                                </section>

                                {/* Dove sta */}
                                <section>
                                    <h3 className="text-[15px] font-semibold">Dove sta</h3>
                                    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <div className="rounded-lg bg-[#262626] px-3 py-2.5">
                                            <dt className="text-[12px] text-[#BFBFBF]">Stato</dt>
                                            <dd className="mt-0.5 text-[14px] font-semibold">{lead.daRifissare ? 'Da rifissare' : (STATO_LEAD[lead.status] ?? lead.status)}</dd>
                                        </div>
                                        <div className="rounded-lg bg-[#262626] px-3 py-2.5">
                                            <dt className="text-[12px] text-[#BFBFBF]">In mano a</dt>
                                            <dd className="mt-0.5 truncate text-[14px] font-semibold">{lead.assignedToName || 'Nessuno'}</dd>
                                        </div>
                                        <div className="rounded-lg bg-[#262626] px-3 py-2.5">
                                            <dt className="text-[12px] text-[#BFBFBF]">Chiamate</dt>
                                            <dd className="mt-0.5 text-[14px] font-semibold">{lead.callCount} di 3</dd>
                                        </div>
                                    </dl>
                                    {/* PO 29/10/2026: appuntamento tolto dalle Conferme per rifissarlo */}
                                    {lead.daRifissare && (
                                        <div role="note" className="mt-3 rounded-lg border-2 border-[#FF9330] px-3 py-2.5 text-[14px]">
                                            <div className="font-semibold">
                                                {lead.daRifissare.richiamoIl
                                                    ? `Appuntamento da rifissare: le Conferme lo richiamano il ${dataOraBreveRoma(new Date(lead.daRifissare.richiamoIl))}`
                                                    : 'Appuntamento da rifissare: lo richiamano le Conferme'}
                                            </div>
                                            {lead.daRifissare.nota && (
                                                <div className="mt-1 break-words text-[#BFBFBF]">&quot;{lead.daRifissare.nota}&quot;</div>
                                            )}
                                        </div>
                                    )}
                                </section>
                            </div>
                        ) : activeTab === 'timeline' && events ? (
                            <div className="p-5">
                                {events.length === 0 ? (
                                    <div className="py-8 text-center text-[14px] text-[#BFBFBF]">Nessun evento registrato.</div>
                                ) : (
                                    <ol className="space-y-2.5">
                                        {events.map((ev: any) => (
                                            <li key={ev.id} className="rounded-2xl bg-[#262626] px-4 py-3">
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <div className="text-[14px] font-semibold">{etichettaEvento(ev)}</div>
                                                    <time className="shrink-0 text-[12px] text-[#8C8C8C]">{dataOraBreveRoma(new Date(ev.timestamp))}</time>
                                                </div>
                                                {ev.userName && <div className="mt-1 text-[13px] text-[#BFBFBF]">{ev.userName}</div>}
                                                {ev.testo ? (
                                                    <div className="mt-1 text-[13px] text-[#BFBFBF]">{ev.testo}</div>
                                                ) : ev.metadata?.note ? (
                                                    <div className="mt-1 text-[13px] text-[#BFBFBF]">&quot;{ev.metadata.note}&quot;</div>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        ) : activeTab === 'surveys' && leadId ? (
                            <div className="p-3 sm:p-4">
                                <div className="overflow-hidden rounded-2xl bg-white text-[#171717]">
                                    <SurveysReadOnlyPanel leadId={leadId} />
                                </div>
                            </div>
                        ) : activeTab === 'script' && lead ? (
                            authUser?.user_metadata?.role === 'CONFERME' ? (
                                <div className="p-3 sm:p-4">
                                    <div className="overflow-hidden rounded-2xl bg-white p-3 text-[#171717] sm:p-4">
                                        <ConfermeScriptWidget />
                                    </div>
                                </div>
                            ) : (
                                // Script del GDO in veste scura (collaudo del 25/10/2026): stesso testo, stessi passi.
                                <div className="p-4">
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
                            )
                        ) : null}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <div className="drawer-overlay" onClick={requestClose} />

            <div className="relative w-full max-w-md flex flex-col bg-white shadow-elevated z-50 drawer-panel">
                {/* Header - sticky */}
                <div className="px-4 sm:px-6 py-5 drawer-header flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-xl font-bold text-ash-900 flex items-center gap-2 truncate">
                                {lead?.name || 'Caricamento...'}
                            </h2>
                            {lead?.funnel && (
                                <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-ash-200 text-ash-700 uppercase tracking-wide">
                                    {lead.funnel}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {lead?.id && lead.phone && (
                                <AgendaButton
                                    leadId={lead.id}
                                    leadName={lead.name || ''}
                                    leadPhone={lead.phone}
                                    agendaSentAt={lead.agendaSentAt ?? null}
                                    agendaStatus={lead.agendaStatus ?? null}
                                />
                            )}
                            {isAdmin && lead?.id && (
                                <button
                                    onClick={handleDeleteLead}
                                    disabled={isDeletingLead}
                                    title="Cancella DEFINITIVAMENTE il lead (admin only)"
                                    className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-full transition-colors disabled:opacity-50"
                                >
                                    {isDeletingLead ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                                </button>
                            )}
                            <button onClick={requestClose} className="p-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-ash-200 bg-white px-1 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('details')}
                        className={`flex-1 min-w-[90px] py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-ash-500 hover:text-ash-700'}`}
                    >
                        Dettagli
                    </button>
                    <button
                        onClick={() => setActiveTab('script')}
                        className={`flex-1 min-w-[80px] py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${activeTab === 'script' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-ash-500 hover:text-ash-700'}`}
                    >
                        Script
                    </button>
                    <button
                        onClick={() => setActiveTab('timeline')}
                        className={`flex-1 min-w-[80px] py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${activeTab === 'timeline' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-ash-500 hover:text-ash-700'}`}
                    >
                        Timeline
                    </button>
                    <button
                        onClick={() => setActiveTab('surveys')}
                        className={`flex-1 min-w-[80px] py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${activeTab === 'surveys' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-ash-500 hover:text-ash-700'}`}
                    >
                        Sondaggi
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-white custom-scrollbar">
                    {isLoading ? (
                        <DrawerSkeleton />
                    ) : activeTab === 'details' && lead ? (
                        <div className="space-y-6 p-4 sm:p-6 animate-fade-in">
                            {/* Save feedback message */}
                            {saveMessage && (
                                <div className={`px-4 py-2.5 rounded-lg text-sm font-medium animate-slide-up ${saveMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                    {saveMessage.text}
                                </div>
                            )}

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-ash-900 uppercase tracking-wider">Anagrafica</h3>
                                    {!isEditing ? (
                                        <button
                                            onClick={enterEditMode}
                                            className="flex items-center gap-1.5 text-xs font-medium text-brand-orange hover:text-brand-orange/80 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-brand-orange/10"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            Modifica
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={cancelEdit}
                                                disabled={isSaving}
                                                className="text-xs font-medium text-ash-500 hover:text-ash-700 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-ash-100"
                                            >
                                                Annulla
                                            </button>
                                            <button
                                                onClick={handleSave}
                                                disabled={isSaving}
                                                className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-orange hover:bg-brand-orange/90 transition-colors px-3 py-1.5 rounded-lg disabled:opacity-50"
                                            >
                                                {isSaving ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Save className="h-3.5 w-3.5" />
                                                )}
                                                Salva
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {isEditing ? (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="flex items-center gap-2 text-xs font-medium text-ash-500 mb-1">
                                                <User className="h-3.5 w-3.5" /> Nome
                                            </label>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className="input-fenice text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-xs font-medium text-ash-500 mb-1">
                                                <Phone className="h-3.5 w-3.5" /> Telefono
                                            </label>
                                            <input
                                                type="tel"
                                                value={editPhone}
                                                onChange={(e) => setEditPhone(e.target.value)}
                                                className="input-fenice text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-xs font-medium text-ash-500 mb-1">
                                                <Mail className="h-3.5 w-3.5" /> Email
                                            </label>
                                            <input
                                                type="email"
                                                value={editEmail}
                                                onChange={(e) => setEditEmail(e.target.value)}
                                                className="input-fenice text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-xs font-medium text-ash-500 mb-1">
                                                <FileText className="h-3.5 w-3.5" /> Note
                                            </label>
                                            <textarea
                                                value={editNote}
                                                onChange={(e) => setEditNote(e.target.value)}
                                                rows={3}
                                                className="input-fenice text-sm resize-none"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3 text-sm">
                                            <User className="h-4 w-4 text-ash-400" />
                                            <div className="text-ash-700">{lead.name}</div>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            <Phone className="h-4 w-4 text-ash-400" />
                                            <div className="text-ash-900 font-medium cursor-copy hover:text-brand-orange transition-colors">{lead.phone}</div>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            <Mail className="h-4 w-4 text-ash-400" />
                                            <div className="text-ash-700">{lead.email || '-'}</div>
                                        </div>
                                        {lead.lastCallNote && (
                                            <div className="flex items-start gap-3 text-sm">
                                                <FileText className="h-4 w-4 text-ash-400 mt-0.5" />
                                                <div className="text-ash-600 italic">{lead.lastCallNote}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <hr className="border-ash-100" />

                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-ash-900 uppercase tracking-wider">Stato CRM</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="bg-ash-50 p-3 rounded-lg border border-ash-100">
                                        <div className="text-xs text-ash-500 mb-1">Stato DB</div>
                                        <div className="text-sm font-bold text-ash-900">{lead.status}{lead.daRifissare ? ' · da rifissare' : ''}</div>
                                    </div>
                                    <div className="bg-ash-50 p-3 rounded-lg border border-ash-100">
                                        <div className="text-xs text-ash-500 mb-1">Assegnazione</div>
                                        <div className="text-sm font-bold text-ash-900">{lead.assignedToName || 'Nessuno'}</div>
                                    </div>
                                    <div className="bg-ash-50 p-3 rounded-lg border border-ash-100">
                                        <div className="text-xs text-ash-500 mb-1">Tentativi Chiamate</div>
                                        <div className="text-sm font-bold text-ash-900">{lead.callCount} / 3</div>
                                    </div>
                                </div>
                                {lead.daRifissare && (
                                    <div role="note" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                                        <div className="font-bold">
                                            {lead.daRifissare.richiamoIl
                                                ? `Appuntamento da rifissare: le Conferme lo richiamano il ${dataOraBreveRoma(new Date(lead.daRifissare.richiamoIl))}`
                                                : 'Appuntamento da rifissare: lo richiamano le Conferme'}
                                        </div>
                                        {lead.daRifissare.nota && (
                                            <div className="mt-1 break-words italic text-sky-700">&quot;{lead.daRifissare.nota}&quot;</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <hr className="border-ash-100" />

                            <div className="space-y-4 bg-brand-orange/5 p-4 rounded-xl border border-brand-orange/20">
                                <h3 className="text-sm font-bold text-brand-orange uppercase tracking-wider flex items-center justify-between">
                                    Azioni Rapide sull'Esito
                                </h3>
                                <div className="pt-2 flex items-center flex-wrap gap-2">
                                    <AgendaButton
                                        leadId={lead.id}
                                        leadName={lead.name}
                                        leadPhone={lead.phone}
                                        agendaSentAt={lead.agendaSentAt}
                                        agendaStatus={lead.agendaStatus ?? null}
                                    />
                                    <GdoQuickActions leadId={lead.id} leadVersion={lead.version} onSettled={refreshProfile} popoverDirection="up" />
                                </div>
                                <div className="text-xs text-brand-orange/70 mt-2">
                                    Clicca un pulsante per esitare il lead, fissarlo, o inviare l'agenda Calendly via WhatsApp.
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'timeline' && events ? (
                        <div className="relative pl-3 p-6 animate-fade-in">
                            {/* Vertical Line */}
                            <div className="absolute left-[19px] top-8 bottom-6 w-px bg-ash-200" />

                            {events.length === 0 ? (
                                <div className="text-center text-sm text-ash-500 py-8">Nessun evento registrato.</div>
                            ) : (
                                <div className="space-y-6">
                                    {events.map((ev: any) => (
                                        <div key={ev.id} className="relative pl-8">
                                            {/* dot */}
                                            <div className="absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white border-2 border-ash-200 flex items-center justify-center shadow-sm z-10">
                                                {getEventIcon(ev.eventType)}
                                            </div>

                                            <div className="bg-ash-50 border border-ash-100 rounded-lg p-3 hover:shadow-sm transition-shadow">
                                                <div className="flex flex-col gap-1 mb-2 border-b border-ash-100 pb-2">
                                                    {/* Per il GDO l'etichetta arriva già neutra dal server (niente bot). */}
                                                    <h4 className="text-sm font-bold text-ash-900">{ev.label ?? getEventLabel(ev.eventType)}</h4>
                                                    <time className="text-xs text-ash-500 font-mono flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatTimestamp(ev.timestamp)}
                                                    </time>
                                                </div>

                                                {/* Dettagli condizionali */}
                                                <div className="text-sm text-ash-700 space-y-1.5">
                                                    {ev.eventType === 'SECTION_MOVED' && (
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <div className="bg-ash-200 text-ash-700 px-1.5 py-0.5 rounded">{ev.fromSection || '?'}</div>
                                                            <div className="text-ash-400">→</div>
                                                            <div className="bg-brand-orange/10 text-brand-orange px-1.5 py-0.5 rounded">{ev.toSection}</div>
                                                        </div>
                                                    )}

                                                    {ev.userName && (
                                                        <div className="text-xs text-ash-500">Operatore: <span className="font-medium text-ash-700">{ev.userName}</span></div>
                                                    )}

                                                    {ev.testo ? (
                                                        <div className="text-xs italic text-ash-600 pt-1">{ev.testo}</div>
                                                    ) : ev.metadata?.note && (
                                                        <div className="text-xs italic text-ash-600 pt-1">
                                                            &quot;{ev.metadata.note}&quot;
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'surveys' && leadId ? (
                        <div className="animate-fade-in">
                            <SurveysReadOnlyPanel leadId={leadId} />
                        </div>
                    ) : activeTab === 'script' && lead ? (
                        <div className="animate-fade-in p-3 sm:p-4">
                            {authUser?.user_metadata?.role === 'CONFERME' ? (
                                <ConfermeScriptWidget />
                            ) : (
                                <ScriptWidget
                                    leadId={lead.id}
                                    funnel={lead.funnel}
                                    leadEmail={lead.email}
                                    leadName={lead.name}
                                    leadPhone={lead.phone}
                                    agendaSentAt={lead.agendaSentAt ?? null}
                                    agendaStatus={lead.agendaStatus ?? null}
                                />
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
