"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Trophy, Medal, User, Calendar, Award } from "lucide-react"
import { getLeaderboard } from "@/app/actions/leaderboardActions"

type LeaderboardItem = {
    userId: string
    gdoCode: number | null
    displayName: string
    avatarUrl: string | null
    appointmentCount: number
    rank: number
    equippedSkinCss?: string | null
}

type LeaderboardPeriod = 'today' | 'week' | 'month'

export function LeaderboardClient({
    initialData,
    initialPeriod,
    loggedUserId
}: {
    initialData: LeaderboardItem[],
    initialPeriod: LeaderboardPeriod,
    loggedUserId?: string
}) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [currentData, setCurrentData] = useState<LeaderboardItem[]>(initialData)
    const [isPending, setIsPending] = useState(false)
    const currentPeriod = (searchParams.get('period') as LeaderboardPeriod) || initialPeriod

    useEffect(() => {
        setCurrentData(initialData)
        setIsPending(false)
    }, [initialData])

    // Background Polling (10s) per Real-Time Leaderboard Update
    useEffect(() => {
        let mounted = true
        const pollLeaderboard = async () => {
            try {
                const data = await getLeaderboard(currentPeriod)
                if (mounted) setCurrentData(data)
            } catch (err) {
                // Silently fails to not break UX
            }
        }
        const intervalId = setInterval(pollLeaderboard, 10000)
        return () => {
            mounted = false
            clearInterval(intervalId)
        }
    }, [currentPeriod])

    const handlePeriodChange = (period: LeaderboardPeriod) => {
        setIsPending(true)
        router.push(`/classifica?period=${period}`)
    }

    const periods = [
        { id: 'today', label: 'Oggi' },
        { id: 'week', label: 'Settimana' },
        { id: 'month', label: 'Mese' },
    ]

    // Find the logged-in user to show their specific message
    const loggedUserIndex = currentData.findIndex(u => u.userId === loggedUserId)
    const loggedUserItem = loggedUserIndex !== -1 ? currentData[loggedUserIndex] : null
    let gapMessage = ""

    if (loggedUserItem && loggedUserIndex > 0) {
        // Someone is above them
        const userAbove = currentData[loggedUserIndex - 1]
        const gap = userAbove.appointmentCount - loggedUserItem.appointmentCount

        if (gap === 0) {
            gapMessage = `Sei a pari merito con ${userAbove.displayName}. Ottieni un altro appuntamento per superarlo!`
        } else {
            gapMessage = `Ti mancano ${gap} appuntament${gap === 1 ? 'o' : 'i'} per superare ${userAbove.displayName}.`
        }
    } else if (loggedUserItem && loggedUserIndex === 0 && currentData.length > 1) {
        const userBelow = currentData[1]
        const gap = loggedUserItem.appointmentCount - userBelow.appointmentCount
        gapMessage = `Sei al 1° posto! Hai ${gap} appuntament${gap === 1 ? 'o' : 'i'} di vantaggio su ${userBelow.displayName}.`
    } else if (loggedUserItem && loggedUserIndex === 0) {
        gapMessage = "Sei solo in classifica! Ottimo lavoro."
    }

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white p-2 rounded-xl border border-gray-100 shadow-sm flex gap-2 max-w-fit pointer-events-auto">
                {periods.map(p => (
                    <button
                        key={p.id}
                        onClick={() => handlePeriodChange(p.id as LeaderboardPeriod)}
                        disabled={isPending}
                        className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${currentPeriod === p.id
                            ? 'bg-brand-charcoal text-white shadow-md scale-100'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 scale-95 hover:scale-100'
                            }`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            {/* Gamification Banner for Logged User */}
            {loggedUserItem && (
                <div className={`p-4 rounded-xl border ${loggedUserIndex === 0 ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200/50' : 'bg-white border-brand-orange/20'} shadow-sm flex items-center justify-between`}>
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-full ${loggedUserIndex === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-brand-orange/10 text-brand-orange'}`}>
                            {loggedUserIndex === 0 ? <Award className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}
                        </div>
                        <div>
                            <p className="font-semibold text-gray-800">
                                {loggedUserIndex === 0 ? 'Leader attuale!' : 'Continua così!'}
                            </p>
                            <p className="text-sm text-gray-600 mt-0.5">
                                {gapMessage || "Aggiungi appuntamenti per scalare la classifica."}
                            </p>
                        </div>
                    </div>

                    {/* Visual Progress relative to the person above (only if not #1) */}
                    {loggedUserItem && loggedUserIndex > 0 && (
                        <div className="hidden md:flex flex-col items-end gap-2">
                            <div className="text-xs font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                                Target: {currentData[loggedUserIndex - 1].appointmentCount} appt
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* The List */}
            <div className={`bg-white rounded-2xl shadow-xl shadow-brand-charcoal/5 border border-gray-100 overflow-hidden transition-opacity duration-300 ${isPending ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                {currentData.length === 0 ? (
                    <div className="p-16 text-center text-gray-400">
                        <Trophy className="h-12 w-12 mx-auto opacity-20 mb-4" />
                        <p>Nessun appuntamento in questo periodo.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {currentData.map((user, index) => {
                            const isMe = user.userId === loggedUserId

                            // Medals for top 3
                            let rankIcon = null
                            if (index === 0) rankIcon = <Medal className="h-6 w-6 text-yellow-500 drop-shadow-sm" />
                            else if (index === 1) rankIcon = <Medal className="h-6 w-6 text-gray-400 drop-shadow-sm" />
                            else if (index === 2) rankIcon = <Medal className="h-6 w-6 text-amber-600 drop-shadow-sm" />
                            else rankIcon = <span className="text-lg font-bold text-gray-300 w-6 text-center">#{user.rank}</span>

                            return (
                                <li
                                    key={user.userId}
                                    className={`relative transition-all duration-300 hover:bg-gray-50 ${isMe ? 'bg-orange-50/30' : ''}`}
                                >
                                    {isMe && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-orange shadow-[0_0_10px_rgba(255,107,0,0.5)] z-10" />
                                    )}

                                    <div className="px-6 py-5 flex items-center justify-between">
                                        <div className="flex items-center gap-5">
                                            {/* Rank */}
                                            <div className="w-10 flex justify-center items-center">
                                                {rankIcon}
                                            </div>

                                            {/* Avatar */}
                                            <div className="relative">
                                                <div className={`h-12 w-12 rounded-full flex items-center justify-center font-bold text-lg shadow-sm ${user.equippedSkinCss ? user.equippedSkinCss : isMe ? 'bg-brand-orange text-white' : 'bg-gray-100 text-gray-600 border border-gray-200'
                                                    }`}>
                                                    {user.displayName?.charAt(0) || 'U'}
                                                </div>
                                                {/* Mini rank badge on avatar if #1 */}
                                                {index === 0 && (
                                                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                                                        <div className="bg-yellow-500 h-4 w-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white">
                                                            1
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* INFO */}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className={`font-semibold text-lg ${isMe ? 'text-brand-orange' : 'text-gray-800'}`}>
                                                        {user.displayName}
                                                    </p>
                                                    {isMe && (
                                                        <span className="bg-brand-orange/10 text-brand-orange text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                            TU
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-gray-500 text-sm flex items-center gap-1.5 mt-0.5">
                                                    <User className="h-3.5 w-3.5" /> GDO {user.gdoCode || 'N/A'}
                                                </p>
                                            </div>
                                        </div>

                                        {/* SCORE */}
                                        <div className="flex items-center gap-6">
                                            <div className="text-right">
                                                <div className="text-3xl font-bold tracking-tighter text-gray-800 flex items-center justify-end gap-1">
                                                    {user.appointmentCount}
                                                </div>
                                                <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mt-1">
                                                    Appuntamenti
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* The mini progress bar line at the bottom of each item relative to the top score */}
                                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-50">
                                        <div
                                            className={`h-full ${index === 0 ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]' : isMe ? 'bg-brand-orange/50' : 'bg-gray-200'}`}
                                            style={{
                                                width: `${currentData[0].appointmentCount > 0 ? Math.max(5, (user.appointmentCount / currentData[0].appointmentCount) * 100) : 0}%`,
                                                transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)'
                                            }}
                                        />
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </div>
    )
}
