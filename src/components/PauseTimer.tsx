"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect, useCallback } from "react"
import { getGdoPauseStatus, startPause, stopPause, PauseSummary } from "@/app/actions/pauseActions"
import { Play, Square, AlertTriangle, Clock } from "lucide-react"

export function PauseTimer() {
    const { user: authUser, isLoading: isAuthLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const [status, setStatus] = useState<PauseSummary | null>(null)
    const [localSeconds, setLocalSeconds] = useState(0)
    const [isLoading, setIsLoading] = useState(true)

    const fetchStatus = useCallback(async () => {
        if (!session?.user?.id) return
        try {
            const data = await getGdoPauseStatus(session.user.id)
            setStatus(data)
            if (data.currentPause) {
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

    useEffect(() => {
        fetchStatus()
        const intervalId = setInterval(fetchStatus, 60000)
        return () => clearInterval(intervalId)
    }, [fetchStatus])

    useEffect(() => {
        if (!status?.currentPause) return

        const timerId = setInterval(() => {
            setLocalSeconds(prev => prev + 1)
        }, 1000)

        return () => clearInterval(timerId)
    }, [status?.currentPause])

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
        const m = Math.floor(Math.abs(totalSecs) / 60).toString().padStart(2, '0')
        const s = (Math.abs(totalSecs) % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    if (!session?.user?.id || isLoading && !status) return <div className="animate-pulse h-8 w-24 bg-gray-200 rounded-md"></div>

    const isOngoing = !!status?.currentPause
    // Daily total including current pause
    const dailyTotalWithCurrent = (status?.totalSecondsToday || 0) + (isOngoing ? localSeconds - (status?.currentPause?.durationSeconds || 0) : 0)
    const dailyUsedDisplay = isOngoing
        ? (status?.totalSecondsToday || 0) - (status?.currentPause?.durationSeconds || 0) + localSeconds
        : (status?.totalSecondsToday || 0)
    const dailyExceeded = dailyUsedDisplay > 30 * 60
    const remainingDisplay = Math.max(0, 30 * 60 - dailyUsedDisplay)
    const canStart = !isOngoing && !!status

    return (
        <div className="flex items-center gap-3">
            {/* Daily budget indicator */}
            {!isOngoing && (
                <div className="flex flex-col items-end mr-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Budget</span>
                    <span className={`text-xs font-mono font-medium ${dailyExceeded ? 'text-red-600' : remainingDisplay < 5 * 60 ? 'text-amber-600' : 'text-gray-700'}`}>
                        {dailyExceeded ? `-${formatTime(dailyUsedDisplay - 30 * 60)}` : formatTime(remainingDisplay)}
                    </span>
                </div>
            )}

            {isOngoing ? (
                <div className={`flex items-center gap-0 rounded-md border shadow-sm transition-colors ${dailyExceeded ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-brand-orange/30'}`}>
                    <div className="px-2 py-1.5 flex items-center gap-1.5 border-r border-inherit">
                        {dailyExceeded ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 animate-pulse" />
                        ) : (
                            <Play className="h-3.5 w-3.5 text-brand-orange animate-pulse" fill="currentColor" />
                        )}
                        <span className={`text-sm font-mono font-bold w-[48px] ${dailyExceeded ? 'text-red-700' : 'text-brand-orange'}`}>
                            {formatTime(localSeconds)}
                        </span>
                    </div>

                    {/* Remaining daily budget while paused */}
                    <div className={`px-2 py-1.5 flex items-center gap-1 border-r border-inherit text-[10px] font-bold ${dailyExceeded ? 'text-red-600' : 'text-ash-500'}`}>
                        <Clock className="h-3 w-3" />
                        {dailyExceeded ? `-${formatTime(dailyUsedDisplay - 30 * 60)}` : formatTime(remainingDisplay)}
                    </div>

                    <button
                        onClick={handleStop}
                        disabled={isLoading}
                        className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors hover:bg-white/50 ${dailyExceeded ? 'text-red-700 hover:text-red-800' : 'text-brand-orange hover:text-orange-700'}`}
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
