"use client"

import { useState, useRef, useEffect } from "react"
import { Phone, Users, CheckCircle2, XCircle, Clock, Calendar, CheckSquare, MonitorPlay } from "lucide-react"
import { recordConfermeNoAnswer, setConfermeSnooze, scheduleConfermeRecall } from "@/app/actions/confermeActions"

export function ConfermeBoardRow({ item, currentUser, isLocked, onRefresh, onRowClick, layoutMode = 'default' }: any) {
    const lead = item.lead

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

    const handleQuickNR = async (e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            const res = await recordConfermeNoAnswer(lead.id, lead.version);
            if (res.success) {
                onRefresh();
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
                onRefresh();
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
            // Add UTC Offset manually if needed, but modern browsers pass correctly via Server Actions assuming standard timezone config.

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
                onRefresh();
            }
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsSavingRecall(false);
        }
    }

    return (
        <div
            ref={rowRef}
            onClick={onRowClick}
            className={`flex flex-col py-2 px-3 mb-2 text-[13px] border rounded-lg cursor-pointer transition-colors group relative ${isLocked ? 'bg-amber-50 border-amber-200' : (lead.confSnoozeAt && new Date(lead.confSnoozeAt).getTime() <= new Date().getTime() && !lead.confirmationsOutcome) ? 'bg-rose-50 border-rose-300 hover:bg-rose-100' : 'bg-white border-gray-200 hover:border-brand-blue-light hover:bg-slate-50 shadow-sm'}`}
        >
            {/* Top Row: Info & Actions */}
            <div className={`flex items-start md:items-center justify-between gap-y-3 gap-x-2 ${layoutMode === 'snooze' ? 'flex-col w-full' : 'flex-row flex-wrap'}`}>

                {/* Left side: Info */}
                <div className={`flex items-center gap-2 md:gap-4 flex-1 min-w-0 pointer-events-none flex-wrap ${layoutMode === 'snooze' ? 'w-full' : ''}`}>
                    <span className={`font-bold text-slate-800 leading-tight flex items-center gap-2 ${layoutMode === 'snooze' ? 'w-full text-sm' : 'truncate max-w-[150px] md:max-w-[200px]'}`}>
                        {lead.name}
                        {lead.confVslSeen && <span title="VSL Vista" className="flex items-center justify-center bg-blue-100 text-blue-600 rounded-full p-1"><MonitorPlay className="w-3.5 h-3.5" /></span>}
                    </span>
                    <span className={`text-slate-500 font-medium flex items-center gap-1.5 shrink-0 ${layoutMode === 'snooze' ? 'w-full text-xs' : 'whitespace-nowrap'}`}><Phone className="w-3.5 h-3.5 text-slate-400" />{lead.phone}</span>

                    {/* Hide GDO name in Snooze mode on small columns to save space */}
                    {layoutMode !== 'snooze' && (
                        <span className="text-brand-orange font-bold truncate max-w-[150px] shrink-0 hidden sm:inline-block">{item.gdo?.displayName || item.gdo?.name || "N/A"}</span>
                    )}

                    {/* Badge NR or Recall Date */}
                    {layoutMode === 'richiami' && lead.recallDate ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase border border-blue-200 shadow-sm ml-1 flex items-center shrink-0">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(lead.recallDate))}
                        </span>
                    ) : (
                        !lead.confirmationsOutcome && callsMade > 0 && layoutMode !== 'richiami' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase border border-amber-200 shadow-sm ml-1 flex items-center shrink-0">
                                {callsMade}° Chiamata a vuoto
                            </span>
                        )
                    )}

                    {/* Badge Snooze */}
                    {!lead.confirmationsOutcome && lead.confSnoozeAt && (() => {
                        const isOverdue = new Date(lead.confSnoozeAt).getTime() <= new Date().getTime();
                        return (
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold border shadow-sm ml-1 flex items-center gap-1 shrink-0 ${isOverdue ? 'bg-red-100 text-red-800 border-red-300 animate-pulse' : 'bg-purple-100 text-purple-800 border-purple-200'}`}>
                                <Clock className="w-3.5 h-3.5" />
                                {new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(lead.confSnoozeAt))}
                                {isOverdue && <span className="uppercase ml-0.5">Scaduto</span>}
                            </span>
                        );
                    })()}

                    {isLocked && (
                        <span className="flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase animate-pulse border border-amber-200 ml-1 shrink-0">
                            <Users className="w-3 h-3" /> In Lavorazione
                        </span>
                    )}
                </div>

                {/* Right side: Actions */}
                <div className={`flex items-center gap-2 shrink-0 relative ${layoutMode === 'snooze' ? 'w-full mt-2 pt-2 border-t border-gray-100 flex-wrap justify-start' : 'justify-end'}`}>
                    {lead.confirmationsOutcome === "confermato" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                        </span>
                    ) : lead.confirmationsOutcome === "scartato" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Scartato
                        </span>
                    ) : null}

                    {!lead.confirmationsOutcome && (
                        <>
                            {/* BOTTONE NR */}
                            <button
                                onClick={handleQuickNR}
                                disabled={callsMade >= 3 || isLocked}
                                className="bg-white hover:bg-rose-50 border border-gray-200 hover:border-rose-300 text-slate-500 hover:text-rose-600 px-2 py-1 rounded-md text-[11px] font-bold transition-colors z-10 disabled:opacity-50"
                            >
                                NR
                            </button>

                            {/* BOTTONE SNOOZE */}
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSnoozePopover(!showSnoozePopover); setShowRecallPopover(false); }}
                                    disabled={isLocked}
                                    className="bg-white hover:bg-purple-50 border border-gray-200 hover:border-purple-300 text-slate-500 hover:text-purple-600 px-2 py-1 rounded-md text-[11px] font-bold transition-colors z-10 disabled:opacity-50 flex items-center gap-1"
                                >
                                    <Clock className="w-3 h-3" /> Risentire Dopo
                                </button>

                                {/* SNOOZE POPOVER */}
                                {showSnoozePopover && !isLocked && (
                                    <div onClick={e => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 animate-in fade-in slide-in-from-top-2">
                                        <h4 className="text-[12px] font-bold text-gray-800 mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-purple-600" /> Orario di Richiamo (Oggi)</h4>
                                        <input
                                            type="time"
                                            value={snoozeTime}
                                            onChange={e => setSnoozeTime(e.target.value)}
                                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm mb-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                                        />

                                        <label className="flex items-center gap-2 mb-3 text-[11px] font-semibold text-gray-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={snoozeVslSeen}
                                                onChange={e => setSnoozeVslSeen(e.target.checked)}
                                                className="w-3.5 h-3.5 text-purple-600 rounded border-gray-300"
                                            />
                                            VSL Vista
                                        </label>

                                        <textarea
                                            value={snoozeNotes}
                                            onChange={e => setSnoozeNotes(e.target.value)}
                                            placeholder="Note snooze brevi..."
                                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-[11px] outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 bg-white resize-none shadow-sm text-purple-900 placeholder:text-gray-400 mb-2"
                                            rows={2}
                                        />

                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => setShowSnoozePopover(false)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-semibold">Annulla</button>
                                            <button onClick={handleSaveSnooze} disabled={isSavingSnooze} className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded font-bold disabled:opacity-50">
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
                                    className="bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md text-[11px] font-bold transition-colors z-10 disabled:opacity-50 flex items-center gap-1"
                                >
                                    <Calendar className="w-3 h-3" /> Programma Richiamo
                                </button>

                                {/* RECALL POPOVER */}
                                {showRecallPopover && !isLocked && (
                                    <div onClick={e => e.stopPropagation()} className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 animate-in fade-in slide-in-from-top-2">
                                        <h4 className="text-[12px] font-bold text-gray-800 mb-3 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-blue-600" /> Parcheggia Lead</h4>

                                        <div className="flex gap-2 mb-3">
                                            <input
                                                type="date"
                                                value={recallDate}
                                                onChange={e => setRecallDate(e.target.value)}
                                                className="w-3/5 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-blue-500"
                                            />
                                            <input
                                                type="time"
                                                value={recallTime}
                                                onChange={e => setRecallTime(e.target.value)}
                                                className="w-2/5 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-blue-500"
                                            />
                                        </div>

                                        <label className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={vslSeen}
                                                onChange={e => setVslSeen(e.target.checked)}
                                                className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300"
                                            />
                                            VSL Vista
                                        </label>

                                        <textarea
                                            value={recallNotes}
                                            onChange={e => setRecallNotes(e.target.value)}
                                            placeholder="Note di parcheggio opzionali..."
                                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-[11px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white resize-none shadow-sm text-blue-900 placeholder:text-gray-400 mb-3"
                                            rows={2}
                                        />

                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => setShowRecallPopover(false)} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-semibold">Annulla</button>
                                            <button onClick={handleSaveRecall} disabled={isSavingRecall || !recallDate} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-bold disabled:opacity-50">
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
                <div className="w-full mt-2 lg:mt-1 pt-2 border-t border-dashed border-gray-200 pointer-events-none">
                    <p className="text-[12px] text-amber-700 bg-gradient-to-r from-amber-50 to-transparent py-1 px-2 rounded-md italic w-full flex items-start gap-1.5">
                        <span className="font-bold text-amber-800 shrink-0 mt-0.5">Nota:</span>
                        <span className="break-words whitespace-pre-wrap flex-1">{lead.confRecallNotes}</span>
                    </p>
                </div>
            )}

        </div>
    )
}
