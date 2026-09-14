"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Rocket, RefreshCw, Send, Users, AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react"
import {
    getLancioPoolStatus,
    syncLancioPool,
    pushLancioPoolToBot,
    assignFromLancioPool,
    type LancioPoolStatus,
    type LancioSyncReport,
    type LancioPushReport,
    type LancioAssignReport,
} from "@/app/actions/lancioPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"
import { archiveLaunchPool } from "@/app/actions/databasePoolActions"
import { LANCIO_BUCKET } from "@/lib/lancio/intake"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

/** Quanti giri di push a lotti consecutivi al massimo per un click (~120 lead a giro). */
const MAX_PUSH_ROUNDS = 10

export function LancioPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<LancioPoolStatus | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [pushing, setPushing] = useState(false)
    const [pushRound, setPushRound] = useState(0)
    const [archiving, setArchiving] = useState(false)
    const [report, setReport] = useState<LancioAssignReport | null>(null)
    const [syncReport, setSyncReport] = useState<LancioSyncReport | null>(null)
    const [pushReport, setPushReport] = useState<LancioPushReport | null>(null)

    useEffect(() => {
        Promise.all([getLancioPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // undefined = loading, null = azienda ≠ Fenice o pool rimosso → card nascosta.
    // Resta visibile a pool vuoto: serve per il primo sync.
    if (status === undefined || status === null) return null

    const busy = loading || syncing || pushing || archiving
    const canSubmit = !busy && count > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(count / selectedGdoIds.size) : 0

    const refresh = async () => {
        const fresh = await getLancioPoolStatus()
        setStatus(fresh)
        router.refresh()
    }

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleSync = async () => {
        if (busy) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncLancioPool()
            setSyncReport(res)
            await refresh()
        } catch (e) {
            setSyncReport({ ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, senzaBot: 0, errors: ['Errore imprevisto durante il sync: ' + String(e)] })
        } finally {
            setSyncing(false)
        }
    }

    // Un click = piu' giri finche' remaining torna 0 o compare un errore:
    // ogni giro e' una server action da ~4 minuti, il resto lo dichiara lui.
    const handlePush = async () => {
        if (busy) return
        setPushing(true)
        setPushReport(null)
        const totale: LancioPushReport = { ok: true, candidati: 0, inviati: 0, remaining: 0, summary: {}, errors: [] }
        try {
            for (let round = 1; round <= MAX_PUSH_ROUNDS; round++) {
                setPushRound(round)
                const res = await pushLancioPoolToBot()
                totale.candidati = Math.max(totale.candidati, res.candidati)
                totale.inviati += res.inviati
                totale.remaining = res.remaining
                for (const [k, v] of Object.entries(res.summary)) totale.summary[k] = (totale.summary[k] ?? 0) + v
                totale.errors.push(...res.errors)
                totale.ok = totale.ok && res.ok
                totale.giaInCorso = res.giaInCorso
                setPushReport({ ...totale })
                // Si ferma anche a giro vuoto: `remaining > 0` con zero inviati
                // vuol dire che il giro non ha fatto un passo avanti (lock preso
                // da un altro, bot che rifiuta tutto). Rilanciare altre nove
                // volte non lo sbloccherebbe, brucerebbe solo candidati.
                if (!res.ok || res.remaining === 0 || res.inviati === 0) break
            }
            await refresh()
        } catch (e) {
            setPushReport({ ...totale, ok: false, errors: [...totale.errors, 'Errore imprevisto durante il push: ' + String(e)] })
        } finally {
            setPushing(false)
            setPushRound(0)
        }
    }

    const handleAssign = async () => {
        if (!canSubmit) return
        if (count > 100 && !confirm(`Stai per assegnare ${count} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromLancioPool({ count, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                setCount(0)
                await refresh()
            }
        } catch (e) {
            setReport({ ok: false, errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)], perGdo: {}, totalAssigned: 0 })
        } finally {
            setLoading(false)
        }
    }

    const handleArchive = async () => {
        if (busy || status.nelPool > 0) return
        if (!confirm("Rimuovere il pool del lancio da /import? I lead già assegnati e le loro statistiche restano intatti.")) return
        setArchiving(true)
        try {
            const res = await archiveLaunchPool(LANCIO_BUCKET)
            if (!res.ok) alert(res.error || 'Rimozione non riuscita.')
            else { setStatus(null); router.refresh() }
        } finally {
            setArchiving(false)
        }
    }

    const tiles: Array<{ label: string, value: number }> = [
        { label: 'Nel pool', value: status.nelPool },
        { label: 'Al bot', value: status.alBot },
        { label: 'Consegnati al bot', value: status.spinti },
        { label: 'Restituiti', value: status.restituiti },
        { label: 'Ai GDO', value: status.aiGdo },
    ]

    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl border-2 border-amber-300 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Rocket className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Lancio Web Dev AI 2026</h2>
                        <p className="text-xs text-ash-500">
                            Lista AC &quot;Lancio Web Developer AI&quot; — funnel Lancio Web Dev AI, i lead vanno al bot.
                            {' '}Ingresso automatico dal webhook:{' '}
                            <span className={status.intakeAttivo ? 'font-bold text-green-700' : 'font-bold text-red-700'}>
                                {status.intakeAttivo ? 'ACCESO' : 'SPENTO'}
                            </span>
                            {' '}(LANCIO_WEBDEV_INTAKE)
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleArchive}
                        disabled={busy || status.nelPool > 0}
                        title={status.nelPool > 0 ? "Assegna tutti i lead del pool per poter rimuovere la card" : "Rimuovi il pool da questa pagina"}
                        className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <Trash2 className="h-3.5 w-3.5" /> Rimuovi pool
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={busy}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {syncing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                            : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza lista lancio da ActiveCampaign</>}
                    </button>
                    <button
                        onClick={handlePush}
                        disabled={busy || status.alBot === 0 || !status.intakeAttivo}
                        title={!status.intakeAttivo
                            ? "Lancio spento (LANCIO_WEBDEV_INTAKE): accendi l'interruttore prima di spingere"
                            : status.alBot === 0 ? "Nessun lead assegnato al bot da spingere" : "Spinge al bot (30/min) i lead che non gli sono ancora arrivati"}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-white bg-amber-600 border border-amber-700 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {pushing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Push in corso (giro {pushRound})...</>
                            : <><Send className="h-3.5 w-3.5" /> Spingi al bot i mancanti</>}
                    </button>
                </div>
            </div>

            {!status.intakeAttivo && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        Lancio spento: il push al bot è disabilitato. Sincronizzazione e distribuzione ai GDO restano attive.
                    </div>
                </div>
            )}

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con avvisi'}
                        {' — '}{syncReport.imported} importati (al bot), {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (lista AC: {syncReport.totalOnList})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                    {syncReport.imported > 0 && <div className="mt-1">Ora premi &quot;Spingi al bot i mancanti&quot; per consegnarli.</div>}
                </div>
            )}

            {pushReport && (
                <div className={`p-3 rounded-lg border text-xs ${pushReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {pushReport.ok ? 'Push completato' : (pushReport.giaInCorso ? 'Push già in corso' : 'Push con avvisi')}
                        {' — '}{pushReport.inviati} inviati su {pushReport.candidati} da spingere, {pushReport.remaining} ancora da fare
                    </div>
                    <div>
                        {Object.entries(pushReport.summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </div>
                    {pushReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                    {pushReport.remaining > 0 && pushReport.ok && <div className="mt-1">Riclicca per continuare.</div>}
                </div>
            )}

            {/* Stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {tiles.map(t => (
                    <div key={t.label} className="bg-white rounded-lg border border-amber-100 p-3">
                        <p className="text-[10px] uppercase text-ash-500 tracking-wider font-semibold">{t.label}</p>
                        <p className="text-2xl font-black text-ash-900">{t.value}</p>
                    </div>
                ))}
            </div>

            {/* Quantità */}
            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead del pool distribuire ai GDO</label>
                <input
                    type="number"
                    min={0}
                    max={status.nelPool}
                    value={count}
                    disabled={status.nelPool === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(status.nelPool, parseInt(e.target.value) || 0)))}
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

            {count > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-amber-100/60 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{count} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
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
                                <div key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-amber-700">{v.count}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
