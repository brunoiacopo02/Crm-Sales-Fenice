"use client"

import { useState, useEffect } from "react"
import { getGlobalPresence } from "@/app/actions/presenceActions"
import { sendInternalAlert } from "@/app/actions/alertActions"
import { Users, Send, AlertTriangle, MessageSquarePlus } from "lucide-react"

export function TeamRadarWidget({ currentUser }: { currentUser: any }) {
    const [activeUsers, setActiveUsers] = useState<any[]>([])
    const [selectedUser, setSelectedUser] = useState<any | null>(null)
    const [message, setMessage] = useState("")
    const [isSending, setIsSending] = useState(false)

    // Poll every 5 seconds for team radar
    useEffect(() => {
        const fetchPresence = async () => {
            const presences = await getGlobalPresence()
            // Distinct users
            const map = new Map()
            for (const p of presences) {
                // Keep the most recent presence info or all of them
                if (!map.has(p.user.id)) {
                    map.set(p.user.id, p)
                }
            }
            setActiveUsers(Array.from(map.values()))
        }

        fetchPresence()
        const int = setInterval(fetchPresence, 5000)
        return () => clearInterval(int)
    }, [])

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
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden mt-6">
            <div className="bg-slate-800 text-white p-3 flex items-center gap-2">
                <Users className="w-5 h-5" />
                <h3 className="font-bold uppercase tracking-wider text-sm">Team Radar</h3>
            </div>

            <div className="p-3 max-h-[300px] overflow-y-auto">
                {activeUsers.length === 0 ? (
                    <div className="text-sm text-slate-500 italic py-4 text-center">
                        Nessun altro collega attivo al momento.
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {activeUsers.map((p) => (
                            <li key={p.user.id} className="flex flex-col border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="font-bold text-slate-700 text-sm">
                                            {p.user.displayName || p.user.name}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setSelectedUser(p)}
                                        className="text-indigo-600 hover:text-indigo-800 transition-colors p-1"
                                        title="Invia Avviso P2P"
                                    >
                                        <MessageSquarePlus className="w-4 h-4" />
                                    </button>
                                </div>
                                {/* Context extracted from current presence logic in getGlobalPresence which could be joined with the full record */}
                                <div className="text-xs text-slate-500 mt-1 pl-4 flex items-center gap-1.5 break-all">
                                    <div className="w-1 h-1 rounded-full bg-slate-300" />
                                    Attivo (Lead: {p.leadId?.substring(0, 8)}...)
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* P2P Messaging Dialog */}
            {selectedUser && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
                        <h4 className="font-bold text-lg mb-2">Avviso a {selectedUser.user.displayName || selectedUser.user.name}</h4>
                        <p className="text-xs text-slate-500 mb-4 flex items-center gap-1">
                            Il messaggio bloccherà lo schermo del collega. Usare solo per urgenze.
                        </p>

                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Es: Fermati con Rossi Mario..."
                            className="w-full h-24 border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none mb-4"
                        />

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setSelectedUser(null); setMessage(""); }}
                                disabled={isSending}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium text-sm transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={isSending || !message.trim()}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
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
