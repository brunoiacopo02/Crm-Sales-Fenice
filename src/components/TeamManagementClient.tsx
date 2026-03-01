"use client"

import { useState, useEffect } from "react"
import { getTeamAccounts, seedGdoAccounts, updateGdoProfile, updateGdoTargets } from "@/app/actions/teamActions"
import { User, ShieldAlert, Check, X, Edit2, KeyRound } from "lucide-react"

export function TeamManagementClient() {
    const [team, setTeam] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [seedResult, setSeedResult] = useState<any>(null)
    const [isSeeding, setIsSeeding] = useState(false)

    const [activeTab, setActiveTab] = useState<'GDO' | 'VENDITORE'>('GDO')

    // State per l'editing in linea
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editData, setEditData] = useState<{ displayName: string, isActive: boolean, dailyApptTarget: number, weeklyConfirmedTarget: number }>({ displayName: '', isActive: true, dailyApptTarget: 2, weeklyConfirmedTarget: 5 })

    // State per Mass Update Targets
    const [massDailyTarget, setMassDailyTarget] = useState(2)
    const [massWeeklyTarget, setMassWeeklyTarget] = useState(5)
    const [isSavingMass, setIsSavingMass] = useState(false)

    const fetchTeam = async () => {
        setIsLoading(true)
        try {
            const data = await getTeamAccounts()
            setTeam(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchTeam()
    }, [])

    const handleSeed = async () => {
        if (!confirm("Vuoi procedere alla generazione massiva degli account GDO mancanti (105-119)?")) return
        setIsSeeding(true)
        try {
            const result = await seedGdoAccounts()
            setSeedResult(result)
            fetchTeam()
        } catch (error: any) {
            alert(error.message)
        } finally {
            setIsSeeding(false)
        }
    }

    const startEdit = (user: any) => {
        setEditingId(user.id)
        setEditData({
            displayName: user.displayName || user.name || '',
            isActive: user.isActive,
            dailyApptTarget: user.dailyApptTarget ?? 2,
            weeklyConfirmedTarget: user.weeklyConfirmedTarget ?? 5
        })
    }

    const cancelEdit = () => {
        setEditingId(null)
    }

    const saveEdit = async (userId: string) => {
        try {
            await updateGdoProfile(userId, {
                displayName: editData.displayName,
                isActive: editData.isActive
            })
            await updateGdoTargets(editData.dailyApptTarget, editData.weeklyConfirmedTarget, userId)
            setEditingId(null)
            fetchTeam()
        } catch (error) {
            alert("Errore durante il salvataggio")
        }
    }

    const handleMassUpdateTargets = async () => {
        if (!confirm(`Impostare per TUTTI i GDO il target a ${massDailyTarget} giornaliero e ${massWeeklyTarget} settimanale?`)) return
        setIsSavingMass(true)
        try {
            await updateGdoTargets(massDailyTarget, massWeeklyTarget, 'ALL')
            fetchTeam()
        } catch {
            alert("Errore salvataggio massivo")
        } finally {
            setIsSavingMass(false)
        }
    }

    if (isLoading) return <div className="p-8 text-center text-gray-500">Caricamento anagrafica team...</div>

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden max-w-7xl mx-auto">

            {/* Header / Actions */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <div className="text-sm font-medium text-gray-700">
                    Totale Account GDO: {team.length}
                </div>

                <button
                    onClick={handleSeed}
                    disabled={isSeeding}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-charcoal text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                    <KeyRound className="h-4 w-4" />
                    {isSeeding ? "Generazione in corso..." : "Auto-Genera Account (Seed)"}
                </button>
            </div>

            {/* Tabs for Roles */}
            <div className="flex border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('GDO')}
                    className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${activeTab === 'GDO' ? 'border-b-2 border-brand-orange text-brand-orange bg-orange-50/50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                >
                    Operatori GDO
                </button>
                <button
                    onClick={() => setActiveTab('VENDITORE')}
                    className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${activeTab === 'VENDITORE' ? 'border-b-2 border-brand-orange text-brand-orange bg-orange-50/50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                >
                    Venditori (Closer)
                </button>
            </div>

            {/* Mass Target Settings */}
            <div className="p-4 bg-white border-b border-gray-200 flex flex-wrap gap-6 items-end">
                <div>
                    <h3 className="text-sm font-bold text-gray-800 mb-1">Target Aziendali (Multiplo)</h3>
                    <p className="text-xs text-gray-500 max-w-sm">Imposta o sovrascrivi gli obiettivi per tutti i membri del team contemporaneamente.</p>
                </div>
                <div className="flex items-end gap-3 ml-auto">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 font-medium">Target Appuntamenti/Giorno</label>
                        <input type="number" min="0" value={massDailyTarget} onChange={e => setMassDailyTarget(Number(e.target.value))} className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-brand-orange" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1 font-medium">Target Conferme/Settimana</label>
                        <input type="number" min="0" value={massWeeklyTarget} onChange={e => setMassWeeklyTarget(Number(e.target.value))} className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-brand-orange" />
                    </div>
                    <button onClick={handleMassUpdateTargets} disabled={isSavingMass} className="px-4 py-1.5 bg-brand-orange text-white text-sm font-medium rounded hover:bg-orange-600 transition-colors disabled:opacity-50 h-[34px]">
                        Applica a Tutti
                    </button>
                </div>
            </div>

            {/* Seed Result Alert */}
            {seedResult && seedResult.createdCount > 0 && (
                <div className="p-4 bg-green-50 border-b border-green-200">
                    <h3 className="text-green-800 font-bold mb-2">{seedResult.message}</h3>
                    <p className="text-sm text-green-700 mb-2">
                        ATTENZIONE: Copia le seguenti credenziali per fornirle ai GDO. Non verranno più mostrate in chiaro.
                    </p>
                    <div className="bg-white p-3 rounded border border-green-100 max-h-48 overflow-y-auto font-mono text-xs">
                        {seedResult.accounts.map((acc: any) => (
                            <div key={acc.gdoCode} className="mb-1">
                                <strong>Username:</strong> {acc.username} | <strong>Password:</strong> {acc.password}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Team Table */}
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-white text-gray-500 font-medium">
                        <tr>
                            {activeTab === 'GDO' && <th scope="col" className="px-6 py-3 text-left uppercase tracking-wider w-16">Codice</th>}
                            <th scope="col" className="px-6 py-3 text-left uppercase tracking-wider">Username Login</th>
                            <th scope="col" className="px-6 py-3 text-left uppercase tracking-wider">Display Name</th>
                            {activeTab === 'GDO' && <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Target G.</th>}
                            {activeTab === 'GDO' && <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Target S.</th>}
                            <th scope="col" className="px-6 py-3 text-center uppercase tracking-wider">Stato</th>
                            <th scope="col" className="px-6 py-3 text-right uppercase tracking-wider">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                        {team.filter(u => u.role === activeTab).length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                    Nessun account {activeTab} presente.
                                </td>
                            </tr>
                        ) : (
                            team.filter(u => u.role === activeTab).map((user) => {
                                const isEditing = editingId === user.id

                                return (
                                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                        {activeTab === 'GDO' && (
                                            <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">
                                                {user.gdoCode || '-'}
                                            </td>
                                        )}
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {user.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={editData.displayName}
                                                    onChange={e => setEditData({ ...editData, displayName: e.target.value })}
                                                    className="px-2 py-1 border border-brand-orange rounded w-full focus:outline-none"
                                                />
                                            ) : (
                                                <div className="flex items-center gap-2 font-medium text-gray-900">
                                                    <div className="h-6 w-6 rounded-full bg-brand-orange/10 text-brand-orange flex items-center justify-center text-xs font-bold">
                                                        {user.displayName?.charAt(0) || 'U'}
                                                    </div>
                                                    {user.displayName || user.name}
                                                </div>
                                            )}
                                        </td>
                                        {activeTab === 'GDO' && (
                                            <>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editData.dailyApptTarget}
                                                            onChange={e => setEditData({ ...editData, dailyApptTarget: Number(e.target.value) })}
                                                            className="w-16 px-2 py-1 border border-brand-orange rounded text-center focus:outline-none focus:ring-1 focus:ring-brand-orange"
                                                        />
                                                    ) : (
                                                        <span className="font-bold">{user.dailyApptTarget ?? 2}</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-gray-700">
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editData.weeklyConfirmedTarget}
                                                            onChange={e => setEditData({ ...editData, weeklyConfirmedTarget: Number(e.target.value) })}
                                                            className="w-16 px-2 py-1 border border-brand-orange rounded text-center focus:outline-none focus:ring-1 focus:ring-brand-orange"
                                                        />
                                                    ) : (
                                                        <span className="font-bold text-green-700">{user.weeklyConfirmedTarget ?? 5}</span>
                                                    )}
                                                </td>
                                            </>
                                        )}
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            {isEditing ? (
                                                <label className="inline-flex relative items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={editData.isActive}
                                                        onChange={e => setEditData({ ...editData, isActive: e.target.checked })}
                                                    />
                                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                                                </label>
                                            ) : (
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                    {user.isActive ? 'Attivo' : 'Disattivato'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            {isEditing ? (
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={() => saveEdit(user.id)} className="text-green-600 hover:text-green-900 p-1">
                                                        <Check className="h-4 w-4" />
                                                    </button>
                                                    <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 p-1">
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button onClick={() => startEdit(user)} className="text-brand-orange hover:text-orange-700 p-1 flex items-center justify-end w-full">
                                                    <Edit2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

        </div>
    )
}
