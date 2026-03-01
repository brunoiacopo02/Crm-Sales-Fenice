"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect } from "react"
import { Timer, Trophy, Medal, ChevronDown, ChevronUp } from "lucide-react"
import { getActiveSprint, getSprintLeaderboard } from "@/app/actions/sprintActions"
export function SprintBanner() {
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const status = isLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const [activeSprint, setActiveSprint] = useState<any>(null)
    const [timeLeft, setTimeLeft] = useState<string>("")
    const [isExpanded, setIsExpanded] = useState(false)
    const [leaderboard, setLeaderboard] = useState<any[]>([])
    const [isClosing, setIsClosing] = useState(false)

    // Primary polling loop for active sprint state
    useEffect(() => {
        const fetchState = async () => {
            try {
                const sprint = await getActiveSprint()
                setActiveSprint(sprint)

                if (sprint && isExpanded) {
                    const lb = await getSprintLeaderboard(sprint.id)
                    setLeaderboard(lb)
                }
            } catch (e) {
                console.error("Sprint banner error:", e)
            }
        }

        fetchState()
        const int = setInterval(fetchState, 10000)
        return () => clearInterval(int)
    }, [isExpanded])

    // Countdown and dynamic close effect
    useEffect(() => {
        if (!activeSprint) return

        const updateTimer = () => {
            const now = new Date().getTime()
            const end = new Date(activeSprint.endTime).getTime()
            const distance = end - now

            if (distance <= 0) {
                setTimeLeft("00:00:00")
                if (!isClosing) {
                    // The server might not have closed it yet if nobody triggered an action,
                    // but locally we consider it finishing. In 10s the polling will fetch the null sprint and remove the banner.
                    setIsClosing(true)
                }
            } else {
                setIsClosing(false)
                const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
                const s = Math.floor((distance % (1000 * 60)) / 1000)
                setTimeLeft(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
            }
        }

        updateTimer()
        const int = setInterval(updateTimer, 1000)
        return () => clearInterval(int)
    }, [activeSprint, isClosing])

    if (!activeSprint && !isClosing) return null

    return (
        <div className="bg-brand-charcoal border-b border-brand-orange/30 text-white relative z-40 transition-all duration-300 shadow-md">
            {/* The main thin banner */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-brand-orange/20 p-1.5 rounded-md animate-pulse">
                        <Timer className="h-4 w-4 text-brand-orange" />
                    </div>
                    <span className="font-semibold text-sm sm:text-base tracking-tight">Focus Sprint in corso</span>
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                    <div className="bg-black/20 px-3 py-1 rounded-md text-brand-orange font-mono font-bold text-lg tabular-nums shadow-inner">
                        {timeLeft}
                    </div>

                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white transition-colors bg-white/5 py-1 px-3 rounded-full border border-white/10"
                    >
                        <Trophy className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Mini-Classifica</span>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* Expanded Leaderboard Section */}
            {isExpanded && activeSprint && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 bg-black/10 border-t border-white/5 animate-in slide-in-from-top-2 duration-200">
                    <h4 className="text-xs uppercase tracking-widest text-gray-400 font-bold mb-3">Ranking Attuale</h4>
                    {leaderboard.length === 0 || !leaderboard.some(l => l.appointmentCount > 0) ? (
                        <div className="py-6 text-center text-gray-400 text-sm">
                            Nessun appuntamento fissato in questo sprint finora. Chi sarà il primo?
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {leaderboard.filter(l => l.appointmentCount > 0).slice(0, 6).map((gdo, index) => {
                                const isMe = gdo.userId === session?.user?.id
                                return (
                                    <div key={gdo.userId} className={`flex items-center justify-between p-3 rounded-lg border ${isMe ? 'bg-brand-orange/10 border-brand-orange/30' : 'bg-white/5 border-white/10'}`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm ${gdo.equippedSkinCss ? gdo.equippedSkinCss : index === 0 ? 'bg-yellow-500 text-yellow-900' : 'bg-gray-700 text-gray-200'}`}>
                                                {gdo.displayName?.charAt(0) || 'U'}
                                            </div>
                                            <div className="text-sm">
                                                <div className="font-semibold flex items-center gap-2">
                                                    {gdo.displayName}
                                                    {isMe && <span className="text-[9px] bg-brand-orange text-white px-1.5 rounded-full">TU</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-xl font-bold tabular-nums text-brand-orange drop-shadow-sm">
                                            {gdo.appointmentCount}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
