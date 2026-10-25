"use client"

import { useState, useRef, useEffect } from "react"
import { Phone, Users, CheckCircle2, XCircle, Clock, Calendar, CheckSquare, MonitorPlay, EyeOff, Undo2, RotateCcw, Rocket, ClipboardList } from "lucide-react"
import { format } from "date-fns"
import { CompanyBadge } from "./CompanyBadge"
import { recordConfermeNoAnswer, undoConfermeNoAnswer, setConfermeSnooze, scheduleConfermeRecall, cancelConfermeRecall } from "@/app/actions/confermeActions"
import { getAnimationsEnabled } from "@/lib/animationUtils"
import { ConfermeCallTimer } from "@/components/ConfermeCallTimer"
import { consumeTimerForLead } from "@/lib/confermeCallTimer"
import { logConfermeCallDuration } from "@/app/actions/confermeAnalyticsActions"
import { isCallNowHandoff, isLeadLancio, lancioSceltaLabel } from "@/lib/lancio/conferme"
import { collegaName, gdoName } from "@/lib/conferme/boardView"
import { dUi } from "@/components/conferme/diretta/ui"
import { dataOraRoma, oraRoma } from "@/lib/diretta/formato"
import { funnelLeggibile } from "@/lib/diretta/funnel"

/**
 * Riga della board Conferme. `variant` 'diretta' = restyle scuro (PO 25/10/2026):
 * stessi stati, stessi gestori, stesse action; cambia solo il disegno, che sta
 * in un ramo di render a parte per lasciare identica la grafica classica.
 */
export function ConfermeBoardRow({ item, currentUser, isLocked, lockedByName, onRefresh, onRowClick, layoutMode = 'default', variant = 'classic' }: any) {
    const lead = item.lead

    // Client-side time for overdue checks (avoids hydration mismatch)
    const [clientNow, setClientNow] = useState(0)
    useEffect(() => {
        setClientNow(Date.now())
        const interval = setInterval(() => setClientNow(Date.now()), 60000)
        return () => clearInterval(interval)
    }, [])

    // States for Popovers
    const [showSnoozePopover, setShowSnoozePopover] = useState(false)
    const [snoozeTime, setSnoozeTime] = useState("")
    const [snoozeVslSeen, setSnoozeVslSeen] = useState(lead.confVslSeen || false)
    const [snoozeNotes, setSnoozeNotes] = useState(lead.confRecallNotes || "")
    const [isSavingSnooze, setIsSavingSnooze] = useState(false)

    const [showRecallPopover, setShowRecallPopover] = useState(false)
    const [recallDate, setRecallDate] = useState("")
    const [recallTime, setRecallTime] = useState("")
    const [vslSeen, setVslSeen] = useState(lead.confVslSeen || false)
    const [recallNotes, setRecallNotes] = useState(lead.confRecallNotes || "")
    const [isSavingRecall, setIsSavingRecall] = useState(false)

    // Click outside to close popovers
    const rowRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
                setShowSnoozePopover(false)
                setShowRecallPopover(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const [actionBusy, setActionBusy] = useState(false)

    let callsMade = 0;
    if (lead.confCall1At) callsMade = 1;
    if (lead.confCall2At) callsMade = 2;
    if (lead.confCall3At) callsMade = 3;

    /** Apply micro-animation to the row card, then call callback after delay */
    const animateAndRefresh = async (anim: string, durationMs: number) => {
        // Diretta: niente bagliore (pa-amber-pulse è un box-shadow), solo il piccolo salto.
        if (variant === 'diretta' && anim === 'pa-amber-pulse') {
            anim = 'pa-bounce'
            durationMs = 200
        }
        if (getAnimationsEnabled() && rowRef.current) {
            rowRef.current.style.animation = `${anim} ${durationMs}ms ease-out`
            await new Promise(r => setTimeout(r, durationMs + 50))
            if (rowRef.current) rowRef.current.style.animation = ''
        }
        onRefresh()
    }

    /** Handle concurrency errors: auto-refresh and show friendly message */
    const handleActionError = (error?: string | null) => {
        if (error?.includes('CONCURRENCY_ERROR')) {
            onRefresh()
            alert("Questo lead è stato aggiornato da un altro operatore. I dati sono stati ricaricati, riprova.")
        } else {
            alert(error || "Errore sconosciuto")
        }
    }

    /** Ferma il timer per questo lead se attivo e logga la durata.
     *  Da chiamare PRIMA della server action (NR / outcome / snooze / recall). */
    const stopTimerAndLog = async (actionTaken: 'nr' | 'outcome' | null) => {
        const consumed = consumeTimerForLead(lead.id);
        if (!consumed) return;
        await logConfermeCallDuration(lead.id, consumed.durationSeconds, { actionTaken })
            .catch(err => console.error("logConfermeCallDuration err:", err));
    };

    const handleQuickNR = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (actionBusy) return
        setActionBusy(true)
        try {
            await stopTimerAndLog('nr');
            const res = await recordConfermeNoAnswer(lead.id, lead.version);
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                handleActionError(res.error)
            }
        } catch (e: any) {
            handleActionError(e.message)
        } finally {
            setActionBusy(false)
        }
    }

    const handleUndoNR = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (actionBusy) return
        setActionBusy(true)
        try {
            const res = await undoConfermeNoAnswer(lead.id, lead.version);
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                handleActionError(res.error)
            }
        } catch (e: any) {
            handleActionError(e.message)
        } finally {
            setActionBusy(false)
        }
    }

    const handleSaveSnooze = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!snoozeTime) return alert("Seleziona un orario");
        setIsSavingSnooze(true);
        try {
            await stopTimerAndLog('outcome');
            const [hours, minutes] = snoozeTime.split(":");
            const d = new Date();
            d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

            const res = await setConfermeSnooze(lead.id, lead.version, d, {
                vslSeen: snoozeVslSeen,
                snoozeNotes: snoozeNotes
            });
            if (res.success) {
                setShowSnoozePopover(false);
                setSnoozeNotes("");
                setSnoozeVslSeen(false);
                await animateAndRefresh('pa-amber-pulse', 800);
            } else {
                handleActionError(res.error);
            }
        } catch (e: any) {
            handleActionError(e.message);
        } finally {
            setIsSavingSnooze(false);
        }
    }

    // Nessun "Fissa comunque" qui: il parcheggio passa sempre
    // `newAppointmentDate: null`, quindi il muro del fissaggio non viene
    // nemmeno interrogato e un rifiuto `needsForce` non può arrivare.
    const handleSaveRecall = async () => {
        if (!recallDate) return alert("Seleziona una data per il richiamo");
        setIsSavingRecall(true);
        try {
            await stopTimerAndLog('outcome');
            const rDate = new Date(`${recallDate}T${recallTime || '00:00'}:00`);

            const res = await scheduleConfermeRecall(lead.id, lead.version, {
                recallDate: rDate,
                vslSeen,
                needsReschedule: true,
                newAppointmentDate: null,
                recallNotes
            });

            if (res && (!res.success)) {
                handleActionError(res.error || "Errore");
            } else {
                setShowRecallPopover(false);
                setRecallNotes("");
                await animateAndRefresh('pa-amber-pulse', 800);
            }
        } catch (e: any) {
            handleActionError(e.message);
        } finally {
            setIsSavingRecall(false);
        }
    }

    const [isCancellingRecall, setIsCancellingRecall] = useState(false)

    const handleCancelSnooze = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (actionBusy) return
        setIsCancellingRecall(true)
        setActionBusy(true)
        try {
            const res = await cancelConfermeRecall(lead.id, lead.version, "snooze")
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                handleActionError(res.error)
            }
        } catch (e: any) {
            handleActionError(e.message)
        } finally {
            setIsCancellingRecall(false)
            setActionBusy(false)
        }
    }

    const handleCancelParkRecall = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (actionBusy) return
        if (!confirm("Annullare il richiamo programmato? Il lead tornerà nella board con la data del richiamo come appuntamento.")) return
        setIsCancellingRecall(true)
        setActionBusy(true)
        try {
            const res = await cancelConfermeRecall(lead.id, lead.version, "park")
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                handleActionError(res.error)
            }
        } catch (e: any) {
            handleActionError(e.message)
        } finally {
            setIsCancellingRecall(false)
            setActionBusy(false)
        }
    }

    // Determine card accent based on state
    const isSnoozeOverdue = clientNow > 0 && lead.confSnoozeAt && new Date(lead.confSnoozeAt).getTime() <= clientNow && !lead.confirmationsOutcome;

    if (variant === 'diretta') {
        // Ore in ora di Roma, scritte a mano: uguali sul server e nel browser.
        const ora = (d: string | Date) => oraRoma(new Date(d))
        const esito = (() => {
            if (!lead.confirmationsOutcome) return null
            const sales = lead.salespersonOutcome
            if (sales === 'Chiuso') return 'Chiuso'
            if (sales === 'Non chiuso') return 'Presenziato'
            if (sales === 'Lead non presenziato') return 'Sparito'
            if (lead.confirmationsOutcome === 'confermato') return 'Confermato'
            if (lead.confirmationsOutcome === 'scartato') return 'Scartato'
            return null
        })()
        // Bordo pieno (mai su un lato solo): arancione per lo snooze scaduto, grigio per il lead in mano a un collega.
        const stato = isSnoozeOverdue
            ? 'border-[var(--d-orange)]'
            : isLocked
                ? 'border-[var(--d-line)]'
                : 'border-transparent hover:bg-[var(--d-surface-2)]'
        const nrFinale = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-[var(--d-orange)] bg-transparent px-3 text-[13px] font-medium text-[var(--d-orange)] transition-colors hover:bg-[var(--d-surface-2)] disabled:cursor-not-allowed disabled:opacity-50'
        const salvaPopover = 'inline-flex h-9 items-center rounded-lg bg-[var(--d-orange)] px-4 text-[13px] font-semibold text-[var(--d-orange-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

        return (
            <div
                ref={rowRef}
                onClick={onRowClick}
                className={`group relative mb-2 flex cursor-pointer flex-col gap-3 rounded-lg border-2 bg-[var(--d-surface)] px-4 py-3 text-sm text-[var(--d-text)] transition-colors ${stato}`}
            >
                <div className={`flex gap-x-3 gap-y-3 ${layoutMode === 'snooze' ? 'flex-col' : 'flex-wrap items-start justify-between'}`}>

                    {/* Chi è e a che punto è. La base di 24rem (collaudo del 25/10/2026):
                        se accanto ai bottoni non resta posto, i bottoni vanno a capo
                        invece di schiacciare il nome a "P…". */}
                    <div className={`pointer-events-none flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 ${layoutMode === 'snooze' ? '' : 'basis-[24rem]'}`}>
                        <div className="flex min-w-[9rem] max-w-full items-center gap-2">
                            <span className={`truncate text-[15px] font-semibold ${layoutMode === 'snooze' ? '' : 'max-w-[240px]'}`}>{lead.name}</span>
                            {lead.confVslSeen
                                ? <MonitorPlay className="h-4 w-4 shrink-0 text-[var(--d-faint)]" strokeWidth={1.75} aria-label="Video visto" />
                                : <EyeOff className="h-4 w-4 shrink-0 text-[var(--d-orange)]" strokeWidth={1.75} aria-label="Video non visto" />}
                            {lead.botReport && <ClipboardList className="h-4 w-4 shrink-0 text-[var(--d-muted)]" strokeWidth={1.75} aria-label="Con il report del Fissatore" />}
                        </div>
                        {esito && <div className="font-medium text-[var(--d-muted)]">{esito}</div>}
                        {isLeadLancio(lead) && (
                            <div className="flex items-center gap-1.5 text-[var(--d-muted)]">
                                <Rocket className="h-3.5 w-3.5" strokeWidth={1.75} /> Lancio
                            </div>
                        )}
                        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--d-muted)]">
                            <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />{lead.phone}
                        </div>
                        {layoutMode !== 'snooze' && (
                            <div className="hidden shrink-0 items-center gap-3 sm:flex">
                                <span className="font-medium">{gdoName(item.gdo)}</span>
                                {lead.funnel && <span className="max-w-[160px] truncate text-[var(--d-muted)]">{funnelLeggibile(lead.funnel)}</span>}
                            </div>
                        )}
                        {layoutMode === 'richiami' && lead.recallDate ? (
                            <div className="flex shrink-0 items-center gap-1.5 font-medium">
                                <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />
                                Richiamo {dataOraRoma(new Date(lead.recallDate))}
                            </div>
                        ) : (
                            !lead.confirmationsOutcome && callsMade > 0 && layoutMode !== 'richiami' && (
                                <div className="shrink-0 text-[var(--d-muted)]">{callsMade}ª chiamata a vuoto</div>
                            )
                        )}
                        {!lead.confirmationsOutcome && lead.confSnoozeAt && (
                            <div className={`flex shrink-0 items-center gap-1.5 font-medium ${isSnoozeOverdue ? 'text-[var(--d-orange)]' : 'text-[var(--d-muted)]'}`}>
                                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                                {isSnoozeOverdue ? `Da risentire adesso, era alle ${ora(lead.confSnoozeAt)}` : `Da risentire alle ${ora(lead.confSnoozeAt)}`}
                            </div>
                        )}
                        {isLocked && (
                            <div className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--d-orange)]">
                                <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
                                {lockedByName ? `In lavorazione da ${collegaName(lockedByName)}` : 'In lavorazione da un collega'}
                            </div>
                        )}
                    </div>

                    {/* Azioni: stessi gestori della grafica classica */}
                    <div className={`relative flex shrink-0 flex-wrap items-center gap-2 ${layoutMode === 'snooze' ? 'w-full border-t-2 border-[var(--d-line)] pt-3' : 'justify-end'}`}>
                        {lead.confirmationsOutcome === "confermato" ? (
                            <div className="flex items-center gap-1.5 font-medium text-[var(--d-muted)]">
                                <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} /> Confermato
                            </div>
                        ) : lead.confirmationsOutcome === "scartato" ? (
                            <div className="flex items-center gap-1.5 font-medium text-[var(--d-muted)]">
                                <XCircle className="h-4 w-4" strokeWidth={1.75} /> Scartato
                            </div>
                        ) : null}

                        {!lead.confirmationsOutcome && (
                            <>
                                <ConfermeCallTimer leadId={lead.id} disabled={isLocked} variant="diretta" />

                                {lead.confSnoozeAt && (
                                    <button
                                        onClick={handleCancelSnooze}
                                        disabled={isLocked || isCancellingRecall}
                                        title="Annulla lo snooze e rimetti il lead nella board"
                                        className={dUi.btn}
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> {isCancellingRecall ? "..." : "Annulla snooze"}
                                    </button>
                                )}

                                {lead.confNeedsReschedule && (
                                    <button
                                        onClick={handleCancelParkRecall}
                                        disabled={isLocked || isCancellingRecall}
                                        title="Annulla il richiamo e rimetti il lead nella board"
                                        className={dUi.btn}
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> {isCancellingRecall ? "..." : "Annulla richiamo"}
                                    </button>
                                )}

                                <button
                                    onClick={handleQuickNR}
                                    disabled={isLocked || actionBusy}
                                    title={callsMade >= 2 ? "Terza chiamata a vuoto: il lead viene scartato" : "Non risponde"}
                                    className={callsMade >= 2 ? nrFinale : dUi.btn}
                                >
                                    {actionBusy ? '...' : callsMade >= 2 ? '3° NR, scarta' : 'NR'}
                                </button>

                                {callsMade > 0 && (
                                    <button
                                        onClick={handleUndoNR}
                                        disabled={isLocked || actionBusy}
                                        title="Annulla l'ultimo NR"
                                        className={dUi.btn}
                                    >
                                        <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Annulla NR
                                    </button>
                                )}

                                <div className="relative">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowSnoozePopover(!showSnoozePopover); setShowRecallPopover(false); }}
                                        disabled={isLocked}
                                        className={dUi.btn}
                                    >
                                        <Clock className="h-3.5 w-3.5" strokeWidth={1.75} /> Risentire dopo
                                    </button>

                                    {showSnoozePopover && !isLocked && (
                                        <div onClick={e => e.stopPropagation()} className={`${dUi.popover} w-64`}>
                                            <h4 className="mb-3 text-[13px] font-semibold">Richiamalo oggi alle</h4>
                                            <input
                                                type="time"
                                                value={snoozeTime}
                                                onChange={e => setSnoozeTime(e.target.value)}
                                                className={`${dUi.input} mb-3`}
                                            />
                                            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                                                <input
                                                    type="checkbox"
                                                    checked={snoozeVslSeen}
                                                    onChange={e => setSnoozeVslSeen(e.target.checked)}
                                                    className="h-4 w-4 accent-[var(--d-orange)]"
                                                />
                                                VSL vista
                                            </label>
                                            <textarea
                                                value={snoozeNotes}
                                                onChange={e => setSnoozeNotes(e.target.value)}
                                                placeholder="Nota breve..."
                                                className={`${dUi.input} mb-3 resize-none`}
                                                rows={2}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => setShowSnoozePopover(false)} className={dUi.btnText}>Annulla</button>
                                                <button onClick={handleSaveSnooze} disabled={isSavingSnooze} className={salvaPopover}>
                                                    {isSavingSnooze ? "..." : "Salva"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="relative">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowRecallPopover(!showRecallPopover); setShowSnoozePopover(false); }}
                                        disabled={isLocked}
                                        className={dUi.btn}
                                    >
                                        <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} /> Programma richiamo
                                    </button>

                                    {showRecallPopover && !isLocked && (
                                        <div onClick={e => e.stopPropagation()} className={`${dUi.popover} max-h-[70vh] w-72 overflow-y-auto`}>
                                            <h4 className="mb-3 text-[13px] font-semibold">Parcheggia il lead</h4>
                                            <div className="mb-3 grid grid-cols-[3fr_2fr] gap-2">
                                                <input
                                                    type="date"
                                                    value={recallDate}
                                                    onChange={e => setRecallDate(e.target.value)}
                                                    aria-label="Giorno del richiamo"
                                                    className={dUi.input}
                                                />
                                                <input
                                                    type="time"
                                                    value={recallTime}
                                                    onChange={e => setRecallTime(e.target.value)}
                                                    aria-label="Ora del richiamo"
                                                    className={dUi.input}
                                                />
                                            </div>
                                            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                                                <input
                                                    type="checkbox"
                                                    checked={vslSeen}
                                                    onChange={e => setVslSeen(e.target.checked)}
                                                    className="h-4 w-4 accent-[var(--d-orange)]"
                                                />
                                                VSL vista
                                            </label>
                                            <textarea
                                                value={recallNotes}
                                                onChange={e => setRecallNotes(e.target.value)}
                                                placeholder="Note di parcheggio, se servono..."
                                                className={`${dUi.input} mb-3 resize-none`}
                                                rows={2}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => setShowRecallPopover(false)} className={dUi.btnText}>Annulla</button>
                                                <button onClick={() => handleSaveRecall()} disabled={isSavingRecall || !recallDate} className={salvaPopover}>
                                                    {isSavingRecall ? "..." : "Parcheggia"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {lead.confRecallNotes && !lead.confirmationsOutcome && (
                    <div className="pointer-events-none w-full border-t-2 border-[var(--d-line)] pt-2 text-[13px]">
                        <span className="font-semibold">Nota: </span>
                        <span className="whitespace-pre-wrap break-words text-[var(--d-muted)]">{lead.confRecallNotes}</span>
                    </div>
                )}

                {item.lastConfermeNote && (
                    <div className="pointer-events-none flex w-full items-center gap-2 text-[13px]" title={item.lastConfermeNote.text}>
                        <span className="shrink-0 font-semibold">Conferme</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--d-muted)]">{item.lastConfermeNote.text}</span>
                    </div>
                )}

                {item.lastBotNote && (
                    <div className="pointer-events-none flex w-full items-center gap-2 text-[13px]" title={item.lastBotNote.text}>
                        <span className="shrink-0 font-semibold">Fissatore</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--d-muted)]">{item.lastBotNote.text}</span>
                        <span className="shrink-0 text-[var(--d-faint)]">{format(new Date(item.lastBotNote.createdAt), "dd/MM HH:mm")}</span>
                        {item.lastBotNote.isNew && <span className="shrink-0 font-semibold text-[var(--d-orange)]">Nuova</span>}
                    </div>
                )}
            </div>
        )
    }

    const cardClasses = isLocked
        ? 'bg-gradient-to-r from-amber-50/80 to-amber-50/40 border-amber-200/60'
        : isSnoozeOverdue
            ? 'bg-gradient-to-r from-ember-50/60 to-rose-50/40 border-ember-200/60 hover:border-ember-300'
            : 'bg-white border-ash-200/60 hover:border-brand-orange/30 hover:shadow-card';

    return (
        <div
            ref={rowRef}
            onClick={onRowClick}
            className={`flex flex-col py-2.5 px-3.5 mb-2 text-[13px] border rounded-xl cursor-pointer transition-all duration-200 group relative shadow-soft ${cardClasses}`}
        >
            {/* Top Row: Info & Actions */}
            <div className={`flex items-start md:items-center justify-between gap-y-3 gap-x-2 ${layoutMode === 'snooze' ? 'flex-col w-full' : 'flex-row flex-wrap'}`}>

                {/* Left side: Info */}
                <div className={`flex items-center gap-2 md:gap-4 flex-1 min-w-0 pointer-events-none flex-wrap ${layoutMode === 'snooze' ? 'w-full' : ''}`}>
                    <div className={`font-bold text-ash-800 leading-tight flex items-center gap-2 ${layoutMode === 'snooze' ? 'w-full text-sm' : 'truncate max-w-[150px] md:max-w-[200px]'}`}>
                        {lead.name}
                        {lead.confVslSeen ? <div title="VSL Vista" className="flex items-center justify-center bg-blue-100 text-blue-600 rounded-lg p-1"><MonitorPlay className="w-3.5 h-3.5" /></div> : <div title="VSL NON Vista" className="flex items-center justify-center bg-red-100 text-red-500 rounded-lg p-1"><EyeOff className="w-3.5 h-3.5" /></div>}
                    </div>

                    {/* Badge esito Conferme/Vendita — visibile subito senza aprire drawer */}
                    {lead.confirmationsOutcome && (() => {
                        const conf = lead.confirmationsOutcome
                        const sales = lead.salespersonOutcome
                        if (sales === 'Chiuso') return <span title="Esito venditore: Chiuso" className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase shrink-0">✓ Chiuso</span>
                        if (sales === 'Non chiuso') return <span title="Esito venditore: Non chiuso (presenziato)" className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase shrink-0">Presenziato</span>
                        if (sales === 'Lead non presenziato') return <span title="Lead non presenziato" className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 uppercase shrink-0">Sparito</span>
                        if (conf === 'confermato') return <span title="Confermato dalle Conferme — in attesa esito venditore" className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase shrink-0">Confermato</span>
                        if (conf === 'scartato') return <span title={`Scartato: ${lead.confirmationsDiscardReason || 'motivo non specificato'}`} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 uppercase shrink-0">Scartato</span>
                        return null
                    })()}
                    {lead.botReport && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title="Lead con report del fissatore">📋</span>
                    )}
                    {/* Badge LANCIO (spec 2026-09-14 §4.5): ambra, come l'accento del lancio
                        su /lancio. `<div>` e non `<span>`: sta in un contenitore flex con
                        pointer-events-none e non deve mai diventare padre di un bottone. */}
                    {isLeadLancio(lead) && (
                        <div
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 uppercase shrink-0 flex items-center gap-1"
                            title={`Lancio Web Dev AI · ${lancioSceltaLabel(lead.lancioScelta, isCallNowHandoff(lead))}`}
                        >
                            <Rocket className="w-3 h-3" /> Lancio
                        </div>
                    )}
                    <div className={`text-ash-500 font-medium flex items-center gap-1.5 shrink-0 ${layoutMode === 'snooze' ? 'w-full text-xs' : 'whitespace-nowrap'}`}><Phone className="w-3.5 h-3.5 text-ash-400" />{lead.phone}</div>

                    {/* GDO name + Funnel (hidden in Snooze mode to save space) */}
                    {layoutMode !== 'snooze' && (
                        <div className="flex items-center gap-1.5 shrink-0 hidden sm:inline-flex">
                            <div className="text-brand-orange-600 font-bold truncate max-w-[150px]">{item.gdo?.displayName || item.gdo?.name || "N/A"}</div>
                            {lead.funnel && <div className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ash-100 text-ash-600 uppercase truncate max-w-[100px]">{lead.funnel}</div>}
                            <CompanyBadge companyId={lead.companyId} />
                        </div>
                    )}

                    {/* Badge NR or Recall Date */}
                    {layoutMode === 'richiami' && lead.recallDate ? (
                        <div className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-gradient-to-r from-blue-50 to-blue-100 text-blue-800 uppercase border border-blue-200/60 shadow-soft ml-1 flex items-center shrink-0">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(lead.recallDate))}
                        </div>
                    ) : (
                        !lead.confirmationsOutcome && callsMade > 0 && layoutMode !== 'richiami' && (
                            <div className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-gradient-to-r from-brand-orange-50 to-gold-50 text-brand-orange-800 uppercase border border-brand-orange-200/60 shadow-soft ml-1 flex items-center shrink-0">
                                {callsMade}° Chiamata a vuoto
                            </div>
                        )
                    )}

                    {/* Badge Snooze */}
                    {!lead.confirmationsOutcome && lead.confSnoozeAt && (() => {
                        const isOverdue = clientNow > 0 && new Date(lead.confSnoozeAt).getTime() <= clientNow;
                        return (
                            <div className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border shadow-soft ml-1 flex items-center gap-1 shrink-0 transition-all ${isOverdue ? 'bg-gradient-to-r from-ember-50 to-ember-100 text-ember-700 border-ember-300 animate-pulse' : 'bg-gradient-to-r from-brand-orange-50 to-gold-50 text-brand-orange-700 border-brand-orange-200/60'}`}>
                                <Clock className="w-3.5 h-3.5" />
                                {new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(lead.confSnoozeAt))}
                                {isOverdue && <div className="uppercase ml-0.5 text-ember-600 font-black">Scaduto</div>}
                            </div>
                        );
                    })()}

                    {isLocked && (
                        <div
                            className="flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase animate-pulse border border-amber-200 ml-1 shrink-0"
                            title={lockedByName ? `In lavorazione da ${lockedByName}` : 'In lavorazione da un altro utente'}
                        >
                            <Users className="w-3 h-3" /> In Lavorazione{lockedByName ? ` · ${lockedByName}` : ''}
                        </div>
                    )}
                </div>

                {/* Right side: Actions */}
                <div className={`flex items-center gap-2 shrink-0 relative ${layoutMode === 'snooze' ? 'w-full mt-2 pt-2 border-t border-ash-100 flex-wrap justify-start' : 'justify-end'}`}>
                    {lead.confirmationsOutcome === "confermato" ? (
                        <div className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] font-bold bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 border border-emerald-200/60 shadow-soft animate-fade-in">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                        </div>
                    ) : lead.confirmationsOutcome === "scartato" ? (
                        <div className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] font-bold bg-gradient-to-r from-ember-50 to-rose-50 text-ember-600 border border-ember-200/60 shadow-soft animate-fade-in">
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Scartato
                        </div>
                    ) : null}

                    {!lead.confirmationsOutcome && (
                        <>
                            <ConfermeCallTimer leadId={lead.id} disabled={isLocked} />

                            {/* BOTTONE ANNULLA SNOOZE — visibile solo se il lead ha uno snooze attivo */}
                            {lead.confSnoozeAt && (
                                <button
                                    onClick={handleCancelSnooze}
                                    disabled={isLocked || isCancellingRecall}
                                    title="Annulla snooze e rimetti il lead nella board"
                                    className="bg-white hover:bg-amber-50 border border-amber-200 hover:border-amber-400 text-amber-600 hover:text-amber-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card flex items-center gap-1"
                                >
                                    <RotateCcw className="w-3 h-3" /> {isCancellingRecall ? "..." : "Annulla Snooze"}
                                </button>
                            )}

                            {/* BOTTONE ANNULLA RICHIAMO PROGRAMMATO — visibile solo se il lead è parcheggiato */}
                            {lead.confNeedsReschedule && (
                                <button
                                    onClick={handleCancelParkRecall}
                                    disabled={isLocked || isCancellingRecall}
                                    title="Annulla richiamo e rimetti il lead nella board"
                                    className="bg-white hover:bg-blue-50 border border-blue-200 hover:border-blue-400 text-blue-600 hover:text-blue-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card flex items-center gap-1"
                                >
                                    <RotateCcw className="w-3 h-3" /> {isCancellingRecall ? "..." : "Annulla Richiamo"}
                                </button>
                            )}

                            {/* BOTTONE NR */}
                            <button
                                onClick={handleQuickNR}
                                disabled={isLocked || actionBusy}
                                className={`border px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card ${callsMade >= 2 ? 'bg-ember-50 hover:bg-ember-100 border-ember-300 text-ember-600 hover:text-ember-700' : 'bg-white hover:bg-ember-50 border-ash-200 hover:border-ember-300 text-ash-500 hover:text-ember-600'}`}
                            >
                                {actionBusy ? '...' : callsMade >= 2 ? '3° NR (Scarta)' : 'NR'}
                            </button>

                            {/* BOTTONE ANNULLA NR */}
                            {callsMade > 0 && (
                                <button
                                    onClick={handleUndoNR}
                                    disabled={isLocked || actionBusy}
                                    title="Annulla ultimo NR"
                                    className="bg-white hover:bg-amber-50 border border-ash-200 hover:border-amber-300 text-ash-500 hover:text-amber-600 px-2 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card flex items-center gap-1"
                                >
                                    <Undo2 className="w-3 h-3" /> Annulla NR
                                </button>
                            )}

                            {/* BOTTONE SNOOZE */}
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSnoozePopover(!showSnoozePopover); setShowRecallPopover(false); }}
                                    disabled={isLocked}
                                    className="bg-white hover:bg-brand-orange-50 border border-ash-200 hover:border-brand-orange/40 text-ash-500 hover:text-brand-orange-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 flex items-center gap-1 shadow-soft hover:shadow-card"
                                >
                                    <Clock className="w-3 h-3" /> Risentire Dopo
                                </button>

                                {/* SNOOZE POPOVER */}
                                {showSnoozePopover && !isLocked && (
                                    <div onClick={e => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-52 bg-white border border-ash-200/60 rounded-xl shadow-elevated z-50 p-3.5 animate-fade-in">
                                        <h4 className="text-[12px] font-bold text-ash-800 mb-2.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-brand-orange-600" /> Orario di Richiamo (Oggi)</h4>
                                        <input
                                            type="time"
                                            value={snoozeTime}
                                            onChange={e => setSnoozeTime(e.target.value)}
                                            className="w-full px-2.5 py-1.5 border border-ash-200 rounded-lg text-sm mb-3 outline-none focus:border-brand-orange/40 focus:ring-2 focus:ring-brand-orange/20 transition-all"
                                        />

                                        <label className="flex items-center gap-2 mb-3 text-[11px] font-semibold text-ash-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={snoozeVslSeen}
                                                onChange={e => setSnoozeVslSeen(e.target.checked)}
                                                className="w-3.5 h-3.5 text-brand-orange rounded border-ash-300"
                                            />
                                            VSL Vista
                                        </label>

                                        <textarea
                                            value={snoozeNotes}
                                            onChange={e => setSnoozeNotes(e.target.value)}
                                            placeholder="Note snooze brevi..."
                                            className="w-full px-2.5 py-1.5 border border-ash-200 rounded-lg text-[11px] outline-none focus:border-brand-orange/40 focus:ring-2 focus:ring-brand-orange/20 bg-white resize-none text-ash-800 placeholder:text-ash-400 mb-2.5 transition-all"
                                            rows={2}
                                        />

                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => setShowSnoozePopover(false)} className="px-2.5 py-1 text-xs text-ash-500 hover:text-ash-700 font-semibold transition-colors">Annulla</button>
                                            <button onClick={handleSaveSnooze} disabled={isSavingSnooze} className="px-3 py-1 text-xs bg-gradient-to-b from-brand-orange to-brand-orange-500 hover:from-brand-orange-500 hover:to-brand-orange-600 text-white rounded-lg font-bold disabled:opacity-50 shadow-soft transition-all">
                                                {isSavingSnooze ? "..." : "Salva"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* BOTTONE PROGRAMMA RICHIAMO */}
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowRecallPopover(!showRecallPopover); setShowSnoozePopover(false); }}
                                    disabled={isLocked}
                                    className="bg-white hover:bg-blue-50 border border-ash-200 hover:border-blue-300 text-ash-500 hover:text-blue-600 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 flex items-center gap-1 shadow-soft hover:shadow-card"
                                >
                                    <Calendar className="w-3 h-3" /> Programma Richiamo
                                </button>

                                {/* RECALL POPOVER */}
                                {showRecallPopover && !isLocked && (
                                    <div onClick={e => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-64 max-h-[70vh] overflow-y-auto bg-white border border-ash-200/60 rounded-xl shadow-elevated z-50 p-4 animate-fade-in">
                                        <h4 className="text-[12px] font-bold text-ash-800 mb-3 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-blue-600" /> Parcheggia Lead</h4>

                                        <div className="flex gap-2 mb-3">
                                            <input
                                                type="date"
                                                value={recallDate}
                                                onChange={e => setRecallDate(e.target.value)}
                                                className="w-3/5 px-2.5 py-1.5 border border-ash-200 rounded-lg text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                                            />
                                            <input
                                                type="time"
                                                value={recallTime}
                                                onChange={e => setRecallTime(e.target.value)}
                                                className="w-2/5 px-2.5 py-1.5 border border-ash-200 rounded-lg text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                                            />
                                        </div>

                                        <label className="flex items-center gap-2 mb-3 text-xs font-semibold text-ash-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={vslSeen}
                                                onChange={e => setVslSeen(e.target.checked)}
                                                className="w-3.5 h-3.5 text-blue-600 rounded border-ash-300"
                                            />
                                            VSL Vista
                                        </label>

                                        <textarea
                                            value={recallNotes}
                                            onChange={e => setRecallNotes(e.target.value)}
                                            placeholder="Note di parcheggio opzionali..."
                                            className="w-full px-2.5 py-1.5 border border-ash-200 rounded-lg text-[11px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white resize-none text-ash-800 placeholder:text-ash-400 mb-3 transition-all"
                                            rows={2}
                                        />

                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => setShowRecallPopover(false)} className="px-2.5 py-1.5 text-xs text-ash-500 hover:text-ash-700 font-semibold transition-colors">Annulla</button>
                                            <button onClick={() => handleSaveRecall()} disabled={isSavingRecall || !recallDate} className="px-3.5 py-1.5 text-xs bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg font-bold disabled:opacity-50 shadow-soft transition-all">
                                                {isSavingRecall ? "..." : "Parcheggia"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* In-Line Expanded Note (if present) appended to bottom of the flex column */}
            {lead.confRecallNotes && !lead.confirmationsOutcome && (
                <div className="w-full mt-2 lg:mt-1 pt-2 border-t border-dashed border-ash-200/60 pointer-events-none">
                    <div className="text-[12px] text-brand-orange-700 bg-gradient-to-r from-brand-orange-50/60 to-transparent py-1.5 px-2.5 rounded-lg italic w-full flex items-start gap-1.5">
                        <div className="font-bold text-brand-orange-800 shrink-0 mt-0.5">Nota:</div>
                        <div className="break-words whitespace-pre-wrap flex-1">{lead.confRecallNotes}</div>
                    </div>
                </div>
            )}

            {/* Ultima nota Conferme (preview compatta, 1 riga truncata) */}
            {item.lastConfermeNote && (
                <div className="w-full mt-1 pointer-events-none">
                    <div
                        className="text-[11px] text-blue-700 bg-blue-50/80 py-1 px-2 rounded-md flex items-center gap-1.5 border border-blue-100/80"
                        title={item.lastConfermeNote.text}
                    >
                        <span className="font-bold text-blue-800 shrink-0 uppercase tracking-wide text-[9px]">Conferme:</span>
                        <span className="truncate flex-1">{item.lastConfermeNote.text}</span>
                    </div>
                </div>
            )}

            {/* Ultima nota del bot (anteprima compatta). Viola per non confondersi
                con il blu della nota Conferme qui sopra. */}
            {item.lastBotNote && (
                <div className="w-full mt-1 pointer-events-none">
                    <div
                        className="text-[11px] text-violet-700 bg-violet-50/80 py-1 px-2 rounded-md flex items-center gap-1.5 border border-violet-100/80"
                        title={item.lastBotNote.text}
                    >
                        <span className="font-bold text-violet-800 shrink-0 uppercase tracking-wide text-[9px]">🤖 Fissatore:</span>
                        <span className="truncate flex-1">{item.lastBotNote.text}</span>
                        <span className="shrink-0 font-medium text-violet-500 tabular-nums">{format(new Date(item.lastBotNote.createdAt), "dd/MM HH:mm")}</span>
                        {item.lastBotNote.isNew && (
                            <span className="shrink-0 bg-amber-500 text-white font-bold uppercase tracking-wide text-[9px] px-1.5 py-0.5 rounded">Nuova</span>
                        )}
                    </div>
                </div>
            )}

        </div>
    )
}
