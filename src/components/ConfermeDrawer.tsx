"use client"

import { useState, useEffect } from "react"
import { X, Save, Clock, User, Phone, Mail, FileText, CheckCircle, AlertTriangle, Users } from "lucide-react"
import { updateLeadDataConferme, getConfermeNotes, addConfermeNote, setConfermeOutcome, setSalespersonOutcome } from "@/app/actions/confermeActions"
import { setPresence, removePresence, getLeadPresence } from "@/app/actions/presenceActions"
import { getTeamAccounts } from "@/app/actions/teamActions"
import { format } from "date-fns"
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
    // Extract date and time for inputs
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

    // Salespeople state
    const [salespeopleList, setSalespeopleList] = useState<any[]>([])

    useEffect(() => {
        // Fetch real salespeople
        getTeamAccounts().then(users => {
            setSalespeopleList(users.filter((u: any) => u.role === "VENDITORE"))
        })
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
            }
            setEditNoteGdo(lead.appointmentNote || "")
            setOutcome(lead.confirmationsOutcome || "")
            setDiscardReason(lead.confirmationsDiscardReason || "")
            setSalesperson(lead.salespersonAssigned || "")
            setSpOutcome(lead.salespersonOutcome || "")
            setSpNotes(lead.salespersonOutcomeNotes || "")
            setActiveTab("dati")

            // Load notes
            setLoadingNotes(true)
            getConfermeNotes(lead.id).then(res => setNotes(res)).finally(() => setLoadingNotes(false))

            // Presence Heartbeat Loop (every 5 seconds)
            const sendHeartbeat = () => setPresence(lead.id, "viewing")
            sendHeartbeat() // initial
            const heartbeatInterval = setInterval(sendHeartbeat, 5000)

            // Presence Check Loop (every 4 seconds)
            const checkPresence = () => {
                getLeadPresence(lead.id).then(users => setActiveUsers(users))
            }
            checkPresence() // initial
            const checkInterval = setInterval(checkPresence, 4000)

            return () => {
                clearInterval(heartbeatInterval)
                clearInterval(checkInterval)
                removePresence(lead.id)
            }
        }
    }, [isOpen, lead.id])

    const handleSaveData = async () => {
        setSavingData(true)
        try {
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
            if (error instanceof Error && error.message.includes("CONCURRENCY_ERROR")) {
                alert("Questo appuntamento è stato aggiornato da un altro utente. Ricarica la pagina per vederne lo stato attuale ed evitare sovrascritture.")
            } else {
                alert(`Errore salvataggio: ${error instanceof Error ? error.message : String(error)}`)
            }
            console.error(error)
        } finally {
            setSavingData(false)
        }
    }

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        try {
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
                alert("ATTENZIONE: L'email del lead è obbligatoria per fissare un appuntamento e inviargli l'invito su Calendar.\nVai nella tab 'Dati Lead', inserisci la sua email, premi 'Salva Modifiche' e poi potrai confermare l'esito.");
                setActiveTab("dati");
                return;
            }
        }

        setSavingOutcome(true)
        try {
            const result = await setConfermeOutcome(lead.id, localVersion, outcome as "scartato" | "confermato", discardReason, salesperson)
            if (result && !result.success) {
                alert(`Errore salvataggio esito: ${result.error}`)
                return;
            }
            onRefresh()
            onClose()
            setTimeout(() => alert("Esito salvato con successo"), 300)
        } catch (error) {
            if (error instanceof Error && error.message.includes("CONCURRENCY_ERROR")) {
                alert("Questo appuntamento è stato aggiornato da un altro utente. Ricarica la pagina per vederne lo stato attuale ed evitare sovrascritture.")
            } else {
                alert(`Errore salvataggio esito: ${error instanceof Error ? error.message : String(error)}`)
            }
            console.error(error)
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
            setTimeout(() => alert("Esito venditore salvato"), 300)
        } catch (error) {
            if (error instanceof Error && error.message.includes("CONCURRENCY_ERROR")) {
                alert("Questo appuntamento è stato aggiornato da un altro utente. Ricarica la pagina per vederne lo stato attuale ed evitare sovrascritture.")
            } else {
                alert(`Errore salvataggio esito venditore: ${error instanceof Error ? error.message : String(error)}`)
            }
            console.error(error)
        } finally {
            setSavingSpOutcome(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity">
            <div className="w-[500px] h-full bg-white shadow-2xl flex flex-col transform transition-transform">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50/50">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-gray-900">{lead.name}</h2>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {lead.phone}</span>
                            {lead.confirmationsOutcome === "confermato" && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">CONFERMATO</span>
                            )}
                            {lead.confirmationsOutcome === "scartato" && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">SCARTATO</span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {activeUsers.length > 0 && (
                    <div className="bg-yellow-50 border-b border-yellow-200 p-3 px-6 flex items-center gap-3 text-sm text-yellow-800 animate-in fade-in slide-in-from-top-4">
                        <Users className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                        <span>
                            <strong>Attenzione:</strong> {activeUsers.map(u => u.user.displayName || u.user.name).join(", ")} {activeUsers.length === 1 ? "sta" : "stanno"} lavorando su questa pratica.
                        </span>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                    <button
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "dati" ? "border-brand-orange text-brand-orange" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                        onClick={() => setActiveTab("dati")}
                    >
                        Dati Lead
                    </button>
                    <button
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "note" ? "border-brand-orange text-brand-orange" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                        onClick={() => setActiveTab("note")}
                    >
                        Note Conferme ({notes.length})
                    </button>
                    <button
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "esito" ? "border-brand-orange text-brand-orange" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                        onClick={() => setActiveTab("esito")}
                    >
                        Gestione Esiti
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">

                    {activeTab === "dati" && (
                        <div className="space-y-4">
                            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 mb-6">
                                <p className="text-sm text-blue-800 font-medium flex items-center gap-2">
                                    <User className="w-4 h-4" /> Fissato da: {gdo?.displayName || gdo?.name || "Sconosciuto"}
                                </p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Nome</label>
                                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none" />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Email</label>
                                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Data Appuntamento</label>
                                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none text-sm" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Ora Appuntamento</label>
                                    <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none text-sm" />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Note GDO</label>
                                <textarea rows={4} value={editNoteGdo} onChange={e => setEditNoteGdo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none text-sm resize-none"></textarea>
                            </div>

                            <button onClick={handleSaveData} disabled={savingData} className="w-full mt-4 flex justify-center items-center gap-2 py-2.5 bg-gray-900 hover:bg-black text-white rounded-lg transition-colors font-medium">
                                <Save className="w-4 h-4" /> {savingData ? "Salvataggio..." : "Salva Modifiche"}
                            </button>
                            <p className="text-xs text-center text-gray-400 mt-2">Ogni modifica viene tracciata nell'Audit Log.</p>
                        </div>
                    )}

                    {activeTab === "note" && (
                        <div className="h-full flex flex-col">
                            <div className="flex-1 space-y-4 mb-6">
                                {loadingNotes ? (
                                    <div className="text-center text-gray-500 py-10">Caricamento note...</div>
                                ) : notes.length === 0 ? (
                                    <div className="text-center text-gray-400 py-10">Nessuna nota presente.</div>
                                ) : (
                                    notes.map((n, idx) => (
                                        <div key={n.note.id || idx} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="text-xs font-semibold text-gray-700">{n.author?.name || "Utente"}</span>
                                                <span className="text-xs text-gray-400">{format(new Date(n.note.createdAt), "dd/MM/yy HH:mm")}</span>
                                            </div>
                                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note.text}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className="mt-auto">
                                <textarea
                                    value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    placeholder="Scrivi una nuova nota..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-brand-orange outline-none text-sm resize-none"
                                    rows={3}
                                />
                                <button onClick={handleAddNote} disabled={!newNote.trim()} className="w-full mt-2 py-2 bg-brand-orange hover:bg-orange-600 text-white rounded-lg transition-colors font-medium cursor-pointer disabled:opacity-50">
                                    Aggiungi Nota
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === "esito" && (
                        <div className="space-y-8">
                            {/* Conferme Outcome */}
                            <div className="bg-white border-2 border-gray-100 rounded-xl p-5 shadow-sm">
                                <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-brand-orange" />
                                    Esito Pre-Trattativa (Team Conferme)
                                </h3>

                                <div className="space-y-3 mb-4">
                                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                        <input type="radio" name="outcome" value="scartato" checked={outcome === "scartato"} onChange={() => setOutcome("scartato")} className="w-4 h-4 text-brand-orange focus:ring-brand-orange" />
                                        <span className="font-medium text-gray-900">Scartato</span>
                                    </label>

                                    {outcome === "scartato" && (
                                        <div className="pl-8 -mt-2 mb-4 animate-in slide-in-from-top-2">
                                            <select value={discardReason} onChange={e => setDiscardReason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-brand-orange">
                                                <option value="">Seleziona motivo scarto...</option>
                                                <option value="non interessato">Non interessato</option>
                                                <option value="disoccupato">Disoccupato</option>
                                                <option value="straniero">Straniero</option>
                                                <option value="solo informazioni">Solo informazioni</option>
                                                <option value="non vuole prendere l'appuntamento">Non vuole prendere l'appuntamento</option>
                                            </select>
                                        </div>
                                    )}

                                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                        <input type="radio" name="outcome" value="confermato" checked={outcome === "confermato"} onChange={() => setOutcome("confermato")} className="w-4 h-4 text-brand-orange focus:ring-brand-orange" />
                                        <span className="font-medium text-gray-900">Confermato ed Assegnato</span>
                                    </label>

                                    {outcome === "confermato" && (
                                        <div className="pl-8 -mt-2 mb-4 animate-in slide-in-from-top-2">
                                            <select value={salesperson} onChange={e => setSalesperson(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-brand-orange">
                                                <option value="">Assegna Venditore...</option>
                                                {salespeopleList.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name || s.email}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>

                                <button onClick={handleSaveOutcome} disabled={savingOutcome || !outcome} className="w-full py-2.5 bg-brand-orange hover:bg-orange-600 text-white rounded-lg transition-colors font-medium disabled:opacity-50">
                                    {savingOutcome ? "Salvataggio..." : "Imposta Esito Conferme"}
                                </button>
                            </div>

                            {/* Salesperson Outcome (only if confirmed & assigned) */}
                            {lead.confirmationsOutcome === "confermato" && lead.salespersonAssigned && (
                                <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-5 border-dashed">
                                    <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                                        <User className="w-4 h-4 text-gray-600" />
                                        Esito Appuntamento ({lead.salespersonAssigned})
                                    </h3>

                                    <div className="space-y-4">
                                        <select value={spOutcome} onChange={e => setSpOutcome(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-gray-400 bg-white">
                                            <option value="">Seleziona esito finale...</option>
                                            <option value="Chiuso">✅ Chiuso</option>
                                            <option value="Non chiuso">❌ Non chiuso</option>
                                            <option value="Lead non presenziato">⏳ Lead non presenziato</option>
                                        </select>

                                        <textarea
                                            value={spNotes}
                                            onChange={e => setSpNotes(e.target.value)}
                                            placeholder="Note opzionali esito venditore..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-gray-400 bg-white resize-none"
                                            rows={2}
                                        />

                                        <button onClick={handleSaveSpOutcome} disabled={savingSpOutcome || !spOutcome} className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors font-medium disabled:opacity-50">
                                            {savingSpOutcome ? "Salvataggio..." : "Salva Esito Finale"}
                                        </button>
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
