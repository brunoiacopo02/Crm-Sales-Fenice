"use client"

import { useState, useRef, useEffect } from "react"
import { Phone, Users, CheckCircle2, XCircle, Clock, Calendar, CheckSquare, MonitorPlay, EyeOff, Undo2, RotateCcw } from "lucide-react"
import { recordConfermeNoAnswer, undoConfermeNoAnswer, setConfermeSnooze, scheduleConfermeRecall, cancelConfermeRecall } from "@/app/actions/confermeActions"
import { getAnimationsEnabled } from "@/lib/animationUtils"

export function ConfermeBoardRow({ item, currentUser, isLocked, onRefresh, onRowClick, layoutMode = 'default' }: any) {
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

    let callsMade = 0;
    if (lead.confCall1At) callsMade = 1;
    if (lead.confCall2At) callsMade = 2;
    if (lead.confCall3At) callsMade = 3;

    /** Apply micro-animation to the row card, then call callback after delay */
    const animateAndRefresh = async (anim: string, durationMs: number) => {
        if (getAnimationsEnabled() && rowRef.current) {
            rowRef.current.style.animation = `${anim} ${durationMs}ms ease-out`
            await new Promise(r => setTimeout(r, durationMs + 50))
            if (rowRef.current) rowRef.current.style.animation = ''
        }
        onRefresh()
    }

    const handleQuickNR = async (e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            const res = await recordConfermeNoAnswer(lead.id, lead.version);
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                alert(res.error);
            }
        } catch (e: any) {
            alert(e.message);
        }
    }

    const handleUndoNR = async (e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            const res = await undoConfermeNoAnswer(lead.id, lead.version);
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                alert(res.error);
            }
        } catch (e: any) {
            alert(e.message);
        }
    }

    const handleSaveSnooze = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!snoozeTime) return alert("Seleziona un orario");
        setIsSavingSnooze(true);
        try {
            const [hours, minutes] = snoozeTime.split(":");
            const d = new Date();
            d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

            const res = await setConfermeSnooze(lead.id, lead.version, d, {
                vslSeen: snoozeVslSeen,
                snoozeNotes: snoozeNotes
            });
            if (res.success) {
                setShowSnoozePopover(false);
                setSnoozeNotes(""); // Resetting
                setSnoozeVslSeen(false);
                await animateAndRefresh('pa-amber-pulse', 800);
            } else {
                alert(res.error);
            }
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsSavingSnooze(false);
        }
    }

    const handleSaveRecall = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!recallDate) return alert("Seleziona una data per il richiamo");
        setIsSavingRecall(true);
        try {
            const rDate = new Date(`${recallDate}T${recallTime || '00:00'}:00`);

            const res = await scheduleConfermeRecall(lead.id, lead.version, {
                recallDate: rDate,
                vslSeen,
                needsReschedule: true, // Always park
                newAppointmentDate: null,
                recallNotes
            });

            if (res && (!res.success)) {
                alert(res.error || "Errore");
            } else {
                setShowRecallPopover(false);
                setRecallNotes(""); // Resetting
                await animateAndRefresh('pa-amber-pulse', 800);
            }
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsSavingRecall(false);
        }
    }

    const [isCancellingRecall, setIsCancellingRecall] = useState(false)

    const handleCancelSnooze = async (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsCancellingRecall(true)
        try {
            const res = await cancelConfermeRecall(lead.id, lead.version, "snooze")
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                alert(res.error)
            }
        } catch (e: any) {
            alert(e.message)
        } finally {
            setIsCancellingRecall(false)
        }
    }

    const handleCancelParkRecall = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm("Annullare il richiamo programmato? Il lead tornerà nella board con la data del richiamo come appuntamento.")) return
        setIsCancellingRecall(true)
        try {
            const res = await cancelConfermeRecall(lead.id, lead.version, "park")
            if (res.success) {
                await animateAndRefresh('pa-bounce', 200)
            } else {
                alert(res.error)
            }
        } catch (e: any) {
            alert(e.message)
        } finally {
            setIsCancellingRecall(false)
        }
    }

    // Determine card accent based on state
    const isSnoozeOverdue = clientNow > 0 && lead.confSnoozeAt && new Date(lead.confSnoozeAt).getTime() <= clientNow && !lead.confirmationsOutcome;
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
                    <div className={`text-ash-500 font-medium flex items-center gap-1.5 shrink-0 ${layoutMode === 'snooze' ? 'w-full text-xs' : 'whitespace-nowrap'}`}><Phone className="w-3.5 h-3.5 text-ash-400" />{lead.phone}</div>

                    {/* GDO name + Funnel (hidden in Snooze mode to save space) */}
                    {layoutMode !== 'snooze' && (
                        <div className="flex items-center gap-1.5 shrink-0 hidden sm:inline-flex">
                            <div className="text-brand-orange-600 font-bold truncate max-w-[150px]">{item.gdo?.displayName || item.gdo?.name || "N/A"}</div>
                            {lead.funnel && <div className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ash-100 text-ash-600 uppercase truncate max-w-[100px]">{lead.funnel}</div>}
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
                        <div className="flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase animate-pulse border border-amber-200 ml-1 shrink-0">
                            <Users className="w-3 h-3" /> In Lavorazione
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
                                disabled={isLocked}
                                className={`border px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card ${callsMade >= 3 ? 'bg-ember-50 hover:bg-ember-100 border-ember-300 text-ember-600 hover:text-ember-700' : 'bg-white hover:bg-ember-50 border-ash-200 hover:border-ember-300 text-ash-500 hover:text-ember-600'}`}
                            >
                                {callsMade >= 3 ? '4° NR (Scarta)' : 'NR'}
                            </button>

                            {/* BOTTONE ANNULLA NR */}
                            {callsMade > 0 && (
                                <button
                                    onClick={handleUndoNR}
                                    disabled={isLocked}
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
                                    <div onClick={e => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-64 bg-white border border-ash-200/60 rounded-xl shadow-elevated z-50 p-4 animate-fade-in">
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
                                            <button onClick={handleSaveRecall} disabled={isSavingRecall || !recallDate} className="px-3.5 py-1.5 text-xs bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg font-bold disabled:opacity-50 shadow-soft transition-all">
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

        </div>
    )
}
