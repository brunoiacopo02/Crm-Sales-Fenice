"use client"

import { useState } from "react"
import { Phone, Mail, CalendarCheck, Clock, CheckCircle2, Pencil, RefreshCcw, BellRing } from "lucide-react"
import dynamic from "next/dynamic"

const EditAppointmentModal = dynamic(
  () => import("./EditAppointmentModal").then(mod => mod.EditAppointmentModal),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { updateGdoAppointment } from "@/app/actions/appointmentActions"
import { isSelfBooked } from "@/lib/salesPipeline/sentinel"
import { useRouter } from "next/navigation"
import { funnelLeggibile } from "@/lib/diretta/funnel"
import { dataBreveRoma, dataOraBreveRoma } from "@/lib/diretta/formato"

type LeadList = any[]

export function AppointmentBoard({
    upcoming,
    past,
    inRifissaggio = [],
    variant,
}: {
    upcoming: LeadList
    past: LeadList
    inRifissaggio?: LeadList
    /** 'diretta' = veste scura del GDO (collaudo del 25/10/2026): stessi dati, stesse azioni. */
    variant?: 'diretta'
}) {
    const [activeTab, setActiveTab] = useState<'upcoming' | 'past' | 'rifissaggio'>('upcoming')
    const [editingLead, setEditingLead] = useState<any>(null)
    const router = useRouter()

    // Sort chronologically
    const sortedUpcoming = [...upcoming].sort((a,b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime())
    const sortedPast = [...past].sort((a,b) => new Date(b.appointmentDate).getTime() - new Date(a.appointmentDate).getTime()) // Past descending
    const currentList = activeTab === 'upcoming' ? sortedUpcoming : activeTab === 'past' ? sortedPast : inRifissaggio

    const salvaModifica = async (dateStr: string, timeStr: string, noteStr: string) => {
        if (!editingLead) return
        const newDate = new Date(`${dateStr}T${timeStr}:00`)
        const result = await updateGdoAppointment(editingLead.id, newDate, noteStr, editingLead.version)
        if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
            alert("Questo lead è stato modificato da un altro utente. La pagina verrà aggiornata.")
            router.refresh()
            return
        }
        setEditingLead(null)
        router.refresh()
    }

    // ── Veste Diretta: card scure a righe che vanno a capo (niente colonne
    // fisse: a 390 px restano dentro lo schermo e l'email si legge intera).
    // Stessi dati, stessi ritorni da Conferme e venditore, stessa modifica.
    if (variant === 'diretta') {
        // PO 29/10/2026: gli appuntamenti che le Conferme stanno rifissando
        // (getAppointments li mette in testa e li segna con rifissaggioConferme)
        // si vedono anche in cima a "In programma", così il GDO non li perde.
        const daRifissare = inRifissaggio.filter(l => l.rifissaggioConferme)
        const altriSenzaData = inRifissaggio.filter(l => !l.rifissaggioConferme)
        const tabs = [
            { key: 'upcoming' as const, label: 'In programma', count: upcoming.length },
            { key: 'rifissaggio' as const, label: 'Da rifissare', count: daRifissare.length },
            { key: 'past' as const, label: 'Archivio', count: past.length },
        ]
        const quando = (iso: string | Date | null | undefined) => iso ? dataOraBreveRoma(new Date(iso)) : 'N/D'
        const chip = "inline-flex max-w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium text-[var(--d-text)]"
        const pallino = (colore: string) => <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: colore }} aria-hidden="true" />
        const notaChip = (testo: string) => <div className="max-w-full break-words pl-3.5 font-normal text-[var(--d-muted)]">“{testo}”</div>

        const cardDiretta = (lead: any, tipo: 'upcoming' | 'past' | 'rifissaggio') => {
            const isUpcoming = tipo === 'upcoming'
            const isRifissaggio = tipo === 'rifissaggio'
            const funnel = funnelLeggibile(lead.funnel)
            // In mano alle Conferme per rifissarlo; gli altri senza data sono già esitati.
            const conConferme = isRifissaggio && !!lead.rifissaggioConferme
            const conEsiti = (lead.confirmationsOutcome && !isSelfBooked(lead.confirmationsOutcome)) || lead.salespersonOutcome || conConferme || lead.confSnoozeAt
            const etichettaModifica = isRifissaggio ? 'Rifissa' : 'Modifica'
            return (
                <div key={lead.id} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border-2 border-transparent bg-[var(--d-surface)] px-4 py-3 text-[var(--d-text)] transition-colors hover:border-[var(--d-line)] sm:px-5">
                    {/* Riga 1: nome, quando, modifica */}
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[16px] font-semibold leading-tight" title={lead.name}>{lead.name}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                                {conConferme ? (
                                    <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--d-orange)]">
                                        <RefreshCcw className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                        Da rifissare
                                    </div>
                                ) : isRifissaggio ? (
                                    <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--d-muted)]">
                                        <CalendarCheck className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                        Senza data
                                    </div>
                                ) : (
                                    <div className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${isUpcoming ? 'text-[var(--d-text)]' : 'text-[var(--d-muted)]'}`}>
                                        <CalendarCheck className={`h-4 w-4 shrink-0 ${isUpcoming ? 'text-[var(--d-orange)]' : ''}`} strokeWidth={1.75} aria-hidden="true" />
                                        {quando(lead.appointmentDate)}
                                    </div>
                                )}
                                <div className="inline-flex items-center gap-1 text-[13px] text-[var(--d-faint)]">
                                    <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                    Fissato il {lead.appointmentCreatedAt ? dataBreveRoma(new Date(lead.appointmentCreatedAt)) : 'N/D'}
                                </div>
                            </div>
                        </div>
                        {(isUpcoming || isRifissaggio) && (
                            <button
                                type="button"
                                onClick={() => setEditingLead(lead)}
                                aria-label={`${etichettaModifica}: orario o note dell'appuntamento`}
                                title="Modifica orario o note dell'appuntamento"
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-2 border-[var(--d-line)] px-2.5 text-[13px] font-medium text-[var(--d-text)] transition-colors hover:border-[var(--d-muted)] sm:px-3"
                            >
                                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <div className="hidden sm:block">{etichettaModifica}</div>
                            </button>
                        )}
                    </div>

                    {/* Riga 2: contatti e funnel, vanno a capo invece di tagliarsi */}
                    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[var(--d-muted)]">
                        <div className="inline-flex items-center gap-1.5 tabular-nums">
                            <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                            {lead.phone}
                        </div>
                        {lead.email && (
                            <div className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                                <Mail className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                <div className="min-w-0 break-all">{lead.email}</div>
                            </div>
                        )}
                        {funnel && (
                            <div className="inline-flex min-w-0 max-w-full items-center rounded-lg border border-[var(--d-line)] px-2 py-0.5 text-[12px] font-medium text-[var(--d-text)]">
                                <div className="truncate">{funnel}</div>
                            </div>
                        )}
                    </div>

                    {/* Nota dell'appuntamento */}
                    {lead.appointmentNote && (
                        <div className="break-words text-[14px] text-[var(--d-muted)]">“{lead.appointmentNote}”</div>
                    )}

                    {/* Ritorno da Conferme e venditore, come nella pagina di sempre */}
                    {conEsiti && (
                        <div className="flex min-w-0 flex-wrap items-start gap-2 border-t border-[var(--d-line)] pt-2.5">
                            {conConferme && (
                                <div className={`${chip} border-[var(--d-orange)]`}>
                                    <div className="flex items-center gap-1.5">
                                        {pallino('var(--d-orange)')}
                                        {lead.recallDate
                                            ? `Le Conferme lo richiamano il ${quando(lead.recallDate)} per rifissarlo`
                                            : 'Le Conferme lo richiamano per rifissarlo'}
                                    </div>
                                    {lead.confRecallNotes && notaChip(lead.confRecallNotes)}
                                </div>
                            )}
                            {!isRifissaggio && lead.confSnoozeAt && (
                                <div className={`${chip} border-[var(--d-line)]`}>
                                    <div className="flex items-center gap-1.5">
                                        <BellRing className="h-3.5 w-3.5 shrink-0 text-[var(--d-orange)]" strokeWidth={1.75} aria-hidden="true" />
                                        Conferme: da risentire il {quando(lead.confSnoozeAt)}
                                    </div>
                                </div>
                            )}
                            {lead.confirmationsOutcome === 'confermato' && (
                                <div className={`${chip} border-[var(--d-line)]`}>
                                    <div className="flex items-center gap-1.5">{pallino('var(--d-ok)')}Conferme: confermato</div>
                                </div>
                            )}
                            {lead.confirmationsOutcome === 'scartato' && (
                                <div className={`${chip} border-[var(--d-line)]`}>
                                    <div className="flex items-center gap-1.5">{pallino('var(--d-ko)')}Conferme: scartato</div>
                                    {lead.confirmationsDiscardReason && notaChip(lead.confirmationsDiscardReason)}
                                </div>
                            )}
                            {lead.salespersonOutcome === 'Chiuso' && (
                                <div className={`${chip} border-[var(--d-orange)]`}>
                                    <div className="flex items-center gap-1.5">{pallino('var(--d-orange)')}Esito finale: chiuso</div>
                                    {lead.salespersonOutcomeNotes && notaChip(lead.salespersonOutcomeNotes)}
                                </div>
                            )}
                            {lead.salespersonOutcome === 'Non chiuso' && (
                                <div className={`${chip} border-[var(--d-line)]`}>
                                    <div className="flex items-center gap-1.5">{pallino('var(--d-faint)')}Esito finale: non chiuso</div>
                                    {lead.salespersonOutcomeNotes && notaChip(lead.salespersonOutcomeNotes)}
                                </div>
                            )}
                            {lead.salespersonOutcome === 'Lead non presenziato' && (
                                <div className={`${chip} border-[var(--d-line)]`}>
                                    <div className="flex items-center gap-1.5">{pallino('var(--d-ko)')}Esito finale: non si è presentato</div>
                                    {lead.salespersonOutcomeNotes && notaChip(lead.salespersonOutcomeNotes)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )
        }

        const vuoto = activeTab === 'upcoming'
            ? { titolo: 'Nessun appuntamento in programma', testo: 'Continua a chiamare lead per fissare appuntamenti.' }
            : activeTab === 'rifissaggio'
                ? { titolo: 'Nessun appuntamento da rifissare', testo: 'Quando le Conferme mettono un tuo appuntamento da rifissare, lo trovi qui con il giorno in cui lo richiamano.' }
                : { titolo: 'Nessun appuntamento passato', testo: 'Gli appuntamenti scorsi appariranno qui.' }

        return (
            <div className="d-board mx-auto flex w-full min-w-0 max-w-5xl flex-col">
                <div role="tablist" aria-label="Appuntamenti" className="flex shrink-0 gap-1 overflow-x-auto pb-3">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-[14px] transition-colors ${activeTab === tab.key
                                ? 'bg-[var(--d-text)] font-semibold text-[var(--d-bg)]'
                                : 'text-[var(--d-muted)] hover:text-[var(--d-text)]'}`}
                        >
                            {tab.label} <span className="tabular-nums">{tab.count}</span>
                        </button>
                    ))}
                </div>

                <div className="flex flex-col gap-2.5 pb-24">
                    {activeTab === 'upcoming' && daRifissare.length > 0 && (
                        <>
                            <div className="pt-1 text-[14px] font-semibold text-[var(--d-orange)]">
                                Da rifissare, li stanno richiamando le Conferme <span className="tabular-nums">{daRifissare.length}</span>
                            </div>
                            {daRifissare.map(lead => cardDiretta(lead, 'rifissaggio'))}
                            <div className="pt-2 text-[14px] font-semibold text-[var(--d-muted)]">
                                In programma <span className="tabular-nums">{upcoming.length}</span>
                            </div>
                        </>
                    )}
                    {activeTab === 'rifissaggio' ? (
                        <>
                            {daRifissare.map(lead => cardDiretta(lead, 'rifissaggio'))}
                            {altriSenzaData.length > 0 && (
                                <div className="pt-3 text-[14px] font-semibold text-[var(--d-muted)]">
                                    Senza data, già esitati dalle Conferme <span className="tabular-nums">{altriSenzaData.length}</span>
                                </div>
                            )}
                            {altriSenzaData.map(lead => cardDiretta(lead, 'rifissaggio'))}
                        </>
                    ) : currentList.map(lead => cardDiretta(lead, activeTab))}
                    {currentList.length === 0 && !(activeTab === 'upcoming' && daRifissare.length > 0) && (
                        <div className="rounded-2xl border-2 border-[var(--d-surface)] px-6 py-12 text-center">
                            <div className="text-[16px] font-semibold text-[var(--d-text)]">{vuoto.titolo}</div>
                            <div className="mt-1 text-[14px] text-[var(--d-muted)]">{vuoto.testo}</div>
                        </div>
                    )}
                </div>

                {/* Il modale resta chiaro: senza questo contenitore erediterebbe
                    il testo chiaro della pagina scura e diventerebbe illeggibile. */}
                <div className="text-ash-900 [color-scheme:light]">
                    <EditAppointmentModal
                        isOpen={!!editingLead}
                        onClose={() => setEditingLead(null)}
                        leadName={editingLead?.name || ""}
                        initialDate={editingLead?.appointmentDate || null}
                        initialNote={editingLead?.appointmentNote || ""}
                        onSave={salvaModifica}
                    />
                </div>
            </div>
        )
    }

    const renderCard = (lead: any, variant: 'upcoming' | 'past' | 'rifissaggio') => {
        const isUpcoming = variant === 'upcoming'
        const isRifissaggio = variant === 'rifissaggio'
        return (
        <div key={lead.id} className={`bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-x-4 sm:gap-y-2 group relative overflow-hidden ${isUpcoming ? 'border-green-200 hover:border-green-400' : isRifissaggio ? 'border-sky-200 hover:border-sky-400' : 'border-ash-200 hover:border-ash-300'}`}>
            {/* Visual Highlight indicator left */}
            {isUpcoming && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>}
            {isRifissaggio && <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-500"></div>}

            {/* Pulsante Modifica Veloce (per i rifissaggi è il modo per fissare la nuova data) */}
            {(isUpcoming || isRifissaggio) && (
                <button 
                    onClick={() => setEditingLead(lead)}
                    className="absolute right-2 top-2 p-1.5 text-ash-400 hover:text-brand-orange hover:bg-orange-50 rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10 bg-white shadow-sm border border-ash-100"
                    title="Modifica Orario/Note Appuntamento"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
            )}

            {/* 1. Nome & Contatti */}
            <div className="flex-1 min-w-0 sm:min-w-[220px] pl-2 flex flex-col justify-center">
                <h3 className="font-bold text-ash-900 text-sm flex items-center gap-2">
                    {lead.name}
                    {isUpcoming ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <CalendarCheck className="h-4 w-4 text-ash-400" />}
                </h3>
                <div className="flex items-center gap-3 text-xs text-ash-500 mt-1">
                    <span className="flex items-center gap-1 hover:text-brand-orange cursor-copy transition-colors">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                    </span>
                    {lead.email && (
                        <span className="flex items-center gap-1 truncate max-w-[140px]" title={lead.email}>
                            <Mail className="h-3 w-3" />
                            {lead.email}
                        </span>
                    )}
                </div>
            </div>

            {/* 2. Funnel Pill */}
            <div className="w-32 hidden md:flex flex-col items-start justify-center">
                {lead.funnel ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-ash-100 text-ash-600 border border-ash-200">
                        {lead.funnel}
                    </span>
                ) : <span className="text-[10px] text-ash-300 italic">No funnel</span>}
            </div>

            {/* 3. Appointment Note */}
            <div className="flex-1 hidden xl:flex flex-col justify-center">
                {lead.appointmentNote ? (
                    <div className="text-xs text-ash-600 line-clamp-2 italic pr-4" title={lead.appointmentNote}>
                        "{lead.appointmentNote}"
                    </div>
                ) : <span className="text-xs text-ash-300 italic">Nessuna nota</span>}
            </div>

            {/* 4. Dates & Action */}
            <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0 w-full sm:w-48 text-left sm:text-right">
                {isRifissaggio ? (
                    <div className="text-xs font-bold px-2 py-1 rounded inline-flex items-center justify-end gap-1 w-full bg-sky-100 text-sky-700">
                        <RefreshCcw className="h-3 w-3" />
                        {lead.rifissaggioConferme
                            ? `Da rifissare${lead.recallDate ? ` · le Conferme lo richiamano il ${new Date(lead.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}` : ''}`
                            : 'Senza data'}
                    </div>
                ) : (
                    <div className={`text-xs font-bold px-2 py-1 rounded inline-flex items-center justify-end gap-1 w-full ${isUpcoming ? 'bg-green-100 text-green-700' : 'bg-ash-100 text-ash-600'}`}>
                        <CalendarCheck className="h-3 w-3" />
                        {lead.appointmentDate ? new Date(lead.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : 'N/D'}
                    </div>
                )}
                <div className="text-[10px] text-ash-400 flex items-center gap-1 w-full justify-end">
                    <Clock className="h-3 w-3" /> Fissato il: {lead.appointmentCreatedAt ? new Date(lead.appointmentCreatedAt).toLocaleDateString() : 'N/D'}
                </div>
            </div>

            {/* 5. GDO Feedback Loop (Conferme & Vendita) */}
            {/* La sentinella degli autofissati e' truthy ma nessun ramo qui dentro
                la riconosce: senza escluderla usciva un riquadro vuoto. */}
            {((lead.confirmationsOutcome && !isSelfBooked(lead.confirmationsOutcome)) || lead.salespersonOutcome || (isRifissaggio && lead.rifissaggioConferme) || lead.confSnoozeAt) && (
                <div className="w-full mt-3 pt-3 border-t border-dashed border-ash-200 flex flex-wrap items-start gap-3 col-span-full">

                    {/* Parcheggiato dalle Conferme: il GDO deve rifissare la data */}
                    {isRifissaggio && lead.rifissaggioConferme && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-sky-50 text-sky-700 px-2 py-1 rounded border border-sky-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                Conferme: appuntamento da rifissare
                            </div>
                            {lead.confRecallNotes && (
                                <span className="font-normal italic text-sky-600 ml-3">"{lead.confRecallNotes}"</span>
                            )}
                        </div>
                    )}

                    {/* Snooze Conferme: lo risentiranno più tardi */}
                    {!isRifissaggio && lead.confSnoozeAt && (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold bg-sky-50 text-sky-700 px-2 py-1 rounded border border-sky-200">
                            <BellRing className="h-3 w-3" />
                            Conferme: da risentire il {new Date(lead.confSnoozeAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                        </div>
                    )}

                    {/* Conferme Badge */}
                    {lead.confirmationsOutcome === 'confermato' && (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Conferme: OK
                        </div>
                    )}
                    {lead.confirmationsOutcome === 'scartato' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-rose-50 text-rose-700 px-2 py-1 rounded border border-rose-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                Conferme: Scartato
                            </div>
                            {lead.confirmationsDiscardReason && (
                                <span className="font-normal italic text-rose-600 ml-3">"{lead.confirmationsDiscardReason}"</span>
                            )}
                        </div>
                    )}

                    {/* Salesperson Badge */}
                    {lead.salespersonOutcome === 'Chiuso' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-gold-50 text-gold-700 px-2 py-1 rounded border border-gold-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gold-500"></span>
                                Esito Finale: CHIUSO
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-gold-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}
                    {lead.salespersonOutcome === 'Non chiuso' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-ash-50 text-ash-700 px-2 py-1 rounded border border-ash-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-ash-500"></span>
                                Esito Finale: Non Chiuso
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-ash-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}
                    {lead.salespersonOutcome === 'Lead non presenziato' && (
                        <div className="flex flex-col items-start gap-0.5 text-[11px] font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                Esito Finale: Buca (No Show)
                            </div>
                            {lead.salespersonOutcomeNotes && (
                                <span className="font-normal italic text-amber-600 ml-3">"{lead.salespersonOutcomeNotes}"</span>
                            )}
                        </div>
                    )}

                </div>
            )}
        </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-ash-200 shadow-sm overflow-hidden max-w-5xl mx-auto">

            {/* STICKY HEADER & TAB BAR */}
            <div className="sticky top-0 z-20 bg-white border-b border-ash-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="flex space-x-1 bg-ash-100/80 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('upcoming')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'upcoming' ? 'bg-green-50 text-green-700 ring-1 ring-green-200 shadow-sm' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            <CheckCircle2 className={`h-4 w-4 ${activeTab === 'upcoming' ? 'text-green-600' : ''}`} />
                            In Programma <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{upcoming.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('rifissaggio')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'rifissaggio' ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 shadow-sm' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            <RefreshCcw className={`h-4 w-4 ${activeTab === 'rifissaggio' ? 'text-sky-600' : ''}`} />
                            Da Rifissare <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">{inRifissaggio.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('past')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'past' ? 'bg-white text-ash-900 ring-1 ring-ash-200 shadow-sm' : 'text-ash-500 hover:text-ash-700'}`}
                        >
                            <CalendarCheck className={`h-4 w-4 ${activeTab === 'past' ? 'text-ash-500' : ''}`} />
                            Archivio Storico <span className="text-xs bg-ash-200 text-ash-700 px-1.5 py-0.5 rounded-full">{past.length}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* LIST AREA */}
            <div className="flex-1 overflow-y-auto bg-ash-50/30 p-4">
                <div className="flex flex-col gap-3 max-w-5xl mx-auto">
                    {currentList.map((lead) => renderCard(lead, activeTab))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-dashed border-ash-300 rounded-xl">
                            <span className="text-5xl mb-4">{activeTab === 'upcoming' ? '📭' : activeTab === 'rifissaggio' ? '✅' : '📜'}</span>
                            <h3 className="text-lg font-medium text-ash-900">
                                {activeTab === 'upcoming' ? 'Nessun appuntamento in programma' : activeTab === 'rifissaggio' ? 'Nessun appuntamento da rifissare' : 'Nessun appuntamento passato'}
                            </h3>
                            <p className="text-ash-500 mt-1 max-w-sm">
                                {activeTab === 'upcoming' ? 'Continua a chiamare lead per fissare appuntamenti.' : activeTab === 'rifissaggio' ? 'Quando le Conferme parcheggiano un tuo appuntamento da rifissare, lo trovi qui.' : 'Le anagrafiche degli appuntamenti scorsi appariranno qui.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal Render */}
            <EditAppointmentModal 
                isOpen={!!editingLead}
                onClose={() => setEditingLead(null)}
                leadName={editingLead?.name || ""}
                initialDate={editingLead?.appointmentDate || null}
                initialNote={editingLead?.appointmentNote || ""}
                onSave={salvaModifica}
            />
        </div>
    )
}
