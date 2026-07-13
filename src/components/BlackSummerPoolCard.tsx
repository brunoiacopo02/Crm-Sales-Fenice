"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sun, RefreshCw, Users, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import {
    getBlackSummerPoolStatus,
    syncBlackSummerPool,
    assignFromBlackSummerPool,
    type BlackSummerAssignReport,
    type BlackSummerSyncReport,
} from "@/app/actions/launchPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

export function BlackSummerPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<{ available: number } | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [report, setReport] = useState<BlackSummerAssignReport | null>(null)
    const [syncReport, setSyncReport] = useState<BlackSummerSyncReport | null>(null)

    useEffect(() => {
        Promise.all([getBlackSummerPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // undefined = loading, null = azienda ≠ Fenice → card nascosta.
    // A differenza della card VE resta visibile a pool vuoto: serve per il primo sync.
    if (status === undefined || status === null) return null

    const total = count
    const canSubmit = !loading && !syncing && total > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(total / selectedGdoIds.size) : 0

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleSync = async () => {
        if (syncing || loading) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncBlackSummerPool()
            setSyncReport(res)
            const fresh = await getBlackSummerPoolStatus()
            setStatus(fresh)
            router.refresh()
        } catch (e) {
            setSyncReport({
                ok: false,
                imported: 0,
                skippedExisting: 0,
                skippedNoPhone: 0,
                totalOnList: 0,
                errors: ['Errore imprevisto durante il sync: ' + String(e)],
            })
        } finally {
            setSyncing(false)
        }
    }

    const handleAssign = async () => {
        if (!canSubmit) return
        if (total > 100 && !confirm(`Stai per assegnare ${total} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromBlackSummerPool({ count: total, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                const fresh = await getBlackSummerPoolStatus()
                setStatus(fresh)
                setCount(0)
                router.refresh()
            }
        } catch (e) {
            setReport({
                ok: false,
                errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)],
                perGdo: {},
                totalAssigned: 0,
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl border-2 border-amber-300 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center justify-between gap-3 border-b border-amber-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Sun className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Lancio Black Summer</h2>
                        <p className="text-xs text-ash-500">Lista d&apos;attesa AC — bucket unico, nessuna distinzione webinar. Funnel: Black Summer.</p>
                    </div>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing || loading}
                    className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {syncing
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                        : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza da ActiveCampaign</>}
                </button>
            </div>

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con errori'}
                        {' — '}{syncReport.imported} importati, {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (lista AC: {syncReport.totalOnList})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}

            {/* Stat tile */}
            <div className="bg-white rounded-lg border border-amber-100 p-4 flex items-center gap-3">
                <Sun className="h-6 w-6 text-amber-500" />
                <div>
                    <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Lead nel pool</p>
                    <p className="text-2xl font-black text-ash-900">{status.available} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                </div>
            </div>

            {/* Quantità */}
            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead pescare dal pool</label>
                <input
                    type="number"
                    min={0}
                    max={status.available}
                    value={count}
                    disabled={status.available === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(status.available, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-amber-200 rounded-md text-sm focus:ring-amber-500 focus:border-amber-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            {/* GDO selection */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-amber-700 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-amber-50 border-amber-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-amber-600 border-ash-300 focus:ring-amber-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && (
                        <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>
                    )}
                </div>
            </div>

            {/* Preview */}
            {total > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-amber-100/60 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{total} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Esegui Assegnazione</>}
                </button>
            </div>

            {/* Report */}
            {report && (
                <div className={`p-4 rounded-lg border ${report.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <h4 className="font-semibold text-sm text-ash-800 flex items-center gap-2 mb-2">
                        {report.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                        {report.ok ? `${report.totalAssigned} lead assegnati con successo` : 'Assegnazione non eseguita'}
                    </h4>
                    {report.errors.length > 0 && (
                        <ul className="text-xs text-red-700 list-disc pl-5 mb-2">
                            {report.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    )}
                    {report.ok && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {Object.entries(report.perGdo).filter(([, v]) => v.count > 0).map(([id, v]) => (
                                <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-amber-700">{v.count}</strong>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
