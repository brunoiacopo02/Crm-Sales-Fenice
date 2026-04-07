"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/AuthProvider"
import { getGdoPauseHistory, type PauseHistoryEntry } from "@/app/actions/pauseActions"
import { Clock, AlertTriangle, CheckCircle, Loader2 } from "lucide-react"

function formatDuration(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins}m ${secs.toString().padStart(2, "0")}s`
}

function formatTime(isoString: string): string {
    return new Date(isoString).toLocaleTimeString("it-IT", {
        timeZone: "Europe/Rome",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function formatDate(dateLocal: string): string {
    const [year, month, day] = dateLocal.split("-")
    return `${day}/${month}/${year}`
}

export default function GdoPauseHistory() {
    const { user } = useAuth()
    const [history, setHistory] = useState<PauseHistoryEntry[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!user?.id) return
        getGdoPauseHistory(user.id)
            .then(setHistory)
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [user?.id])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
        )
    }

    // Monthly summary
    const totalPauses = history.length
    const totalDuration = history.reduce((sum, p) => sum + p.durationSeconds, 0)
    const exceededCount = history.filter(p => p.status === "sforata").length
    const totalExceeded = history.reduce((sum, p) => sum + p.exceededSeconds, 0)

    const currentMonth = new Date().toLocaleDateString("it-IT", {
        timeZone: "Europe/Rome",
        month: "long",
        year: "numeric",
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-brand-orange" />
                <div>
                    <h1 className="text-2xl font-bold text-white">Storico Pause</h1>
                    <div className="text-sm text-gray-400 capitalize">{currentMonth}</div>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                    <div className="text-sm text-gray-400">Pause Totali</div>
                    <div className="text-2xl font-bold text-white">{totalPauses}</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                    <div className="text-sm text-gray-400">Durata Totale</div>
                    <div className="text-2xl font-bold text-white">{formatDuration(totalDuration)}</div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                    <div className="text-sm text-gray-400">Sforate</div>
                    <div className={`text-2xl font-bold ${exceededCount > 0 ? "text-red-400" : "text-green-400"}`}>
                        {exceededCount}
                    </div>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                    <div className="text-sm text-gray-400">Tempo Ecceduto</div>
                    <div className={`text-2xl font-bold ${totalExceeded > 0 ? "text-red-400" : "text-green-400"}`}>
                        {totalExceeded > 0 ? formatDuration(totalExceeded) : "0m 00s"}
                    </div>
                </div>
            </div>

            {/* Table */}
            {history.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                    Nessuna pausa registrata questo mese.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-700">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-800 text-gray-300">
                                <th className="px-4 py-3 text-left font-medium">Data</th>
                                <th className="px-4 py-3 text-left font-medium">Ora Inizio</th>
                                <th className="px-4 py-3 text-left font-medium">Durata</th>
                                <th className="px-4 py-3 text-left font-medium">Stato</th>
                                <th className="px-4 py-3 text-left font-medium">Tempo Ecceduto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {history.map((p) => (
                                <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                                    <td className="px-4 py-3 text-white">{formatDate(p.dateLocal)}</td>
                                    <td className="px-4 py-3 text-gray-300">{formatTime(p.startTime)}</td>
                                    <td className="px-4 py-3 text-gray-300">{formatDuration(p.durationSeconds)}</td>
                                    <td className="px-4 py-3">
                                        {p.status === "conclusa" && (
                                            <div className="flex items-center gap-1.5 text-green-400">
                                                <CheckCircle className="h-4 w-4" />
                                                OK
                                            </div>
                                        )}
                                        {p.status === "sforata" && (
                                            <div className="flex items-center gap-1.5 text-red-400">
                                                <AlertTriangle className="h-4 w-4" />
                                                Sforata
                                            </div>
                                        )}
                                        {p.status === "in_corso" && (
                                            <div className="flex items-center gap-1.5 text-gold-400">
                                                <Clock className="h-4 w-4 animate-pulse" />
                                                In Corso
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        {p.exceededSeconds > 0 ? (
                                            <div className="text-red-400 font-medium">
                                                +{formatDuration(p.exceededSeconds)}
                                            </div>
                                        ) : (
                                            <div className="text-gray-500">—</div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
