"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Trophy, Medal, User, Crown, Flame, Phone, Zap, ArrowUp, ArrowDown, Star, Sparkles } from "lucide-react"
import { getMultiMetricLeaderboard } from "@/app/actions/leaderboardActions"
import type { LeaderboardPeriod, LeaderboardMetric } from "@/app/actions/leaderboardActions"

type LeaderboardItem = {
    userId: string
    gdoCode: number | null
    displayName: string
    avatarUrl: string | null
    appointmentCount: number
    metricValue?: number
    metricLabel?: string
    rank: number
    equippedSkinCss?: string | null
    activeTitle?: string | null
    firstApptTime?: number
}

type PlayerOfWeek = {
    userId: string
    displayName: string
    gdoCode: number | null
    avatarUrl: string | null
    appointmentCount: number
    equippedSkinCss?: string | null
    activeTitle?: string | null
} | null

const METRIC_TABS: { id: LeaderboardMetric; label: string; icon: typeof Trophy; unit: string }[] = [
    { id: 'appointments', label: 'Appuntamenti', icon: Trophy, unit: 'Appuntamenti' },
    { id: 'calls', label: 'Chiamate', icon: Phone, unit: 'Chiamate' },
    { id: 'xp', label: 'XP', icon: Zap, unit: 'XP' },
    { id: 'streak', label: 'Streak', icon: Flame, unit: 'Giorni' },
]

export function LeaderboardClient({
    initialData,
    initialPeriod,
    loggedUserId,
    playerOfWeek,
}: {
    initialData: LeaderboardItem[],
    initialPeriod: LeaderboardPeriod,
    loggedUserId?: string,
    playerOfWeek?: PlayerOfWeek,
}) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [currentData, setCurrentData] = useState<LeaderboardItem[]>(initialData)
    const [isPending, setIsPending] = useState(false)
    const [currentMetric, setCurrentMetric] = useState<LeaderboardMetric>('appointments')
    const previousRanksRef = useRef<Map<string, number>>(new Map())
    const [rankChanges, setRankChanges] = useState<Map<string, number>>(new Map())
    const currentPeriod = (searchParams.get('period') as LeaderboardPeriod) || initialPeriod

    useEffect(() => {
        setCurrentData(initialData)
        setIsPending(false)
    }, [initialData])

    // Track rank changes
    useEffect(() => {
        const newChanges = new Map<string, number>()
        for (const item of currentData) {
            const prevRank = previousRanksRef.current.get(item.userId)
            if (prevRank !== undefined && prevRank !== item.rank) {
                newChanges.set(item.userId, prevRank - item.rank) // positive = moved up
            }
        }
        if (newChanges.size > 0) {
            setRankChanges(newChanges)
            // Clear rank changes after animation
            const timer = setTimeout(() => setRankChanges(new Map()), 3000)
            return () => clearTimeout(timer)
        }
        // Update previous ranks for next comparison
        const newPrevRanks = new Map<string, number>()
        for (const item of currentData) {
            newPrevRanks.set(item.userId, item.rank)
        }
        previousRanksRef.current = newPrevRanks
    }, [currentData])

    // Background Polling (10s) per Real-Time Leaderboard Update
    useEffect(() => {
        let mounted = true
        const pollLeaderboard = async () => {
            try {
                const data = await getMultiMetricLeaderboard(currentPeriod, currentMetric)
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
    }, [currentPeriod, currentMetric])

    const handlePeriodChange = (period: LeaderboardPeriod) => {
        setIsPending(true)
        router.push(`/classifica?period=${period}`)
    }

    const handleMetricChange = async (metric: LeaderboardMetric) => {
        setIsPending(true)
        setCurrentMetric(metric)
        try {
            const data = await getMultiMetricLeaderboard(currentPeriod, metric)
            setCurrentData(data)
        } catch (err) {
            // ignore
        }
        setIsPending(false)
    }

    const periods = [
        { id: 'today', label: 'Oggi' },
        { id: 'week', label: 'Settimana' },
        { id: 'month', label: 'Mese' },
    ]

    const activeMetricTab = METRIC_TABS.find(t => t.id === currentMetric)!
    const getScore = (item: LeaderboardItem) => item.metricValue ?? item.appointmentCount
    const getUnit = () => activeMetricTab.unit

    // Find the logged-in user to show their specific message
    const loggedUserIndex = currentData.findIndex(u => u.userId === loggedUserId)
    const loggedUserItem = loggedUserIndex !== -1 ? currentData[loggedUserIndex] : null
    let gapMessage = ""

    if (loggedUserItem && loggedUserIndex > 0) {
        const userAbove = currentData[loggedUserIndex - 1]
        const gap = getScore(userAbove) - getScore(loggedUserItem)

        if (gap === 0) {
            gapMessage = `Sei a pari merito con ${userAbove.displayName}. Fai un altro passo per superarlo!`
        } else {
            gapMessage = `Ti ${gap === 1 ? 'manca' : 'mancano'} ${gap} ${getUnit().toLowerCase()} per superare ${userAbove.displayName}.`
        }
    } else if (loggedUserItem && loggedUserIndex === 0 && currentData.length > 1) {
        const userBelow = currentData[1]
        const gap = getScore(loggedUserItem) - getScore(userBelow)
        gapMessage = `Sei al 1° posto! Hai ${gap} ${getUnit().toLowerCase()} di vantaggio su ${userBelow.displayName}.`
    } else if (loggedUserItem && loggedUserIndex === 0) {
        gapMessage = "Sei solo in classifica! Ottimo lavoro."
    }

    // Top 3 for podium
    const top3 = currentData.slice(0, 3)
    const rest = currentData.slice(3)

    const getRankChangeIndicator = (userId: string) => {
        const change = rankChanges.get(userId)
        if (!change) return null
        if (change > 0) {
            return (
                <div className="flex items-center gap-0.5 text-emerald-500 text-xs font-bold animate-slide-up">
                    <ArrowUp className="h-3 w-3" />
                    <span>{change}</span>
                </div>
            )
        }
        return (
            <div className="flex items-center gap-0.5 text-red-500 text-xs font-bold animate-slide-up">
                <ArrowDown className="h-3 w-3" />
                <span>{Math.abs(change)}</span>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Player of the Week Banner */}
            {playerOfWeek && currentPeriod === 'week' && playerOfWeek.appointmentCount > 0 && (
                <div className="relative overflow-hidden rounded-2xl border border-gold-200/60 bg-gradient-to-r from-gold-50 via-brand-orange-50/50 to-gold-50 p-5 shadow-glow-gold animate-fade-in">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-gold-200/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-gold-200 to-gold-400 flex items-center justify-center font-bold text-xl text-white border-2 border-gold-300 shadow-glow-gold">
                                {playerOfWeek.displayName?.charAt(0) || 'U'}
                            </div>
                            <div className="absolute -top-2 -right-1">
                                <Star className="h-5 w-5 text-gold-500 fill-gold-400 drop-shadow-md" />
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-gold-500" />
                                <span className="text-xs font-bold uppercase tracking-widest text-gold-600">Player of the Week</span>
                            </div>
                            <div className="text-lg font-bold text-ash-800 mt-0.5">
                                {playerOfWeek.displayName}
                                {playerOfWeek.activeTitle && (
                                    <span className="ml-2 text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 align-middle">
                                        {playerOfWeek.activeTitle}
                                    </span>
                                )}
                            </div>
                            <div className="text-sm text-ash-500">
                                {playerOfWeek.appointmentCount} appuntamenti questa settimana
                            </div>
                        </div>
                        <div className="hidden sm:flex items-center">
                            <Crown className="h-10 w-10 text-gold-400 drop-shadow-md" />
                        </div>
                    </div>
                </div>
            )}

            {/* Metric Tabs */}
            <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-xl border border-ash-200/60 shadow-soft flex flex-wrap gap-1.5">
                {METRIC_TABS.map(tab => {
                    const Icon = tab.icon
                    return (
                        <button
                            key={tab.id}
                            onClick={() => handleMetricChange(tab.id)}
                            disabled={isPending}
                            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${currentMetric === tab.id
                                ? 'bg-gradient-to-r from-brand-charcoal to-ash-800 text-white shadow-card'
                                : 'text-ash-500 hover:bg-ash-50 hover:text-ash-800'
                                }`}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    )
                })}
            </div>

            {/* Period Filters */}
            <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-xl border border-ash-200/60 shadow-soft flex gap-1.5 max-w-fit">
                {periods.map(p => (
                    <button
                        key={p.id}
                        onClick={() => handlePeriodChange(p.id as LeaderboardPeriod)}
                        disabled={isPending}
                        className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${currentPeriod === p.id
                            ? 'bg-gradient-to-r from-brand-charcoal to-ash-800 text-white shadow-card'
                            : 'text-ash-500 hover:bg-ash-50 hover:text-ash-800'
                            }`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            {/* Gamification Banner for Logged User */}
            {loggedUserItem && (
                <div className={`p-4 rounded-2xl border animate-fade-in ${loggedUserIndex === 0
                    ? 'bg-gradient-to-r from-gold-50 via-brand-orange-50 to-gold-50 border-gold-200/60 shadow-glow-gold'
                    : 'bg-gradient-to-r from-brand-orange-50 to-ash-50 border-brand-orange-200/40 shadow-soft'
                    } flex items-center justify-between`}>
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${loggedUserIndex === 0
                            ? 'bg-gradient-to-br from-gold-100 to-gold-200 text-gold-600 shadow-glow-gold'
                            : 'bg-brand-orange-100 text-brand-orange-600'
                            }`}>
                            {loggedUserIndex === 0 ? <Crown className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}
                        </div>
                        <div>
                            <div className="font-bold text-ash-800">
                                {loggedUserIndex === 0 ? 'Leader attuale!' : 'Continua così!'}
                            </div>
                            <div className="text-sm text-ash-600 mt-0.5">
                                {gapMessage || `Aggiungi ${getUnit().toLowerCase()} per scalare la classifica.`}
                            </div>
                        </div>
                    </div>

                    {loggedUserItem && loggedUserIndex > 0 && (
                        <div className="hidden md:flex flex-col items-end gap-2">
                            <div className="text-xs font-bold text-ash-500 bg-ash-100 px-3 py-1.5 rounded-full border border-ash-200">
                                Target: {getScore(currentData[loggedUserIndex - 1])} {getUnit().toLowerCase()}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Podium Top 3 */}
            {top3.length > 0 && getScore(currentData[0]) > 0 && (
                <div className="flex items-end justify-center gap-4 pt-6 pb-2 animate-slide-up">
                    {/* 2nd Place */}
                    {top3.length > 1 && (() => {
                        const user = top3[1]
                        const isMe = user.userId === loggedUserId
                        const score = getScore(user)
                        return (
                            <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '100ms', animationFillMode: 'backwards' }}>
                                <div className="relative mb-2">
                                    <div className={`h-16 w-16 rounded-full flex items-center justify-center font-bold text-xl shadow-card border-3 border-ash-300 ring-2 ring-ash-200/50 ${user.equippedSkinCss ? user.equippedSkinCss : isMe ? 'bg-brand-orange text-white' : 'bg-gradient-to-br from-ash-100 to-ash-200 text-ash-600'}`}>
                                        {user.displayName?.charAt(0) || 'U'}
                                    </div>
                                    <div className="absolute -top-2 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-ash-300 to-ash-500 flex items-center justify-center text-white text-xs font-bold shadow-soft border-2 border-white">
                                        2
                                    </div>
                                    {getRankChangeIndicator(user.userId)}
                                </div>
                                <div className={`text-sm font-bold ${isMe ? 'text-brand-orange' : 'text-ash-700'} text-center max-w-[100px] truncate`}>{user.displayName}</div>
                                {user.activeTitle && (
                                    <div className="text-[9px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200 mt-0.5">{user.activeTitle}</div>
                                )}
                                <div className="text-xs text-ash-500 mt-0.5">GDO {user.gdoCode || 'N/A'}</div>
                                <div className="text-lg font-black text-ash-700 mt-1">{score}</div>
                                <div className="text-[9px] uppercase font-bold tracking-wider text-ash-400">{getUnit()}</div>
                                {/* Pedestal — Silver */}
                                <div className="w-24 h-20 mt-2 bg-gradient-to-t from-ash-300 via-ash-200 to-ash-100 rounded-t-xl border border-ash-300 flex items-center justify-center shadow-card">
                                    <Medal className="h-6 w-6 text-ash-400" />
                                </div>
                            </div>
                        )
                    })()}

                    {/* 1st Place */}
                    {(() => {
                        const user = top3[0]
                        const isMe = user.userId === loggedUserId
                        const score = getScore(user)
                        return (
                            <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '0ms', animationFillMode: 'backwards' }}>
                                <div className="relative mb-2">
                                    <div className={`h-20 w-20 rounded-full flex items-center justify-center font-bold text-2xl shadow-elevated border-3 border-gold-400 ring-4 ring-gold-200/50 ${user.equippedSkinCss ? user.equippedSkinCss : isMe ? 'bg-brand-orange text-white' : 'bg-gradient-to-br from-gold-100 to-gold-200 text-gold-700'}`}>
                                        {user.displayName?.charAt(0) || 'U'}
                                    </div>
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <Crown className="h-7 w-7 text-gold-500 drop-shadow-md" />
                                    </div>
                                    {getRankChangeIndicator(user.userId)}
                                </div>
                                <div className={`text-base font-bold ${isMe ? 'text-brand-orange' : 'text-ash-800'} text-center max-w-[120px] truncate`}>{user.displayName}</div>
                                {user.activeTitle && (
                                    <div className="text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 mt-0.5">{user.activeTitle}</div>
                                )}
                                <div className="text-xs text-ash-500 mt-0.5">GDO {user.gdoCode || 'N/A'}</div>
                                <div className="text-2xl font-black text-gold-600 mt-1">{score}</div>
                                <div className="text-[10px] uppercase font-bold tracking-wider text-gold-500">{getUnit()}</div>
                                {isMe && <div className="bg-brand-orange-100 text-brand-orange-700 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 border border-brand-orange-200">TU</div>}
                                {/* Pedestal — Gold */}
                                <div className="w-28 h-28 mt-2 bg-gradient-to-t from-gold-300 via-gold-200 to-gold-50 rounded-t-xl border border-gold-300 flex items-center justify-center shadow-glow-gold">
                                    <Trophy className="h-8 w-8 text-gold-500" />
                                </div>
                            </div>
                        )
                    })()}

                    {/* 3rd Place */}
                    {top3.length > 2 && (() => {
                        const user = top3[2]
                        const isMe = user.userId === loggedUserId
                        const score = getScore(user)
                        return (
                            <div className="flex flex-col items-center animate-slide-up" style={{ animationDelay: '200ms', animationFillMode: 'backwards' }}>
                                <div className="relative mb-2">
                                    <div className={`h-14 w-14 rounded-full flex items-center justify-center font-bold text-lg shadow-card border-3 border-brand-orange-300 ring-2 ring-brand-orange-200/50 ${user.equippedSkinCss ? user.equippedSkinCss : isMe ? 'bg-brand-orange text-white' : 'bg-gradient-to-br from-brand-orange-50 to-brand-orange-100 text-brand-orange-600'}`}>
                                        {user.displayName?.charAt(0) || 'U'}
                                    </div>
                                    <div className="absolute -top-2 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange-300 to-brand-orange-500 flex items-center justify-center text-white text-xs font-bold shadow-soft border-2 border-white">
                                        3
                                    </div>
                                    {getRankChangeIndicator(user.userId)}
                                </div>
                                <div className={`text-sm font-bold ${isMe ? 'text-brand-orange' : 'text-ash-700'} text-center max-w-[100px] truncate`}>{user.displayName}</div>
                                {user.activeTitle && (
                                    <div className="text-[9px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200 mt-0.5">{user.activeTitle}</div>
                                )}
                                <div className="text-xs text-ash-500 mt-0.5">GDO {user.gdoCode || 'N/A'}</div>
                                <div className="text-lg font-black text-ash-700 mt-1">{score}</div>
                                <div className="text-[9px] uppercase font-bold tracking-wider text-ash-400">{getUnit()}</div>
                                {/* Pedestal — Bronze */}
                                <div className="w-20 h-16 mt-2 bg-gradient-to-t from-brand-orange-200 via-brand-orange-100 to-brand-orange-50 rounded-t-xl border border-brand-orange-200 flex items-center justify-center shadow-card">
                                    <Medal className="h-5 w-5 text-brand-orange-400" />
                                </div>
                            </div>
                        )
                    })()}
                </div>
            )}

            {/* The Rest of the List (rank 4+) */}
            <div className={`bg-white rounded-2xl shadow-card border border-ash-200/60 overflow-hidden transition-opacity duration-300 ${isPending ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                {currentData.length === 0 ? (
                    <div className="p-16 text-center text-ash-400 animate-fade-in">
                        <div className="w-16 h-16 rounded-2xl bg-ash-100 flex items-center justify-center mx-auto mb-4">
                            <Trophy className="h-8 w-8 text-ash-300" />
                        </div>
                        <div>Nessun dato per questo periodo e metrica.</div>
                    </div>
                ) : (
                    <ul className="divide-y divide-ash-100">
                        {rest.map((user, index) => {
                            const isMe = user.userId === loggedUserId
                            const score = getScore(user)
                            const topScore = getScore(currentData[0])
                            const rankChange = rankChanges.get(user.userId)

                            return (
                                <li
                                    key={user.userId}
                                    className={`relative transition-all duration-300 hover:bg-brand-orange-50/20 animate-fade-in ${isMe ? 'bg-brand-orange-50/30' : ''} ${rankChange ? 'animate-slide-up' : ''}`}
                                    style={{ animationDelay: `${(index + 3) * 50}ms`, animationFillMode: 'backwards' }}
                                >
                                    {isMe && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-brand-orange to-ember-400 shadow-glow-orange z-10" />
                                    )}

                                    <div className="px-6 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            {/* Rank + change indicator */}
                                            <div className="w-10 flex flex-col items-center">
                                                <div className="text-sm font-bold text-ash-400">#{user.rank}</div>
                                                {getRankChangeIndicator(user.userId)}
                                            </div>

                                            {/* Avatar */}
                                            <div className="relative">
                                                <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shadow-soft ${user.equippedSkinCss ? user.equippedSkinCss : isMe ? 'bg-brand-orange text-white' : 'bg-ash-100 text-ash-600 border border-ash-200'
                                                    }`}>
                                                    {user.displayName?.charAt(0) || 'U'}
                                                </div>
                                            </div>

                                            {/* INFO */}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`font-semibold ${isMe ? 'text-brand-orange-700' : 'text-ash-800'}`}>
                                                        {user.displayName}
                                                    </div>
                                                    {isMe && (
                                                        <div className="bg-brand-orange-100 text-brand-orange-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-brand-orange-200">
                                                            TU
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-ash-500 text-xs flex items-center gap-1.5 mt-0.5">
                                                    <User className="h-3 w-3" /> GDO {user.gdoCode || 'N/A'}
                                                    {user.activeTitle && (
                                                        <div className="text-[9px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200">{user.activeTitle}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* SCORE */}
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <div className="text-2xl font-black tracking-tighter text-ash-800">
                                                    {score}
                                                </div>
                                                <div className="text-[10px] uppercase font-bold tracking-wider text-ash-400 mt-0.5">
                                                    {getUnit()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Progress bar relative to top score */}
                                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-ash-50">
                                        <div
                                            className={`h-full ${isMe ? 'bg-gradient-to-r from-brand-orange to-ember-400' : 'bg-ash-200'}`}
                                            style={{
                                                width: `${topScore > 0 ? Math.max(5, (score / topScore) * 100) : 0}%`,
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
