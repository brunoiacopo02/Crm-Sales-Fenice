"use client"

import { useState, useEffect } from "react"
import { X, Save, Clock, User, Phone, Mail, FileText, CheckCircle, AlertTriangle, Users } from "lucide-react"
import { getConfermeNotes, setSalespersonOutcome, recordConfermeNoAnswer, scheduleConfermeRecall, setConfermeSnooze } from "@/app/actions/confermeActions"
import { getTeamAccounts } from "@/app/actions/teamActions"
import { createClient } from "@/utils/supabase/client"
import { format, formatDistanceToNow } from "date-fns"
import { it } from "date-fns/locale"

export function ConfermeDrawer({ isOpen, onClose, item, currentUser, onRefresh }: any) {
    if (!isOpen || !item) return null;

    const lead = item.lead;
    const gdo = item.gdo;

    const [activeTab, setActiveTab] = useState("dati")
    const [localVersion, setLocalVersion] = useState(lead.version)

    // Form states
    const [editName, setEditName] = useState(lead.name || "")
    const [editEmail, setEditEmail] = useState(lead.email || "")
    const appointmentDateObj = lead.appointmentDate ? new Date(lead.appointmentDate) : new Date();
    const [editDate, setEditDate] = useState(format(appointmentDateObj, 'yyyy-MM-dd'))
    const [editTime, setEditTime] = useState(format(appointmentDateObj, 'HH:mm'))
    const [editNoteGdo, setEditNoteGdo] = useState(lead.appointmentNote || "")
    const [savingData, setSavingData] = useState(false)

    // Notes states
    const [notes, setNotes] = useState<any[]>([])
    const [newNote, setNewNote] = useState("")
    const [loadingNotes, setLoadingNotes] = useState(false)

    // Outcome states
    const [outcome, setOutcome] = useState(lead.confirmationsOutcome || "")
    const [discardReason, setDiscardReason] = useState(lead.confirmationsDiscardReason || "")
    const [salesperson, setSalesperson] = useState(lead.salespersonAssigned || "")
    const [savingOutcome, setSavingOutcome] = useState(false)

    // Salesperson outcome states
    const [spOutcome, setSpOutcome] = useState(lead.salespersonOutcome || "")
    const [spNotes, setSpNotes] = useState(lead.salespersonOutcomeNotes || "")
    const [savingSpOutcome, setSavingSpOutcome] = useState(false)

    // Presence states
    const [activeUsers, setActiveUsers] = useState<any[]>([])
    const [salespeopleList, setSalespeopleList] = useState<any[]>([])

    // Quick Action States
    const [isSavingNR, setIsSavingNR] = useState(false)

    const [now, setNow] = useState(new Date())

    useEffect(() => {
        getTeamAccounts().then(users => {
            setSalespeopleList(users.filter((u: any) => u.role === "VENDITORE"))
        })
        const t = setInterval(() => setNow(new Date()), 60000);
        return () => clearInterval(t);
    }, [])

    useEffect(() => {
        if (isOpen) {
            setLocalVersion(lead.version)
            setEditName(lead.name || "")
            setEditEmail(lead.email || "")
            if (lead.appointmentDate) {
                const d = new Date(lead.appointmentDate)
                setEditDate(format(d, 'yyyy-MM-dd'))
                setEditTime(format(d, 'HH:mm'))
            } else {
                setEditDate("")
                setEditTime("")
            }
            setEditNoteGdo(lead.appointmentNote || "")
            setOutcome(lead.confirmationsOutcome || "")
            setDiscardReason(lead.confirmationsDiscardReason || "")
            setSalesperson(lead.salespersonAssigned || "")
            setSpOutcome(lead.salespersonOutcome || "")
            setSpNotes(lead.salespersonOutcomeNotes || "")
            setActiveTab("dati")

            setLoadingNotes(true)
            getConfermeNotes(lead.id).then(res => setNotes(res)).finally(() => setLoadingNotes(false))

            const supabase = createClient();
            const channel = supabase.channel('conferme_realtime_board');

            // 1. Invia il nostro stato di presenza "In Lavorazione" a tutti
            channel.on('presence', { event: 'sync' }, () => {
                const newState = channel.presenceState();
                const usersPresent: any[] = [];
                for (const id in newState) {
                    const presenceArray = newState[id];
                    presenceArray.forEach((p: any) => {
                        // Se c'è un utente ed è diverso da noi, ed è sullo stesso lead, è un "Lock"
                        if (p.user && p.user.id !== currentUser.id && p.leadId === lead.id) {
                            usersPresent.push(p);
                        }
                    });
                }
                setActiveUsers(usersPresent);
            });

            // 2. Notifica a tutti che stiamo guardando questo lead
            channel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        online_at: new Date().toISOString(),
                        leadId: lead.id,
                        user: {
                            id: currentUser.id,
                            name: currentUser.name,
                            displayName: currentUser.displayName
                        }
                    });
                }
            });

            return () => {
                supabase.removeChannel(channel);
            }
        }
    }, [isOpen, lead.id, lead.version]) // update when version changes too

    const handleSaveData = async () => {
        setSavingData(true)
        try {
            const { updateLeadDataConferme } = await import('@/app/actions/confermeActions');
            const combinedDate = new Date(`${editDate}T${editTime}:00`);
            await updateLeadDataConferme(lead.id, localVersion, {
                name: editName,
                email: editEmail,
                appointmentDate: combinedDate,
                appointmentNote: editNoteGdo
            })
            setLocalVersion((v: number) => v + 1)
            onRefresh()
            alert("Dati salvati con successo")
        } catch (error) {
            alert(`Errore salvataggio: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
            setSavingData(false)
        }
    }

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        try {
            const { addConfermeNote } = await import('@/app/actions/confermeActions');
            const note = await addConfermeNote(lead.id, newNote)
            setNotes([{ note, author: currentUser }, ...notes])
            setNewNote("")
        } catch (error) {
            alert("Errore inserimento nota")
        }
    }

    const handleSaveOutcome = async () => {
        if (outcome === "scartato" && !discardReason) return alert("Inserisci motivo scarto");
        if (outcome === "confermato") {
            if (!salesperson) return alert("Seleziona venditore assegnato");
            if (!editEmail) {
                alert("ATTENZIONE: L'email del lead è obbligatoria per fissare un appuntamento e inviargli l'invito su Calendar.");
                setActiveTab("dati");
                return;
            }
        }

        setSavingOutcome(true)
        try {
            const { setConfermeOutcome } = await import('@/app/actions/confermeActions');
            const result = await setConfermeOutcome(lead.id, localVersion, outcome as "scartato" | "confermato", discardReason, salesperson)
            if (result && !result.success) {
                alert(`Errore salvataggio esito: ${result.error}`)
                return;
            }
            onRefresh()
            onClose()
        } catch (error) {
            alert(`Errore salvataggio esito: ${error}`)
        } finally {
            setSavingOutcome(false)
        }
    }

    const handleSaveSpOutcome = async () => {
        if (!spOutcome) return alert("Seleziona esito venditore");
        setSavingSpOutcome(true)
        try {
            const result = await setSalespersonOutcome(lead.id, localVersion, spOutcome as "Chiuso" | "Non chiuso" | "Lead non presenziato", spNotes)
            if (result && !result.success) {
                alert(`Errore salvataggio esito venditore: ${result.error}`);
                return;
            }
            onRefresh()
            onClose()
        } catch (error) {
            alert(`Errore salvataggio esito venditore: ${error}`)
        } finally {
            setSavingSpOutcome(false)
        }
    }

    const handleQuickNR = async () => {
        setIsSavingNR(true);
        try {
            const res = await recordConfermeNoAnswer(lead.id, localVersion);
            if (res.success) {
                setLocalVersion((v: number) => v + 1);
                onRefresh();
            } else {
                alert(res.error);
            }
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsSavingNR(false);
        }
    }

    const getLastNRDate = () => {
        if (lead.confCall3At) return new Date(lead.confCall3At);
        if (lead.confCall2At) return new Date(lead.confCall2At);
        if (lead.confCall1At) return new Date(lead.confCall1At);
        return null;
    }
    const lastNR = getLastNRDate();

    const isLocked = activeUsers.length > 0;

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-in fade-in transition-opacity">
            <div className="w-[500px] h-full bg-white shadow-2xl flex flex-col transform transition-transform border-l border-gray-200 animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50 shrink-0">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            {lead.confNeedsReschedule ? (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300">DA DEFINIRE</span>
                            ) : null}
                            {lead.confirmationsOutcome === "confermato" && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">CONFERMATO</span>
                            )}
                            {lead.confirmationsOutcome === "scartato" && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">SCARTATO</span>
                            )}
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-gray-900 leading-tight">{lead.name}</h2>
                        <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500 font-medium">
                            <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-brand-orange" /> {lead.phone}</span>
                            {lead.email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-brand-blue" /> {lead.email}</span>}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-200 rounded-full transition-colors self-start">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Quick Actions Bar */}
                <fieldset disabled={isLocked} className="contents border-0 p-0 m-0">
                    <div className="bg-white border-b border-gray-200 p-4 shrink-0 flex flex-col gap-3 z-10 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02)]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleQuickNR}
                                    disabled={isSavingNR || !!lead.confCall3At || !!lead.confirmationsOutcome}
                                    className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {isSavingNR ? "..." : "NR (Non Risponde)"}
                                    <div className="flex gap-1 ml-1" title="Tentativi NR">
                                        <div className={`w-2 h-2 rounded-full ${lead.confCall1At ? 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]' : 'bg-gray-500'}`} />
                                        <div className={`w-2 h-2 rounded-full ${lead.confCall2At ? 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]' : 'bg-gray-500'}`} />
                                        <div className={`w-2 h-2 rounded-full ${lead.confCall3At ? 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]' : 'bg-gray-500'}`} />
                                    </div>
                                </button>

                                {lastNR && !lead.confirmationsOutcome && (
                                    <span className="text-xs text-gray-600 flex items-center gap-1 font-semibold bg-gray-100 px-3 py-1.5 rounded-full border border-gray-200">
                                        <Clock className="w-3.5 h-3.5 text-brand-orange" />
                                        {formatDistanceToNow(lastNR, { locale: it })} fa
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </fieldset>

                {isLocked && (
                    <div className="bg-rose-50 border-b border-rose-200 p-4 flex items-center gap-3 text-sm text-rose-800 animate-in fade-in shrink-0 shadow-inner">
                        <Users className="w-5 h-5 text-rose-600 flex-shrink-0" />
                        <div>
                            <strong className="block mb-0.5 uppercase tracking-wider text-xs">Modalità Sola Lettura (Hard-Lock Attivo)</strong>
                            <span>{activeUsers.map(u => u.user.displayName || u.user.name).join(", ")} {activeUsers.length === 1 ? "sta" : "stanno"} lavorando su questa pratica al momento. Non puoi effettuare modifiche per evitare conflitti.</span>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-gray-200 shrink-0 bg-white">
                    <button
                        className={`flex-1 py-3.5 text-sm font-bold border-b-2 transition-colors ${activeTab === "dati" ? "border-brand-orange text-brand-orange bg-orange-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}
                        onClick={() => setActiveTab("dati")}
                    >
                        Dati Lead
                    </button>
                    <button
                        className={`flex-1 py-3.5 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === "note" ? "border-brand-orange text-brand-orange bg-orange-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}
                        onClick={() => setActiveTab("note")}
                    >
                        Note {notes.length > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === "note" ? "bg-brand-orange text-white" : "bg-gray-200 text-gray-600"}`}>{notes.length}</span>}
                    </button>
                    <button
                        className={`flex-1 py-3.5 text-sm font-bold border-b-2 transition-colors ${activeTab === "esito" ? "border-brand-orange text-brand-orange bg-orange-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}
                        onClick={() => setActiveTab("esito")}
                    >
                        Gestione Esiti
                    </button>
                </div>

                {/* Content */}
                <fieldset disabled={isLocked} className="contents border-0 p-0 m-0">
                    <div className={`flex-1 overflow-y-auto p-6 bg-slate-50/30 custom-scrollbar ${isLocked ? "opacity-60 grayscale-[30%]" : ""}`}>

                        {activeTab === "dati" && (
                            <div className="space-y-5 animate-in fade-in duration-200">
                                <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-100 flex items-center gap-3 shadow-sm">
                                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                                        <User className="w-4 h-4 text-blue-700" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-blue-600/80 font-bold uppercase tracking-wider mb-0.5">Fissato da</p>
                                        <p className="text-sm text-blue-900 font-bold">{gdo?.displayName || gdo?.name || "Sconosciuto"}</p>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Nome Completo</label>
                                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none shadow-sm transition-shadow font-medium text-slate-900 bg-white" />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Indirizzo Email</label>
                                    <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none shadow-sm transition-shadow font-medium text-slate-900 bg-white" placeholder="Nessuna email fornita" />
                                </div>

                                {/* Data e Ora Appuntamento (sempre visibili, anche per i Richiami) */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                            {lead.confNeedsReschedule ? "Data App. (Originaria)" : "Data Appuntamento"}
                                        </label>
                                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none text-sm shadow-sm font-medium bg-white" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                            {lead.confNeedsReschedule ? "Ora App. (Originaria)" : "Ora Appuntamento"}
                                        </label>
                                        <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none text-sm shadow-sm font-medium bg-white" />
                                    </div>
                                </div>
                                {lead.confNeedsReschedule && (
                                    <p className="text-[11px] text-blue-600 font-medium ml-1 leading-tight">
                                        Questo lead è un Richiamo. Puoi comunque modificare la data e l'ora originaria dell'appuntamento fissato dal GDO se necessario.
                                    </p>
                                )}

                                <div className="space-y-1.5 pt-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Note del Fissatore (GDO)</label>
                                    <textarea rows={4} value={editNoteGdo} onChange={e => setEditNoteGdo(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none text-sm resize-none shadow-sm text-slate-700 bg-white leading-relaxed" placeholder="Aggiungi una nota..."></textarea>
                                </div>

                                <div className="pt-4 border-t border-slate-200">
                                    <button onClick={handleSaveData} disabled={savingData} className="w-full flex justify-center items-center gap-2 py-3 bg-slate-900 hover:bg-black text-white rounded-xl transition-all font-bold shadow-md hover:shadow-lg disabled:opacity-50">
                                        <Save className="w-4 h-4" /> {savingData ? "Salvataggio in corso..." : "Salva Tutti i Dati"}
                                    </button>
                                    <p className="text-[11px] text-center text-slate-400 mt-3 font-medium">Le modifiche sono tracciate nell'Audit Log.</p>
                                </div>
                            </div>
                        )}

                        {activeTab === "note" && (
                            <div className="h-full flex flex-col animate-in fade-in duration-200">
                                <div className="flex-1 space-y-4 mb-6">
                                    {loadingNotes ? (
                                        <div className="text-center text-gray-500 py-10">Caricamento note...</div>
                                    ) : notes.length === 0 ? (
                                        <div className="text-center text-gray-400 py-16 flex flex-col items-center">
                                            <FileText className="w-12 h-12 text-gray-200 mb-3" />
                                            Nessuna nota presente per questo lead.
                                        </div>
                                    ) : (
                                        notes.map((n, idx) => (
                                            <div key={n.note.id || idx} className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm transition-shadow hover:shadow-md">
                                                <div className="flex justify-between items-start mb-3">
                                                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded-md">{n.author?.name || "Utente"}</span>
                                                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{format(new Date(n.note.createdAt), "dd/MM/yy HH:mm")}</span>
                                                </div>
                                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{n.note.text}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="mt-auto pt-4 border-t border-gray-200 bg-slate-50/50 -bottom-6 -mx-6 px-6 pb-6 pt-4 sticky">
                                    <textarea
                                        value={newNote}
                                        onChange={e => setNewNote(e.target.value)}
                                        placeholder="Scrivi una nuova nota qui..."
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-orange focus:border-transparent outline-none text-sm resize-none shadow-sm mb-3"
                                        rows={3}
                                    />
                                    <button onClick={handleAddNote} disabled={!newNote.trim()} className="w-full py-3 bg-brand-orange hover:bg-orange-600 text-white rounded-xl transition-all font-bold cursor-pointer disabled:opacity-50 shadow-md">
                                        Aggiungi Nota e Salva
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === "esito" && (
                            <div className="space-y-6 animate-in fade-in duration-200 pb-8">
                                {/* Conferme Outcome */}
                                <div className="bg-white border text-slate-800 border-gray-200 rounded-2xl p-6 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-brand-orange"></div>
                                    <h3 className="text-base font-extrabold text-gray-900 mb-5 flex items-center gap-2">
                                        Esito Pre-Trattativa (Team Conferme)
                                    </h3>

                                    <div className="space-y-3.5 mb-6">
                                        <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${outcome === "scartato" ? "border-rose-400 bg-rose-50 shadow-sm" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 bg-white"}`}>
                                            <input type="radio" name="outcome" value="scartato" checked={outcome === "scartato"} onChange={() => setOutcome("scartato")} className="w-4 h-4 text-brand-orange focus:ring-brand-orange" />
                                            <span className={`font-bold ${outcome === "scartato" ? "text-rose-800" : "text-gray-700"}`}>Scartato Direttamente</span>
                                        </label>

                                        {outcome === "scartato" && (
                                            <div className="pl-11 -mt-2 mb-5 animate-in slide-in-from-top-2">
                                                <select value={discardReason} onChange={e => setDiscardReason(e.target.value)} className="w-full px-4 py-2.5 border-2 border-rose-200 rounded-lg text-sm outline-none focus:border-rose-400 bg-white text-rose-900 font-medium">
                                                    <option value="">-- Seleziona il motivo esatto --</option>
                                                    <option value="non interessato">Non interessato</option>
                                                    <option value="disoccupato">Disoccupato</option>
                                                    <option value="straniero">Straniero</option>
                                                    <option value="solo informazioni">Solo informazioni</option>
                                                    <option value="non vuole prendere l'appuntamento">Non vuole prendere l'appuntamento</option>
                                                </select>
                                            </div>
                                        )}

                                        <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${outcome === "confermato" ? "border-emerald-400 bg-emerald-50 shadow-sm" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 bg-white"}`}>
                                            <input type="radio" name="outcome" value="confermato" checked={outcome === "confermato"} onChange={() => setOutcome("confermato")} className="w-4 h-4 text-brand-orange focus:ring-brand-orange" />
                                            <span className={`font-bold ${outcome === "confermato" ? "text-emerald-800" : "text-gray-700"}`}>Confermato ed Assegnato</span>
                                        </label>

                                        {outcome === "confermato" && (
                                            <div className="pl-11 -mt-2 mb-2 animate-in slide-in-from-top-2">
                                                <select value={salesperson} onChange={e => setSalesperson(e.target.value)} className="w-full px-4 py-2.5 border-2 border-emerald-200 rounded-lg text-sm outline-none focus:border-emerald-400 bg-white text-emerald-900 font-bold shadow-sm">
                                                    <option value="">-- Assegna a un Venditore --</option>
                                                    {salespeopleList.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name || s.email}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[11px] text-emerald-600 font-medium mt-2 leading-tight">Salvando, confermerai l'appuntamento, il lead verrà smistato al venditore e verrà creato l'evento sul Google Calendar con invito via email.</p>
                                            </div>
                                        )}
                                    </div>

                                    <button onClick={handleSaveOutcome} disabled={savingOutcome || !outcome} className="w-full py-3 bg-brand-orange hover:bg-orange-600 text-white rounded-xl transition-all font-bold disabled:opacity-50 shadow-md">
                                        {savingOutcome ? "Salvataggio in corso..." : "Piazza Esito Definitivo"}
                                    </button>
                                </div>

                                {/* Salesperson Outcome (only if confirmed & assigned) */}
                                {lead.confirmationsOutcome === "confermato" && lead.salespersonAssigned && (
                                    <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-6 border-dashed animate-in fade-in">
                                        <h3 className="text-sm font-bold text-slate-800 mb-5 flex items-center gap-2">
                                            <User className="w-4 h-4 text-slate-500" />
                                            Esito Post Appuntamento ({lead.salespersonAssigned})
                                        </h3>

                                        <div className="space-y-4">
                                            <select value={spOutcome} onChange={e => setSpOutcome(e.target.value)} className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl font-bold text-slate-700 outline-none focus:border-slate-500 bg-white shadow-sm transition-colors">
                                                <option value="">Seleziona esito finale...</option>
                                                <option value="Chiuso">✅ Vendita Chiusa</option>
                                                <option value="Non chiuso">❌ Non Chiuso</option>
                                                <option value="Lead non presenziato">⏳ Lead non presenziato</option>
                                            </select>

                                            <textarea
                                                value={spNotes}
                                                onChange={e => setSpNotes(e.target.value)}
                                                placeholder="Note opzionali per l'esito finale..."
                                                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-400 bg-white resize-none shadow-sm font-medium text-slate-700"
                                                rows={2}
                                            />

                                            <button onClick={handleSaveSpOutcome} disabled={savingSpOutcome || !spOutcome} className="w-full mt-2 py-3 bg-slate-800 hover:bg-black text-white rounded-xl transition-colors font-bold disabled:opacity-50 shadow-md">
                                                {savingSpOutcome ? "Salvataggio..." : "Registra Esito Finale"}
                                            </button>
                                        </div>
                                    </div>
                                )}

                            </div>
                        )}
                    </div>
                </fieldset>
            </div>
        </div>
    )
}
