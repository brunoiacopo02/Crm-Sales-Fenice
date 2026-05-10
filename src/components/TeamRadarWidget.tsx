"use client"

import { useState } from "react"

import { sendInternalAlert } from "@/app/actions/alertActions"
import { Users, Send, MessageSquarePlus, Phone, FileText, Eye } from "lucide-react"
import { useConfermePresence, activityLabel, type ConfermePresenceEntry } from "@/lib/confermePresence"

function ActivityIcon({ state }: { state?: string }) {
    if (state === "calling") return <Phone className="w-3 h-3 text-rose-500" />
    if (state === "writing_note") return <FileText className="w-3 h-3 text-amber-500" />
    if (state === "viewing") return <Eye className="w-3 h-3 text-sky-500" />
    return null
}

export function TeamRadarWidget({ currentUser }: { currentUser: any }) {
    const { presence } = useConfermePresence(currentUser)
    const [selectedUser, setSelectedUser] = useState<ConfermePresenceEntry | null>(null)
    const [message, setMessage] = useState("")
    const [isSending, setIsSending] = useState(false)

    const colleagues = presence.filter((p) => p.user.id !== currentUser.id)

    const handleSend = async () => {
        if (!selectedUser || !message.trim()) return
        setIsSending(true)
        try {
            await sendInternalAlert(selectedUser.user.id, message.trim())
            setSelectedUser(null)
            setMessage("")
        } catch (e) {
            console.error(e)
            alert("Errore nell'invio del messaggio.")
        } finally {
            setIsSending(false)
        }
    }

    if (!currentUser) return null

    return (
        <div className="bg-white border-b border-ash-200 shadow-sm sticky top-0 z-40 px-4 h-10 flex items-center justify-between">
            <div className="flex items-center gap-3 w-full">
                <div className="bg-brand-blue-dark text-white px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0">
                    <Users className="w-3 h-3" />
                    <span className="font-bold text-[10px] uppercase tracking-wider">Radar</span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
                    {colleagues.length === 0 ? (
                        <div className="text-[10px] text-ash-400 font-medium italic">
                            Nessun altro collega online.
                        </div>
                    ) : (
                        colleagues.map((p) => {
                            const a = p.activity ?? { state: "idle" as const }
                            const label = activityLabel(a)
                            const leadName = "leadName" in a ? a.leadName : null
                            const isActive = a.state === "calling" || a.state === "writing_note" || a.state === "viewing"
                            return (
                                <div
                                    key={p.user.id}
                                    className={`flex items-center gap-1.5 border py-0.5 px-2 rounded-full shrink-0 group transition-colors ${isActive
                                        ? "bg-orange-50 border-orange-200"
                                        : "bg-ash-50 border-ash-200 hover:border-orange-200 hover:bg-orange-50"
                                        }`}
                                    title={leadName ? `${label} · ${leadName}` : label}
                                >
                                    <div className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                    </div>
                                    <span className="font-bold text-ash-700 text-[10px] leading-none uppercase tracking-wide">
                                        {p.user.displayName || p.user.name}
                                    </span>
                                    <ActivityIcon state={a.state} />
                                    <span className="text-[10px] text-ash-500 leading-none italic">
                                        {label}
                                    </span>
                                    {leadName && (
                                        <span className="text-[10px] text-ash-700 font-semibold leading-none truncate max-w-[140px] border-l border-ash-300 pl-1.5">
                                            {leadName}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setSelectedUser(p)}
                                        className="ml-0.5 text-orange-400 hover:text-orange-600 transition-colors p-0.5 rounded-full hover:bg-orange-100 opacity-0 group-hover:opacity-100"
                                        title="Invia Avviso P2P"
                                    >
                                        <MessageSquarePlus className="w-3 h-3" />
                                    </button>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {/* P2P Messaging Dialog */}
            {selectedUser && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ash-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
                        <h4 className="font-bold text-lg mb-2">Avviso a {selectedUser.user.displayName || selectedUser.user.name}</h4>
                        <p className="text-xs text-ash-500 mb-4 flex items-center gap-1">
                            Il messaggio bloccherà lo schermo del collega. Usare solo per urgenze.
                        </p>

                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Es: Fermati con Rossi Mario..."
                            className="w-full h-24 border border-ash-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none resize-none mb-4"
                        />

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setSelectedUser(null); setMessage("") }}
                                disabled={isSending}
                                className="px-4 py-2 text-ash-600 hover:bg-ash-100 rounded-lg font-medium text-sm transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={isSending || !message.trim()}
                                className="px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                <Send className="w-4 h-4" />
                                {isSending ? "Invio..." : "Invia Avviso"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
