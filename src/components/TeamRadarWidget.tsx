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
        <div className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-40 px-4 h-10 flex items-center justify-between">
            <div className="flex items-center gap-3 w-full">
                <div className="bg-brand-blue-dark text-white px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0">
                    <Users className="w-3 h-3" />
                    <span className="font-bold text-[10px] uppercase tracking-wider">Radar</span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
                    {activeUsers.length === 0 ? (
                        <div className="text-[10px] text-slate-400 font-medium italic">
                            Nessun altro collega online.
                        </div>
                    ) : (
                        activeUsers.map((p) => (
                            <div key={p.user.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 py-0.5 px-2 rounded-full shrink-0 group hover:border-indigo-200 hover:bg-indigo-50 transition-colors">
                                <div className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="font-bold text-slate-700 text-[10px] leading-none uppercase tracking-wide">
                                        {p.user.displayName || p.user.name}
                                    </span>
                                    {p.leadId && (
                                        <span className="text-[9px] text-slate-500 leading-none truncate max-w-[100px] border-l border-slate-300 pl-1">
                                            L-{p.leadId.substring(0, 4)}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setSelectedUser(p)}
                                    className="ml-0.5 text-indigo-400 hover:text-indigo-600 transition-colors p-0.5 rounded-full hover:bg-indigo-100 opacity-0 group-hover:opacity-100"
                                    title="Invia Avviso P2P"
                                >
                                    <MessageSquarePlus className="w-3 h-3" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
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
