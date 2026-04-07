"use client"

import { useState, useEffect } from "react"
import { getActiveTeamGoals } from "@/app/actions/teamGoalActions"
import { Target, Coins, Timer, Sparkles, CheckCircle2 } from "lucide-react"

export function TeamGoalBanner() {
    const [goals, setGoals] = useState<any[]>([])

    useEffect(() => {
        let mounted = true
        const fetchGoals = async () => {
            try {
                const active = await getActiveTeamGoals()
                if (mounted) setGoals(active)
            } catch (e) {
                console.error("Failed to fetch goals:", e)
            }
        }

        fetchGoals()
        const int = setInterval(fetchGoals, 10000) // Poll every 10s
        return () => {
            mounted = false
            clearInterval(int)
        }
    }, [])

    if (goals.length === 0) return null

    return (
        <div className="space-y-4">
            {goals.map(goal => {
                const isCompleted = goal.currentCount >= goal.targetCount
                const progress = isCompleted ? 100 : Math.min(100, (goal.currentCount / goal.targetCount) * 100)

                return (
                    <div
                        key={goal.id}
                        className={`relative overflow-hidden rounded-2xl border ${isCompleted ? 'bg-gradient-to-br from-green-50 to-green-100/50 border-green-200 shadow-green-900/5' : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200/50 shadow-blue-900/5'} shadow-lg group`}
                    >
                        {/* Decorazioni background */}
                        <div className={`absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl opacity-50 ${isCompleted ? 'bg-green-400' : 'bg-brand-orange'}`} />

                        <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                            {/* Titolo e Info */}
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className={`p-2 rounded-xl shadow-sm border ${isCompleted ? 'bg-green-100 text-green-600 border-green-200' : 'bg-white text-indigo-600 border-indigo-100'}`}>
                                        {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                                    </div>
                                    <div>
                                        <h3 className={`font-bold text-lg tracking-tight ${isCompleted ? 'text-green-900' : 'text-gray-900'}`}>
                                            {goal.title}
                                        </h3>
                                        <div className="flex items-center gap-3 text-xs font-semibold mt-0.5">
                                            {isCompleted ? (
                                                <span className="text-green-600">Obiettivo Raggiunto!</span>
                                            ) : (
                                                <span className="text-gray-500 uppercase flex items-center gap-1">
                                                    <Timer className="h-3 w-3" /> Scade il: {new Date(goal.deadline).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <p className={`text-sm ${isCompleted ? 'text-green-700/80' : 'text-gray-600'} leading-relaxed max-w-2xl`}>
                                    {goal.goalType === 'database'
                                        ? "Fissa appuntamenti sui lead storici (provenienza: Database) per incrementare il contatore globale. Aiuta la squadra a raggiungere il premio in palio!"
                                        : "Fissa appuntamenti su qualsiasi lead per incrementare il contatore globale. Aiuta la squadra a raggiungere il premio in palio!"}
                                </p>
                            </div>

                            {/* Progresso e Ricompensa */}
                            <div className="w-full md:w-96 flex-shrink-0 bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-white max-w-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="font-bold text-gray-800 tracking-tight flex items-baseline gap-1">
                                        <span className="text-2xl">{goal.currentCount}</span>
                                        <span className="text-gray-400 text-sm">/ {goal.targetCount}</span>
                                    </div>

                                    <div className="flex items-center gap-1.5 bg-yellow-100/80 border border-yellow-200 text-yellow-800 px-3 py-1.5 rounded-lg ml-auto shadow-sm">
                                        <Coins className="h-4 w-4 text-yellow-500" />
                                        <span className="text-sm font-bold">+{goal.rewardCoins} Coin</span>
                                    </div>
                                </div>

                                <div className="h-3 w-full bg-gray-200/80 rounded-full overflow-hidden shadow-inner">
                                    <div
                                        className={`h-full transition-[width] duration-1000 cubic-bezier(0.16, 1, 0.3, 1) ${isCompleted ? 'bg-gradient-to-r from-green-400 to-green-500' : 'bg-gradient-to-r from-indigo-500 to-brand-orange'}`}
                                        style={{ width: `${progress}%` }}
                                    >
                                        {/* Sparkles effect over progress bar */}
                                        <div className="h-full w-full bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%)] bg-[length:15px_15px] animate-slide-bg" />
                                    </div>
                                </div>

                                <div className="flex justify-between items-center mt-2 px-1">
                                    <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                                        Progresso della squadra
                                    </p>
                                    <p className="text-[10px] font-bold text-indigo-600">
                                        {Math.round(progress)}%
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
