"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Database, RefreshCw, Users, AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react"
import {
    getDatabasePoolStats,
    syncDatabaseMonthPool,
    assignFromDatabasePool,
    archiveLaunchPool,
    type DatabasePoolRow,
    type DatabaseSyncReport,
    type DatabaseAssignReport,
} from "@/app/actions/databasePoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function fmtEur(v: number): string {
    return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function DatabasePoolSection() {
    const router = useRouter()
    // undefined = loading, null = azienda ≠ Fenice → sezione nascosta
    const [pools, setPools] = useState<DatabasePoolRow[] | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [syncMonth, setSyncMonth] = useState<string>('') // 'YYYY-MM' da <input type="month">
    const [syncing, setSyncing] = useState(false)
    const [syncReport, setSyncReport] = useState<DatabaseSyncReport | null>(null)
    const maxMonth = new Date().toISOString().slice(0, 7) // mese corrente: niente pool futuri

    const reload = async () => {
        const fresh = await getDatabasePoolStats()
        setPools(fresh)
    }

    useEffect(() => {
        Promise.all([getDatabasePoolStats(), getActiveGdosForImport()])
            .then(([p, g]) => { setPools(p); setGdos(g as GdoInfo[]) })
    }, [])

    if (pools === undefined || pools === null) return null

    const activePools = pools.filter(p => !p.archived)

    const handleSync = async () => {
        if (syncing || !syncMonth) return
        const [y, m] = syncMonth.split('-').map(Number)
        if (!confirm(`Sincronizzare da ActiveCampaign tutti i contatti creati a ${MESI_IT[m - 1]} ${y} (esclusi i già clienti)? L'operazione può durare qualche minuto.`)) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncDatabaseMonthPool(syncMonth)
            setSyncReport(res)
            await reload()
            router.refresh()
        } catch (e) {
            setSyncReport({
                ok: false, imported: 0, skippedClienti: 0, skippedExisting: 0,
                skippedNoPhone: 0, totalMonth: 0,
                errors: ['Errore imprevisto durante il sync: ' + String(e)],
            })
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl border-2 border-blue-300 shadow-sm p-6 space-y-5 mt-8">
            {/* Header + selettore mese */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                        <Database className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Database (ActiveCampaign)</h2>
                        <p className="text-xs text-ash-500">Contatti AC per mese di creazione, esclusi i già clienti. Provenienza: Database.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="month"
                        value={syncMonth}
                        onChange={(e) => setSyncMonth(e.target.value)}
                        max={maxMonth}
                        disabled={syncing}
                        className="h-9 px-2 border border-blue-200 rounded-lg text-xs focus:ring-blue-500 focus:border-blue-500 disabled:bg-ash-100"
                    />
                    <button
                        onClick={handleSync}
                        disabled={syncing || !syncMonth}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-blue-800 bg-blue-100 border border-blue-300 hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {syncing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                            : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza mese</>}
                    </button>
                </div>
            </div>

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con errori'}
                        {' — '}{syncReport.imported} importati, {syncReport.skippedClienti} esclusi perché clienti, {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (contatti del mese: {syncReport.totalMonth})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}

            {/* Mini tabella comparativa (tutti i pool, anche rimossi) */}
            {pools.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-blue-50 text-ash-600 uppercase tracking-wider text-[10px]">
                                <th className="px-3 py-2 text-left font-semibold">Mese</th>
                                <th className="px-3 py-2 text-right font-semibold">Totale</th>
                                <th className="px-3 py-2 text-right font-semibold">Assegnati</th>
                                <th className="px-3 py-2 text-right font-semibold">Disponibili</th>
                                <th className="px-3 py-2 text-right font-semibold">Chiamati</th>
                                <th className="px-3 py-2 text-right font-semibold">Fissati</th>
                                <th className="px-3 py-2 text-right font-semibold">Confermati</th>
                                <th className="px-3 py-2 text-right font-semibold">Chiusi</th>
                                <th className="px-3 py-2 text-right font-semibold">Fatturato</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pools.map(p => (
                                <tr key={p.bucket} className="border-t border-ash-100">
                                    <td className="px-3 py-2 font-semibold text-ash-800">
                                        <div className="flex items-center gap-2">
                                            {p.label}
                                            {p.archived && <span className="px-1.5 py-0.5 rounded bg-ash-100 text-ash-500 text-[10px] font-bold uppercase">Rimosso</span>}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">{p.totale.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.assegnati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-blue-700">{p.disponibili.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.chiamati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.fissati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.confermati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-green-700">{p.chiusi.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-green-700">{fmtEur(p.fatturatoEur)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activePools.length === 0 && (
                <p className="text-xs text-ash-500">Nessun pool attivo: scegli un mese e sincronizza da ActiveCampaign.</p>
            )}

            {activePools.map(p => (
                <DatabasePoolCard key={p.bucket} pool={p} gdos={gdos} onChanged={reload} />
            ))}
        </div>
    )
}

function DatabasePoolCard({ pool, gdos, onChanged }: { pool: DatabasePoolRow, gdos: GdoInfo[], onChanged: () => Promise<void> }) {
    const router = useRouter()
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [archiving, setArchiving] = useState(false)
    const [report, setReport] = useState<DatabaseAssignReport | null>(null)

    const canSubmit = !loading && !archiving && count > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(count / selectedGdoIds.size) : 0

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
        if (count > 100 && !confirm(`Stai per assegnare ${count} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromDatabasePool({ bucket: pool.bucket, count, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                setCount(0)
                await onChanged()
                router.refresh()
            }
        } catch (e) {
            setReport({ ok: false, errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)], perGdo: {}, totalAssigned: 0 })
        } finally {
            setLoading(false)
        }
    }

    const handleArchive = async () => {
        if (archiving || loading || pool.disponibili > 0) return
        if (!confirm(`Rimuovere il pool "${pool.label}"? I lead già assegnati e le loro statistiche restano intatte.`)) return
        setArchiving(true)
        try {
            const res = await archiveLaunchPool(pool.bucket)
            if (!res.ok) alert(res.error || 'Rimozione non riuscita.')
            else {
                await onChanged()
                router.refresh()
            }
        } finally {
            setArchiving(false)
        }
    }

    return (
        <div className="bg-white rounded-lg border border-blue-200 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-blue-600" />
                    <div>
                        <h3 className="text-sm font-bold text-ash-900">{pool.label}</h3>
                        <p className="text-xs text-ash-500"><strong className="text-blue-700">{pool.disponibili.toLocaleString('it-IT')}</strong> lead disponibili su {pool.totale.toLocaleString('it-IT')}</p>
                    </div>
                </div>
                <button
                    onClick={handleArchive}
                    disabled={archiving || loading || pool.disponibili > 0}
                    title={pool.disponibili > 0 ? "Assegna tutti i lead per poter rimuovere il pool" : "Rimuovi il pool da questa pagina"}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Rimuovi pool
                </button>
            </div>

            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead pescare dal pool</label>
                <input
                    type="number"
                    min={0}
                    max={pool.disponibili}
                    value={count}
                    disabled={pool.disponibili === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(pool.disponibili, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-blue-200 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-blue-700 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-blue-600 border-ash-300 focus:ring-blue-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && (
                        <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>
                    )}
                </div>
            </div>

            {count > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-blue-100/60 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{count} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            <div className="flex justify-end pt-1">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Esegui Assegnazione</>}
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
                                <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-blue-700">{v.count}</strong>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
