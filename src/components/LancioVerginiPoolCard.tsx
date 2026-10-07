"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, Users, AlertCircle, CheckCircle2, Loader2, Bot } from "lucide-react"
import {
    getLancioVerginiStatus,
    assignFromLancioVergini,
    giveLancioVerginiToBot,
    type LancioVerginiStatus,
    type LancioAssignReport,
    type LancioVerginiBotReport,
} from "@/app/actions/lancioPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

/**
 * Pool "Lead del lancio mai contattati dal bot" (PO 07/10/2026): i lead del
 * lancio a cui il bot non aveva ancora mandato il follow-up. Il TL li dà ai GDO
 * (come gli altri pool) oppure ne ridà N al bot, che manda loro il follow-up.
 */
export function LancioVerginiPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<LancioVerginiStatus | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [giving, setGiving] = useState(false)
    const [report, setReport] = useState<LancioAssignReport | null>(null)
    const [botReport, setBotReport] = useState<LancioVerginiBotReport | null>(null)

    useEffect(() => {
        Promise.all([getLancioVerginiStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    if (status === undefined || status === null) return null

    const busy = loading || giving
    const canAssign = !busy && count > 0 && selectedGdoIds.size > 0
    const canGive = !busy && count > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(count / selectedGdoIds.size) : 0

    const refresh = async () => {
        setStatus(await getLancioVerginiStatus())
        router.refresh()
    }

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }

    const handleAssign = async () => {
        if (!canAssign) return
        if (count > 100 && !confirm(`Stai per assegnare ${count} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        setBotReport(null)
        try {
            const res = await assignFromLancioVergini({ count, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) { setCount(0); await refresh() }
        } catch (e) {
            setReport({ ok: false, errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)], perGdo: {}, totalAssigned: 0 })
        } finally {
            setLoading(false)
        }
    }

    const handleGive = async () => {
        if (!canGive) return
        if (!confirm(`Ridare ${count} lead al bot? Il bot manderà loro il messaggio di follow-up al prossimo giro (9:00-18:30).`)) return
        setGiving(true)
        setReport(null)
        setBotReport(null)
        try {
            const res = await giveLancioVerginiToBot({ count })
            setBotReport(res)
            if (res.ok) { setCount(0); await refresh() }
        } catch (e) {
            setBotReport({ ok: false, errors: ['Errore imprevisto: ' + String(e)], ridati: 0, nonRipresi: 0 })
        } finally {
            setGiving(false)
        }
    }

    const tiles: Array<{ label: string, value: number }> = [
        { label: 'Nel pool', value: status.nelPool },
        { label: 'Dati ai GDO', value: status.aiGdo },
        { label: 'Ridati al bot', value: status.alBot },
    ]

    return (
        <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl border-2 border-emerald-300 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center gap-3 border-b border-emerald-100 pb-4">
                <div className="h-10 w-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                    <Sparkles className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-ash-900">Lead del lancio mai contattati dal bot</h2>
                    <p className="text-xs text-ash-500">
                        Lancio Web Dev AI: lead a cui il bot non ha mai mandato il follow-up dopo la live. Da chiamare per primi.
                        {' '}Il bot non li contatta finché non glieli ridai da qui.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                {tiles.map(t => (
                    <div key={t.label} className="bg-white rounded-lg border border-emerald-100 p-3">
                        <p className="text-[10px] uppercase text-ash-500 tracking-wider font-semibold">{t.label}</p>
                        <p className="text-2xl font-black text-ash-900">{t.value}</p>
                    </div>
                ))}
            </div>

            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead</label>
                <input
                    type="number"
                    min={0}
                    max={status.nelPool}
                    value={count}
                    disabled={status.nelPool === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(status.nelPool, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-emerald-200 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={() => setSelectedGdoIds(new Set(gdos.map(g => g.id)))} className="text-emerald-700 hover:underline font-medium">Tutti</button>
                        <button onClick={() => setSelectedGdoIds(new Set())} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-emerald-600 border-ash-300 focus:ring-emerald-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>}
                </div>
            </div>

            {count > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-emerald-100/60 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{count} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                    onClick={handleGive}
                    disabled={!canGive}
                    title="Il bot manda a questi lead il messaggio di follow-up al suo prossimo giro"
                    className="flex items-center gap-2 py-3 px-5 rounded-lg text-sm font-bold text-emerald-800 bg-white border-2 border-emerald-300 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {giving ? <><Loader2 className="h-4 w-4 animate-spin" /> In corso...</> : <><Bot className="h-4 w-4" /> Dai {count > 0 ? count : ''} al bot</>}
                </button>
                <button
                    onClick={handleAssign}
                    disabled={!canAssign}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Assegna ai GDO</>}
                </button>
            </div>

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
                                <div key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-emerald-700">{v.count}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {botReport && (
                <div className={`p-4 rounded-lg border text-xs ${botReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {botReport.ok ? `${botReport.ridati} lead ridati al bot: riceveranno il follow-up al prossimo giro` : 'Nessun lead ridato al bot'}
                    </div>
                    {botReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}
        </div>
    )
}
