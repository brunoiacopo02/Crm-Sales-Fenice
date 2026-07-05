"use client"

import { useState, useEffect, useMemo } from "react"

import { sendInternalAlert } from "@/app/actions/alertActions"
import { getConfermeHeartbeats, type ConfermeHeartbeat } from "@/app/actions/presenceActions"
import { Users, Send, AlertTriangle, MessageSquarePlus } from "lucide-react"
import { connectConfermePresence, subscribeConfermePresence, subscribeConfermeConnection } from "@/lib/confermePresence"

const HEARTBEAT_POLL_MS = 30_000

export function TeamRadarWidget({ currentUser }: { currentUser: any }) {
    const [activeUsers, setActiveUsers] = useState<any[]>([])
    const [heartbeats, setHeartbeats] = useState<ConfermeHeartbeat[]>([])
    const [connected, setConnected] = useState(false)
    const [selectedUser, setSelectedUser] = useState<any | null>(null)
    const [message, setMessage] = useState("")
    const [isSending, setIsSending] = useState(false)

    // Radar realtime sul presence SINGLETON condiviso (vedi
    // src/lib/confermePresence.ts) — niente secondo canale sullo stesso topic.
    useEffect(() => {
        const disconnect = connectConfermePresence({
            id: currentUser.id,
            name: currentUser.name,
            displayName: currentUser.displayName,
        })
        const offPresence = subscribeConfermePresence((entries) => {
            const map = new Map<string, any>()
            for (const p of entries) {
                if (!p.user || p.user.id === currentUser.id) continue
                // Se un utente ha più entry (es. due tab), preferisci quella col lead attivo
                const existing = map.get(p.user.id)
                if (!existing || (p.leadId && !existing.leadId)) map.set(p.user.id, p)
            }
            setActiveUsers(Array.from(map.values()))
        })
        // Evidenza stato canale: se il realtime muore, il pallino del Radar
        // diventa rosso invece di mostrare silenziosamente dati stantii.
        const offConnection = subscribeConfermeConnection(setConnected)
        return () => { offPresence(); offConnection(); disconnect() }
    }, [currentUser.id])

    // Task P1: heartbeat DB come fonte di verità di backup — copre i casi in
    // cui il Realtime non propaga (churn di subscribe, rete instabile). Poll
    // ogni 30s, il server filtra già i soli heartbeat freschi (< 90s).
    useEffect(() => {
        let cancelled = false
        const poll = () => {
            getConfermeHeartbeats()
                .then((rows) => {
                    if (!cancelled) setHeartbeats(rows.filter(r => r.userId !== currentUser.id))
                })
                .catch((e) => console.warn("[presence] getConfermeHeartbeats fallito:", e))
        }
        poll()
        const interval = setInterval(poll, HEARTBEAT_POLL_MS)
        return () => { cancelled = true; clearInterval(interval) }
    }, [currentUser.id])

    // Presente = visibile via Realtime OPPURE con heartbeat DB fresco.
    // activity/leadId dell'heartbeat fanno da fallback quando manca il dato realtime.
    const mergedUsers = useMemo(() => {
        const map = new Map<string, any>()
        for (const p of activeUsers) map.set(p.user.id, p)
        for (const h of heartbeats) {
            const existing = map.get(h.userId)
            if (existing) {
                if (!existing.leadId && h.leadId) existing.leadId = h.leadId
            } else {
                map.set(h.userId, { user: { id: h.userId, name: h.name, displayName: h.name }, leadId: h.leadId })
            }
        }
        return Array.from(map.values())
    }, [activeUsers, heartbeats])

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
                <div
                    className="bg-brand-blue-dark text-white px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0"
                    title={connected ? "Realtime connesso" : "Realtime DISCONNESSO — i colleghi potrebbero non essere aggiornati. Ricarica la pagina se persiste."}
                >
                    <Users className="w-3 h-3" />
                    <span className="font-bold text-[10px] uppercase tracking-wider">Radar</span>
                    <span className={`inline-flex h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
                    {mergedUsers.length === 0 ? (
                        <div className="text-[10px] text-ash-400 font-medium italic">
                            Nessun altro collega online.
                        </div>
                    ) : (
                        mergedUsers.map((p) => (
                            <div key={p.user.id} className="flex items-center gap-1.5 bg-ash-50 border border-ash-200 py-0.5 px-2 rounded-full shrink-0 group hover:border-orange-200 hover:bg-orange-50 transition-colors">
                                <div className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="font-bold text-ash-700 text-[10px] leading-none uppercase tracking-wide">
                                        {p.user.displayName || p.user.name}
                                    </span>
                                    {p.leadId && (
                                        <span className="text-[9px] text-ash-500 leading-none truncate max-w-[100px] border-l border-ash-300 pl-1">
                                            L-{p.leadId.substring(0, 4)}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setSelectedUser(p)}
                                    className="ml-0.5 text-orange-400 hover:text-orange-600 transition-colors p-0.5 rounded-full hover:bg-orange-100 opacity-0 group-hover:opacity-100"
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
                                onClick={() => { setSelectedUser(null); setMessage(""); }}
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
