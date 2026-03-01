"use client"

import { useState, useEffect } from "react"
import { createTeamGoal, getAllTeamGoals, deleteTeamGoal } from "@/app/actions/teamGoalActions"
import { Target, Calendar, Coins, Plus, CheckCircle2, Clock, Trash2 } from "lucide-react"

export function TeamGoalAdminClient() {
    const [goals, setGoals] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Form states
    const [isCreating, setIsCreating] = useState(false)
    const [title, setTitle] = useState("")
    const [targetCount, setTargetCount] = useState<number | "">("")
    const [deadlineDate, setDeadlineDate] = useState("")
    const [rewardCoins, setRewardCoins] = useState<number | "">("")
    const [goalType, setGoalType] = useState<'database' | 'generico'>("database")

    const loadData = async () => {
        setIsLoading(true)
        try {
            const data = await getAllTeamGoals()
            setGoals(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
        } catch (e) {
            console.error(e)
        }
        setIsLoading(false)
    }

    useEffect(() => {
        loadData()
    }, [])

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title || !targetCount || !deadlineDate || !rewardCoins) return

        setIsCreating(true)
        try {
            // Deadline represents end of that day
            const d = new Date(deadlineDate)
            d.setHours(23, 59, 59, 999)

            await createTeamGoal({
                title,
                targetCount: Number(targetCount),
                deadline: d,
                rewardCoins: Number(rewardCoins),
                goalType: goalType
            })

            setTitle("")
            setTargetCount("")
            setDeadlineDate("")
            setRewardCoins("")
            await loadData()
            alert("Team Goal creato con successo!")
        } catch (err: any) {
            alert(err.message)
        }
        setIsCreating(false)
    }

    const handleDelete = async (goalId: string) => {
        if (!confirm("Sei sicuro di voler eliminare questo Obiettivo di Squadra? L'azione è irreversibile.")) return
        try {
            await deleteTeamGoal(goalId)
            await loadData()
        } catch (e: any) {
            alert(e.message)
        }
    }

    if (isLoading) return <div className="h-64 animate-pulse bg-white rounded-xl border border-gray-100" />

    const activeGoals = goals.filter(g => g.status === 'active')
    const completedGoals = goals.filter(g => g.status === 'completed')

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                {/* Create Form */}
                <div className="p-6 col-span-1 bg-gray-50/50">
                    <div className="flex items-center gap-2 mb-6">
                        <Plus className="h-5 w-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-gray-900">Nuovo Obiettivo</h2>
                    </div>

                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Titolo (es. Target Febbraio)</label>
                            <input
                                required type="text" value={title} onChange={e => setTitle(e.target.value)}
                                className="w-full text-sm border-gray-300 rounded-lg focus:ring-brand-orange focus:border-brand-orange px-3 py-2 border shadow-sm"
                                placeholder="Titolo dell'obiettivo"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Target Appuntamenti</label>
                            <input
                                required type="number" min="1" value={targetCount} onChange={e => setTargetCount(Number(e.target.value))}
                                className="w-full text-sm border-gray-300 rounded-lg focus:ring-brand-orange focus:border-brand-orange px-3 py-2 border shadow-sm"
                                placeholder="Num. di appuntamenti"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Premio Comunitario (a tutti)</label>
                            <div className="relative">
                                <Coins className="h-4 w-4 absolute left-3 top-2.5 text-yellow-500" />
                                <input
                                    required type="number" min="1" value={rewardCoins} onChange={e => setRewardCoins(Number(e.target.value))}
                                    className="w-full text-sm border-gray-300 rounded-lg focus:ring-brand-orange focus:border-brand-orange pl-9 pr-3 py-2 border shadow-sm"
                                    placeholder="Fenice Coin per GDO"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo di Obiettivo</label>
                            <select
                                value={goalType} onChange={e => setGoalType(e.target.value as any)}
                                className="w-full text-sm border-gray-300 rounded-lg focus:ring-brand-orange focus:border-brand-orange px-3 py-2 border shadow-sm bg-white"
                            >
                                <option value="database">Lead Database (Solo funnel "Database")</option>
                                <option value="generico">Lead Generico (Qualsiasi Appuntamento)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Scadenza</label>
                            <input
                                required type="date" value={deadlineDate} onChange={e => setDeadlineDate(e.target.value)}
                                className="w-full text-sm border-gray-300 rounded-lg focus:ring-brand-orange focus:border-brand-orange px-3 py-2 border shadow-sm"
                            />
                        </div>

                        <button
                            type="submit" disabled={isCreating}
                            className="w-full bg-brand-charcoal hover:bg-black text-white py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
                        >
                            {isCreating ? 'Creazione...' : 'Crea Team Goal'}
                        </button>
                    </form>
                </div>

                {/* List View */}
                <div className="p-6 col-span-2 space-y-8">
                    {/* Active */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Target className="h-5 w-5 text-brand-orange" />
                            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Obiettivi Attivi ({activeGoals.length})</h3>
                        </div>
                        {activeGoals.length === 0 ? (
                            <p className="text-sm text-gray-500 py-4">Nessun obiettivo attivo al momento.</p>
                        ) : (
                            <div className="grid gap-4">
                                {activeGoals.map(goal => (
                                    <div key={goal.id} className="border border-brand-orange/30 bg-orange-50/30 rounded-xl p-4 flex flex-col md:flex-row gap-4 items-start justify-between relative group">
                                        <div className="absolute top-2 right-2 md:top-4 md:right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleDelete(goal.id)} className="p-1.5 bg-white border border-red-200 text-red-500 rounded-md hover:bg-red-50 hover:text-red-600 shadow-sm transition-colors" title="Elimina Obiettivo">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="pr-8 md:pr-12">
                                            <h4 className="font-bold text-brand-charcoal text-lg mb-1">{goal.title}</h4>
                                            <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-gray-600">
                                                <span className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded-md shadow-sm">
                                                    <Target className="h-3.5 w-3.5 text-brand-orange" /> {goal.currentCount} / {goal.targetCount} {goal.goalType === 'database' ? 'Appt Database' : 'Appt Totali'}
                                                </span>
                                                <span className="flex items-center gap-1 bg-yellow-100 text-yellow-800 border border-yellow-200 px-2 py-1 rounded-md shadow-sm">
                                                    <Coins className="h-3.5 w-3.5 text-yellow-600" /> Premio: {goal.rewardCoins} Coin a testa
                                                </span>
                                                <span className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded-md shadow-sm">
                                                    <Calendar className="h-3.5 w-3.5 text-indigo-500" /> Scade il: {new Date(goal.deadline).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                        {/* Progress Bar local to the card */}
                                        <div className="min-w-[150px] w-full md:w-auto mt-2 md:mt-0">
                                            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden mb-1">
                                                <div
                                                    className="h-full bg-brand-orange transition-all duration-500"
                                                    style={{ width: `${Math.min(100, (goal.currentCount / goal.targetCount) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-[10px] text-right font-bold text-brand-orange">{Math.round((goal.currentCount / goal.targetCount) * 100)}%</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Completed */}
                    {completedGoals.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Obiettivi Completati</h3>
                            </div>
                            <div className="grid gap-3">
                                {completedGoals.map(goal => (
                                    <div key={goal.id} className="border border-green-200 bg-green-50 rounded-xl p-3 flex items-center justify-between opacity-75">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-white p-2 rounded-full border border-green-200 shadow-sm">
                                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-900 text-sm">{goal.title}</h4>
                                                <p className="text-xs text-green-700 font-medium">{goal.targetCount} {goal.goalType === 'database' ? 'Appuntamenti estratti dal Database.' : 'Appuntamenti chiusi in totale.'} 💰 Pagato: {goal.rewardCoins} Coin.</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
