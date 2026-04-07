"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect } from "react"
import { Timer, Trophy, Medal, ChevronDown, ChevronUp, Flame, Zap } from "lucide-react"
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
    const [isUrgent, setIsUrgent] = useState(false)

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
                setTimeLeft("00:00")
                setIsUrgent(false)
                if (!isClosing) {
                    setIsClosing(true)
                }
            } else {
                setIsClosing(false)
                // Under 5 min = urgent
                setIsUrgent(distance < 5 * 60 * 1000)
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
        <div className={`relative z-40 transition-all duration-300 shadow-elevated overflow-hidden ${isUrgent
            ? 'bg-gradient-to-r from-ember-700 via-ember-600 to-ember-700'
            : 'bg-gradient-to-r from-brand-charcoal via-ash-900 to-brand-charcoal'
            } text-white`}>
            {/* Animated fire/glow accent line */}
            <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${isUrgent
                ? 'from-transparent via-ember-400 to-transparent animate-shimmer'
                : 'from-transparent via-brand-orange to-transparent'
                }`} style={{ backgroundSize: '200% 100%' }} />

            {/* The main thin banner */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between relative">
                <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${isUrgent
                        ? 'bg-ember-500/30 animate-pulse'
                        : 'bg-brand-orange/20'
                        }`}>
                        {isUrgent
                            ? <Flame className="h-4 w-4 text-ember-300" />
                            : <Timer className="h-4 w-4 text-brand-orange" />
                        }
                    </div>
                    <div className="font-semibold text-sm sm:text-base tracking-tight">
                        {isUrgent ? 'Sprint sta per finire!' : 'Focus Sprint in corso'}
                    </div>
                    {isUrgent && <Zap className="h-3.5 w-3.5 text-gold-400 animate-pulse" />}
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                    {/* Countdown */}
                    <div className={`px-4 py-1.5 rounded-lg font-mono font-bold text-lg tabular-nums shadow-inner ${isUrgent
                        ? 'bg-ember-800/50 text-ember-200 border border-ember-500/30 animate-pulse'
                        : 'bg-black/20 text-brand-orange border border-white/5'
                        }`}>
                        {timeLeft}
                    </div>

                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-ash-300 hover:text-white transition-colors bg-white/5 py-1.5 px-3.5 rounded-lg border border-white/10 hover:bg-white/10"
                    >
                        <Trophy className="h-3.5 w-3.5 text-gold-400" />
                        <div className="hidden sm:inline">Mini-Classifica</div>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* Expanded Leaderboard Section */}
            {isExpanded && activeSprint && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 bg-black/15 border-t border-white/5 animate-fade-in">
                    <h4 className="text-xs uppercase tracking-widest text-ash-400 font-bold mb-3 flex items-center gap-2">
                        <Medal className="h-3.5 w-3.5 text-gold-400" /> Ranking Attuale
                    </h4>
                    {leaderboard.length === 0 || !leaderboard.some(l => l.appointmentCount > 0) ? (
                        <div className="py-6 text-center text-ash-400 text-sm">
                            Nessun appuntamento fissato in questo sprint finora. Chi sarà il primo?
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {leaderboard.filter(l => l.appointmentCount > 0).slice(0, 6).map((gdo, index) => {
                                const isMe = gdo.userId === session?.user?.id
                                return (
                                    <div
                                        key={gdo.userId}
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 animate-fade-in ${isMe
                                            ? 'bg-brand-orange/15 border-brand-orange/30 shadow-glow-orange'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                                            }`}
                                        style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Rank indicator */}
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${index === 0
                                                ? 'bg-gradient-to-br from-gold-400 to-gold-500 text-white shadow-glow-gold'
                                                : index === 1
                                                    ? 'bg-gradient-to-br from-ash-300 to-ash-400 text-white'
                                                    : index === 2
                                                        ? 'bg-gradient-to-br from-brand-orange-300 to-brand-orange-500 text-white'
                                                        : 'bg-white/10 text-ash-400'
                                                }`}>
                                                {index + 1}
                                            </div>
                                            <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm ${gdo.equippedSkinCss ? gdo.equippedSkinCss : index === 0 ? 'bg-gold-500 text-gold-900' : 'bg-ash-700 text-ash-200'}`}>
                                                {gdo.displayName?.charAt(0) || 'U'}
                                            </div>
                                            <div className="text-sm">
                                                <div className="font-semibold flex items-center gap-2">
                                                    {gdo.displayName}
                                                    {isMe && <div className="text-[9px] bg-brand-orange text-white px-1.5 py-0.5 rounded-full font-bold">TU</div>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`text-xl font-bold tabular-nums drop-shadow-sm ${index === 0 ? 'text-gold-400' : 'text-brand-orange'}`}>
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
