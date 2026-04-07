"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect, useCallback } from "react"
import { getGdoPauseStatus, startPause, stopPause, PauseSummary } from "@/app/actions/pauseActions"
import { Play, Square, AlertTriangle } from "lucide-react"

export function PauseTimer() {
    const { user: authUser, isLoading: isAuthLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const authStatus = isAuthLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const [status, setStatus] = useState<PauseSummary | null>(null)
    const [localSeconds, setLocalSeconds] = useState(0)
    const [isLoading, setIsLoading] = useState(true)

    const fetchStatus = useCallback(async () => {
        if (!session?.user?.id) return
        try {
            const data = await getGdoPauseStatus(session.user.id)
            setStatus(data)
            if (data.currentPause) {
                // Sync local timer from DB startTime payload
                const start = new Date(data.currentPause.startTime).getTime()
                const now = new Date().getTime()
                setLocalSeconds(Math.floor((now - start) / 1000))
            } else {
                setLocalSeconds(0)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }, [session?.user?.id])

    // Inizializza al mount
    useEffect(() => {
        fetchStatus()

        // Polling per check remoto o multi-tab sync ogni minuto
        const intervalId = setInterval(fetchStatus, 60000)
        return () => clearInterval(intervalId)
    }, [fetchStatus])

    // Tick Counter Locale
    useEffect(() => {
        if (!status?.currentPause) return

        const timerId = setInterval(() => {
            setLocalSeconds(prev => prev + 1)
        }, 1000)

        // Se passiamo soglia 15m, spariamo un refetch x far fare al server la validazione "sforata"
        if (localSeconds === 15 * 60) {
            fetchStatus()
        }

        return () => clearInterval(timerId)
    }, [status?.currentPause, localSeconds, fetchStatus])

    const handleStart = async () => {
        if (!session?.user?.id) return
        setIsLoading(true)
        try {
            await startPause(session.user.id)
            await fetchStatus()
        } catch (err: any) {
            alert(err.message || "Errore all'avvio della pausa")
            setIsLoading(false)
        }
    }

    const handleStop = async () => {
        if (!status?.currentPause) return
        setIsLoading(true)
        try {
            await stopPause(status.currentPause.id)
            await fetchStatus()
        } catch (err: any) {
            alert(err.message || "Errore durante lo stop")
            setIsLoading(false)
        }
    }

    const formatTime = (totalSecs: number) => {
        const m = Math.floor(totalSecs / 60).toString().padStart(2, '0')
        const s = (totalSecs % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    if (!session?.user?.id || isLoading && !status) return <div className="animate-pulse h-8 w-24 bg-gray-200 rounded-md"></div>

    const isOngoing = !!status?.currentPause
    const isExceeded = localSeconds > (15 * 60)
    const canStart = !isOngoing && !!status

    return (
        <div className="flex items-center gap-3">
            {!isOngoing && (
                <div className="flex flex-col items-end mr-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Pause Oggi</span>
                    <span className="text-xs font-medium text-gray-700">{status?.usedPauses ?? 0}</span>
                </div>
            )}

            {isOngoing ? (
                <div className={`flex items-center gap-0 rounded-md border shadow-sm transition-colors ${isExceeded ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-brand-orange/30'}`}>

                    <div className="px-3 py-1.5 flex items-center gap-2 border-r border-inherit">
                        {isExceeded ? <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" /> : <Play className="h-4 w-4 text-brand-orange animate-pulse" fill="currentColor" />}
                        <span className={`text-sm font-mono font-bold w-[48px] ${isExceeded ? 'text-red-700' : 'text-brand-orange'}`}>
                            {formatTime(localSeconds)}
                        </span>
                    </div>

                    <button
                        onClick={handleStop}
                        disabled={isLoading}
                        className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors hover:bg-white/50 ${isExceeded ? 'text-red-700 hover:text-red-800' : 'text-brand-orange hover:text-orange-700'}`}
                    >
                        <Square className="h-3 w-3" fill="currentColor" />
                        Termina
                    </button>
                </div>
            ) : (
                <button
                    onClick={handleStart}
                    disabled={!canStart || isLoading}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all shadow-sm flex items-center gap-2 ${canStart ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-brand-orange/50 hover:text-brand-orange' : 'bg-gray-100 border border-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                    Inizia Pausa
                </button>
            )}
        </div>
    )
}
