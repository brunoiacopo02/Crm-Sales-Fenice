"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/utils/supabase/client"
import { markAlertAsRead, getMyUnreadAlerts } from "@/app/actions/alertActions"
import { AlertOctagon, CheckCircle2 } from "lucide-react"

export function GlobalAlertListener({ currentUser }: { currentUser: any }) {
    const [alerts, setAlerts] = useState<any[]>([])
    const [visibleAlert, setVisibleAlert] = useState<any | null>(null)
    const [isMarking, setIsMarking] = useState(false)
    const supabase = createClient()

    useEffect(() => {
        if (!currentUser?.id) return

        // Initial fetch
        const loadInitialAlerts = async () => {
            const initial = await getMyUnreadAlerts()
            if (initial && initial.length > 0) {
                setAlerts(initial)
                setVisibleAlert(initial[initial.length - 1])
            }
        }
        loadInitialAlerts()

        const channel = supabase.channel('internal_alerts_changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'internalAlerts',
                filter: `receiverId=eq.${currentUser.id}`
            }, (payload) => {
                handleNewAlert(payload.new)
            })
            // We also need to listen for broadcast alerts where receiverId is null
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'internalAlerts',
                filter: `receiverId=is.null`
            }, (payload) => {
                handleNewAlert(payload.new)
            })
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [currentUser?.id, supabase])

    const handleNewAlert = async (newRecord: any) => {
        // Fetch full details (with sender name etc) because the DB payload only has the raw internalAlerts row
        // A simple way is to refetch all my unread alerts to get the joined data
        const updated = await getMyUnreadAlerts() // this will also include this new alert
        setAlerts(updated)
        // Set the visible alert to the newest one if none is showing, or add to queue
        if (updated.length > 0) {
            setVisibleAlert(updated[0]) // show highest priority or newest
        }
    }

    const handleAcknowledge = async () => {
        if (!visibleAlert) return
        setIsMarking(true)
        try {
            await markAlertAsRead(visibleAlert.id)
            const remaining = alerts.filter(a => a.id !== visibleAlert.id)
            setAlerts(remaining)
            setVisibleAlert(remaining.length > 0 ? remaining[0] : null)
        } catch (error) {
            console.error(error)
        } finally {
            setIsMarking(false)
        }
    }

    if (!visibleAlert) return null

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Blocking Backdrop */}
            <div className="absolute inset-0 bg-red-900/40 backdrop-blur-md" />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border-2 border-red-500 animate-in zoom-in-95 duration-200">
                <div className="bg-red-500 p-6 flex flex-col items-center justify-center text-white">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4">
                        <AlertOctagon className="w-10 h-10 text-white animate-pulse" />
                    </div>
                    <h2 className="text-2xl font-black uppercase tracking-widest text-center">Avviso dal Team</h2>
                    <p className="text-red-100 font-medium mt-1">
                        Da: {visibleAlert.senderName || visibleAlert.senderEmail || visibleAlert.senderId}
                    </p>
                </div>

                <div className="p-8 pb-10 flex flex-col items-center">
                    <p className="text-xl text-ash-800 font-medium text-center leading-relaxed">
                        {visibleAlert.message}
                    </p>

                    <button
                        onClick={handleAcknowledge}
                        disabled={isMarking}
                        className="mt-8 px-8 py-4 bg-ash-900 hover:bg-black text-white rounded-xl font-bold uppercase tracking-wider transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center gap-3 disabled:opacity-50"
                    >
                        <CheckCircle2 className="w-6 h-6" />
                        {isMarking ? "Registrazione in corso..." : "OK, Ho Letto. Chiudi."}
                    </button>
                    {alerts.length > 1 && (
                        <p className="mt-4 text-xs font-bold text-ash-400 uppercase">
                            Ci {alerts.length - 1 === 1 ? "è" : "sono"} altri {alerts.length - 1} {alerts.length - 1 === 1 ? "avviso in coda" : "avvisi in coda"}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
