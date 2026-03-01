"use client"

import { useState, useEffect } from "react"
import { Play, Square, Timer, History } from "lucide-react"
import { startSprint, stopSprintForce, getActiveSprint } from "@/app/actions/sprintActions"

export function ManagerSprintCard({ managerId }: { managerId: string }) {
    const [duration, setDuration] = useState(60)
    const [activeSprint, setActiveSprint] = useState<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [timeLeft, setTimeLeft] = useState<string>("")

    // Poll active sprint
    useEffect(() => {
        const fetchState = async () => {
            try {
                const sprint = await getActiveSprint()
                setActiveSprint(sprint)
            } catch (e) {
                console.error(e)
            } finally {
                setIsLoading(false)
            }
        }
        fetchState()
        const int = setInterval(fetchState, 10000)
        return () => clearInterval(int)
    }, [])

    // Countdown timer effect
    useEffect(() => {
        if (!activeSprint) return

        const updateTimer = () => {
            const now = new Date().getTime()
            const end = new Date(activeSprint.endTime).getTime()
            const distance = end - now

            if (distance < 0) {
                setTimeLeft("00:00:00")
            } else {
                const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
                const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
                const s = Math.floor((distance % (1000 * 60)) / 1000)
                setTimeLeft(
                    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                )
            }
        }

        updateTimer()
        const int = setInterval(updateTimer, 1000)
        return () => clearInterval(int)
    }, [activeSprint])

    const handleStart = async () => {
        setIsLoading(true)
        try {
            await startSprint(duration, managerId)
            const sprint = await getActiveSprint()
            setActiveSprint(sprint)
        } catch (e: any) {
            alert(e.message)
        }
        setIsLoading(false)
    }

    const handleStop = async () => {
        if (!confirm("Sei sicuro di voler interrompere lo Sprint in anticipo?")) return
        setIsLoading(true)
        try {
            await stopSprintForce(activeSprint.id)
            setActiveSprint(null)
            alert("Sprint terminato con successo. Le monete sono state assegnate ai vincitori.")
        } catch (e: any) {
            alert(e.message)
        }
        setIsLoading(false)
    }

    if (isLoading && !activeSprint) {
        return <div className="h-32 bg-white rounded-xl shadow border border-gray-100 animate-pulse" />
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-brand-orange/20 overflow-hidden mt-6">
            <div className="bg-orange-50/50 border-b border-orange-100/50 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-orange/10 text-brand-orange rounded-lg">
                        <Timer className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-800">Focus Sprint</h2>
                        <p className="text-xs text-gray-500">Avvia una sessione intensiva. Il vincitore riceverà 1 Fenice Coin.</p>
                    </div>
                </div>
                {activeSprint && (
                    <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1.5 rounded-full text-sm font-bold animate-pulse">
                        <div className="h-2 w-2 rounded-full bg-red-500" />
                        IN CORSO
                    </div>
                )}
            </div>

            <div className="p-6">
                {!activeSprint ? (
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Durata Sprint (minuti)</label>
                            <input
                                type="number"
                                value={duration}
                                onChange={e => setDuration(Number(e.target.value))}
                                min="5"
                                max="240"
                                disabled={isLoading}
                                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-orange focus:border-brand-orange sm:text-sm px-4 py-2"
                            />
                        </div>
                        <button
                            onClick={handleStart}
                            disabled={isLoading}
                            className="w-full sm:w-auto mt-6 sm:mt-5 bg-brand-orange hover:bg-orange-600 text-white font-medium py-2 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <Play className="h-4 w-4 fill-current" />
                            Avvia Sprint
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div className="text-center sm:text-left mb-4 sm:mb-0">
                            <p className="text-xs font-bold tracking-wider text-gray-500 uppercase mb-1">Tempo Rimasto</p>
                            <p className="text-4xl font-mono font-bold text-gray-800 tracking-tighter tabular-nums">
                                {timeLeft}
                            </p>
                        </div>
                        <button
                            onClick={handleStop}
                            disabled={isLoading}
                            className="bg-red-100 hover:bg-red-200 text-red-700 font-semibold py-2.5 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <Square className="h-4 w-4 fill-current" />
                            Termina Ora
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
