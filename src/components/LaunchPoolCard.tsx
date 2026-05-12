"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Rocket, Eye, EyeOff, Users, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import {
    getLaunchPoolStatus,
    assignFromLaunchPool,
    type LaunchPoolStatus,
    type AssignFromPoolReport,
} from "@/app/actions/launchPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

export function LaunchPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<LaunchPoolStatus | null>(null)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [webinarN, setWebinarN] = useState<number>(0)
    const [noWebinarN, setNoWebinarN] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [report, setReport] = useState<AssignFromPoolReport | null>(null)

    useEffect(() => {
        Promise.all([getLaunchPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // Pool completamente vuoto → non rendere nulla
    if (status && status.webinarAvailable === 0 && status.noWebinarAvailable === 0) {
        return null
    }
    if (!status) return null // loading: la card si nasconde fino al fetch

    const total = webinarN + noWebinarN
    const noGdoSelected = selectedGdoIds.size === 0
    const canSubmit = !loading && total > 0 && !noGdoSelected
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(total / selectedGdoIds.size) : 0

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleAssign = async () => {
        if (!canSubmit) return
        if (total > 100 && !confirm(`Stai per assegnare ${total} lead in un colpo solo. Continuare?`)) return

        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromLaunchPool({
                webinarCount: webinarN,
                noWebinarCount: noWebinarN,
                gdoIds: Array.from(selectedGdoIds),
            })
            setReport(res)
            if (res.ok) {
                const fresh = await getLaunchPoolStatus()
                setStatus(fresh)
                setWebinarN(0)
                setNoWebinarN(0)
                router.refresh()
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl border-2 border-purple-200 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center gap-3 border-b border-purple-100 pb-4">
                <div className="h-10 w-10 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                    <Rocket className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-ash-900">Pool Lancio Videoeditor</h2>
                    <p className="text-xs text-ash-500">Distribuisci gradualmente i lead del lancio ai tuoi GDO. Funnel: ORG.</p>
                </div>
            </div>

            {/* Stat tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-purple-100 p-4 flex items-center gap-3">
                    <Eye className="h-6 w-6 text-purple-600" />
                    <div>
                        <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Webinar Visto</p>
                        <p className="text-2xl font-black text-ash-900">{status.webinarAvailable} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-purple-100 p-4 flex items-center gap-3">
                    <EyeOff className="h-6 w-6 text-ash-500" />
                    <div>
                        <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Webinar NON Visto</p>
                        <p className="text-2xl font-black text-ash-900">{status.noWebinarAvailable} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                    </div>
                </div>
            </div>

            {/* Quantità input */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-semibold text-ash-700 mb-1 block">Pesca dal pool &quot;Webinar Visto&quot;</label>
                    <input
                        type="number"
                        min={0}
                        max={status.webinarAvailable}
                        value={webinarN}
                        disabled={status.webinarAvailable === 0}
                        onChange={(e) => setWebinarN(Math.max(0, Math.min(status.webinarAvailable, parseInt(e.target.value) || 0)))}
                        className="w-full h-10 px-3 border border-purple-200 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                    />
                </div>
                <div>
                    <label className="text-xs font-semibold text-ash-700 mb-1 block">Pesca dal pool &quot;Webinar NON Visto&quot;</label>
                    <input
                        type="number"
                        min={0}
                        max={status.noWebinarAvailable}
                        value={noWebinarN}
                        disabled={status.noWebinarAvailable === 0}
                        onChange={(e) => setNoWebinarN(Math.max(0, Math.min(status.noWebinarAvailable, parseInt(e.target.value) || 0)))}
                        className="w-full h-10 px-3 border border-purple-200 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                    />
                </div>
            </div>

            {/* GDO selection */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-purple-600 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-purple-50 border-purple-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-purple-600 border-ash-300 focus:ring-purple-500"
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
                <div className="bg-purple-100/60 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{total} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.). Lo split è calcolato separatamente per ciascun bucket.
                    </div>
                </div>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
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
                            {Object.entries(report.perGdo).filter(([, v]) => v.webinar + v.noWebinar > 0).map(([id, v]) => (
                                <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-purple-700">{v.webinar}W</strong> + <strong className="text-ash-700">{v.noWebinar}NW</strong>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
