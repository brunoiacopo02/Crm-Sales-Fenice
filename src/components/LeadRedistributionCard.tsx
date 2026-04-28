"use client"

import { useEffect, useMemo, useState } from "react"
import {
    getActiveGdosForRedistribution,
    getRedistributionFunnels,
    getRedistributionPreview,
    executeLeadRedistribution,
    RedistributionMode,
    RedistributionSection,
    RedistributionPreviewResult,
} from "@/app/actions/redistributeLeadsActions"
import { useRouter } from "next/navigation"
import { Shuffle, Users, AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react"
import { useAuth } from "@/components/AuthProvider"

type Gdo = { id: string; name: string; displayName: string | null; isActive: boolean }

const SECTIONS: { value: RedistributionSection; label: string; hint: string }[] = [
    { value: '1', label: '1ª chiamata', hint: 'Mai chiamati (callCount = 0)' },
    { value: '2', label: '2ª chiamata', hint: 'Già chiamati 1 volta' },
    { value: '3', label: '3ª chiamata', hint: 'Già chiamati 2 volte' },
    { value: 'recall', label: 'Richiami', hint: 'Lead con data richiamo' },
]

export function LeadRedistributionCard() {
    const router = useRouter()
    const { user } = useAuth()
    const isAdmin = (user?.user_metadata as any)?.role === 'ADMIN'
    const [gdos, setGdos] = useState<Gdo[]>([])
    const [loadingGdos, setLoadingGdos] = useState(true)

    const [sourceGdoId, setSourceGdoId] = useState<string>('')
    const [section, setSection] = useState<RedistributionSection>('1')

    const [funnelsAvailable, setFunnelsAvailable] = useState<{ funnel: string; count: number }[]>([])
    const [selectedFunnels, setSelectedFunnels] = useState<string[] | null>(null) // null = tutti
    const [loadingFunnels, setLoadingFunnels] = useState(false)

    const [moveAll, setMoveAll] = useState(true)
    const [limitInput, setLimitInput] = useState<string>('10')

    const [mode, setMode] = useState<RedistributionMode>('equal')
    const [targetGdoIds, setTargetGdoIds] = useState<string[]>([])
    const [customQuotas, setCustomQuotas] = useState<Record<string, number>>({})

    const [preview, setPreview] = useState<RedistributionPreviewResult | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    const [executing, setExecuting] = useState(false)
    const [resultMsg, setResultMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

    useEffect(() => {
        if (!isAdmin) { setLoadingGdos(false); return }
        getActiveGdosForRedistribution().then(rows => {
            setGdos(rows)
            setLoadingGdos(false)
        }).catch(() => setLoadingGdos(false))
    }, [isAdmin])

    // Quando cambia source o section, ricarica i funnel disponibili
    useEffect(() => {
        if (!sourceGdoId) {
            setFunnelsAvailable([])
            setSelectedFunnels(null)
            return
        }
        setLoadingFunnels(true)
        getRedistributionFunnels(sourceGdoId, section).then(rows => {
            setFunnelsAvailable(rows)
            setSelectedFunnels(null) // reset → tutti
            setLoadingFunnels(false)
        }).catch(() => setLoadingFunnels(false))
    }, [sourceGdoId, section])

    // Ricalcolo preview quando cambia qualcosa di rilevante
    useEffect(() => {
        if (!sourceGdoId || targetGdoIds.length === 0) {
            setPreview(null)
            return
        }
        const limit = moveAll ? null : (parseInt(limitInput) || 0)
        setPreviewLoading(true)
        getRedistributionPreview({
            sourceGdoId,
            section,
            funnels: selectedFunnels,
            limit,
            mode,
            targetGdoIds,
            customQuotas,
        }).then(res => {
            setPreview(res)
            setPreviewLoading(false)
        }).catch(() => setPreviewLoading(false))
    }, [sourceGdoId, section, selectedFunnels, moveAll, limitInput, mode, targetGdoIds, customQuotas])

    const eligibleTargets = useMemo(
        () => gdos.filter(g => g.id !== sourceGdoId && g.isActive),
        [gdos, sourceGdoId]
    )

    const toggleTarget = (id: string) => {
        setTargetGdoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    const toggleFunnel = (funnel: string) => {
        setSelectedFunnels(prev => {
            const current = prev === null ? funnelsAvailable.map(f => f.funnel) : [...prev]
            const idx = current.indexOf(funnel)
            if (idx >= 0) current.splice(idx, 1)
            else current.push(funnel)
            // Se tutti selezionati → torna a null (= "tutti", più pulito)
            if (current.length === funnelsAvailable.length) return null
            return current
        })
    }

    const allFunnelsSelected = selectedFunnels === null

    const handleExecute = async () => {
        if (!preview || preview.totalToMove === 0) return
        const moved = preview.totalToMove
        const sourceName = gdos.find(g => g.id === sourceGdoId)?.displayName || 'GDO'
        const targetNames = preview.perTarget.filter(t => t.count > 0).map(t => `${t.targetGdoName} (${t.count})`).join(', ')
        if (!confirm(`Confermi la ridistribuzione di ${moved} lead da ${sourceName}?\n\nDestinazione: ${targetNames}`)) return

        setExecuting(true)
        setResultMsg(null)
        const limit = moveAll ? null : (parseInt(limitInput) || 0)
        const res = await executeLeadRedistribution({
            sourceGdoId,
            section,
            funnels: selectedFunnels,
            limit,
            mode,
            targetGdoIds,
            customQuotas,
        })
        setExecuting(false)
        if (!res.success) {
            setResultMsg({ type: 'err', text: res.error || 'Errore sconosciuto' })
            return
        }
        setResultMsg({ type: 'ok', text: `Ridistribuiti ${res.moved ?? 0} lead.` })
        // Ricarica preview con nuovo stato
        setPreview(null)
        router.refresh()
    }

    if (!isAdmin) return null

    const sourceGdoName = gdos.find(g => g.id === sourceGdoId)?.displayName || ''
    const totalCustomQuota = useMemo(
        () => targetGdoIds.reduce((acc, id) => acc + (customQuotas[id] || 0), 0),
        [targetGdoIds, customQuotas]
    )

    return (
        <div className="bg-white rounded-lg border border-ash-200 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center gap-2 border-b pb-3">
                <Shuffle className="h-5 w-5 text-brand-orange" />
                <h3 className="font-semibold text-ash-800">Ridistribuisci lead esistenti</h3>
                <span className="text-xs text-ash-400 ml-2">Admin only</span>
            </div>

            <p className="text-xs text-ash-500">
                Sposta in blocco i lead di una sezione di un GDO verso uno o più colleghi.
                Lo stato del lead (callCount, recall, note) resta invariato.
            </p>

            {/* Step 1: GDO sorgente + sezione */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">GDO sorgente</label>
                    <select
                        value={sourceGdoId}
                        onChange={e => { setSourceGdoId(e.target.value); setTargetGdoIds([]); setCustomQuotas({}); setResultMsg(null) }}
                        disabled={loadingGdos}
                        className="w-full h-10 px-3 text-sm border border-ash-300 rounded-md focus:ring-brand-orange focus:border-brand-orange bg-white"
                    >
                        <option value="">— Scegli GDO —</option>
                        {gdos.map(g => (
                            <option key={g.id} value={g.id}>
                                {g.displayName || g.name}{!g.isActive ? ' (disattivo)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">Sezione</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {SECTIONS.map(s => (
                            <button
                                key={s.value}
                                onClick={() => setSection(s.value)}
                                type="button"
                                title={s.hint}
                                className={`px-3 py-2 text-sm rounded-md border transition-all ${
                                    section === s.value
                                        ? 'bg-brand-orange text-white border-brand-orange shadow-sm'
                                        : 'bg-white text-ash-700 border-ash-300 hover:border-brand-orange hover:text-brand-orange'
                                }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Step 2: Filtro funnel */}
            {sourceGdoId && (
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">
                        Filtro funnel <span className="text-ash-400 font-normal normal-case">(opzionale — di default tutti)</span>
                    </label>
                    {loadingFunnels ? (
                        <div className="text-xs text-ash-400 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Caricamento funnel…</div>
                    ) : funnelsAvailable.length === 0 ? (
                        <div className="text-xs text-ash-400 italic">Nessun lead nella sezione selezionata.</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setSelectedFunnels(null)}
                                className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                                    allFunnelsSelected
                                        ? 'bg-ash-800 text-white border-ash-800'
                                        : 'bg-white text-ash-600 border-ash-300 hover:border-ash-500'
                                }`}
                            >
                                Tutti ({funnelsAvailable.reduce((a, b) => a + b.count, 0)})
                            </button>
                            {funnelsAvailable.map(f => {
                                const checked = !allFunnelsSelected && selectedFunnels?.includes(f.funnel)
                                return (
                                    <button
                                        key={f.funnel}
                                        type="button"
                                        onClick={() => toggleFunnel(f.funnel)}
                                        className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                                            checked
                                                ? 'bg-brand-orange text-white border-brand-orange'
                                                : 'bg-white text-ash-600 border-ash-300 hover:border-brand-orange'
                                        }`}
                                    >
                                        {f.funnel} <span className="opacity-70">({f.count})</span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Step 3: Quanti */}
            {sourceGdoId && funnelsAvailable.length > 0 && (
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">Quanti lead spostare</label>
                    <div className="flex flex-wrap gap-3 items-center">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                checked={moveAll}
                                onChange={() => setMoveAll(true)}
                                className="text-brand-orange focus:ring-brand-orange"
                            />
                            <span className="text-sm text-ash-700">Tutti i match</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                checked={!moveAll}
                                onChange={() => setMoveAll(false)}
                                className="text-brand-orange focus:ring-brand-orange"
                            />
                            <span className="text-sm text-ash-700">Numero specifico</span>
                            <input
                                type="number"
                                min={1}
                                value={limitInput}
                                onChange={e => setLimitInput(e.target.value)}
                                disabled={moveAll}
                                className="w-20 h-8 px-2 text-sm border border-ash-300 rounded-md focus:ring-brand-orange focus:border-brand-orange disabled:bg-ash-100 disabled:text-ash-400"
                            />
                        </label>
                        <span className="text-xs text-ash-400">→ vengono presi i più nuovi prima</span>
                    </div>
                </div>
            )}

            {/* Step 4: Destinatari */}
            {sourceGdoId && funnelsAvailable.length > 0 && (
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">GDO destinatari</label>
                    <div className="flex flex-wrap gap-2">
                        {eligibleTargets.length === 0 ? (
                            <div className="text-xs text-ash-400 italic">Nessun altro GDO attivo disponibile.</div>
                        ) : eligibleTargets.map(g => {
                            const selected = targetGdoIds.includes(g.id)
                            return (
                                <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => toggleTarget(g.id)}
                                    className={`px-3 py-1.5 text-xs rounded-full border transition-all flex items-center gap-1.5 ${
                                        selected
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : 'bg-white text-ash-600 border-ash-300 hover:border-emerald-500'
                                    }`}
                                >
                                    {selected && <CheckCircle2 className="h-3 w-3" />}
                                    {g.displayName || g.name}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Step 5: Modalità + quote */}
            {sourceGdoId && targetGdoIds.length > 0 && (
                <div>
                    <label className="text-xs font-semibold text-ash-700 uppercase tracking-wider mb-2 block">Distribuzione</label>
                    <div className="flex bg-ash-100/80 p-1 rounded-lg w-fit border border-ash-200 mb-3">
                        <button
                            type="button"
                            onClick={() => setMode('equal')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                                mode === 'equal' ? 'bg-white shadow-sm text-ash-900' : 'text-ash-500 hover:text-ash-700'
                            }`}
                        >
                            Equa (round-robin)
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('custom_quota')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                                mode === 'custom_quota' ? 'bg-white shadow-sm text-ash-900' : 'text-ash-500 hover:text-ash-700'
                            }`}
                        >
                            Personalizzata
                        </button>
                    </div>
                    {mode === 'custom_quota' && (
                        <div className="bg-ash-50 border border-ash-200 rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center text-xs text-ash-500 mb-2">
                                <span>Imposta quanti lead per ogni GDO destinatario</span>
                                <span>
                                    Totale impostato: <strong className="text-ash-800">{totalCustomQuota}</strong>
                                    {preview && totalCustomQuota < preview.totalToMove && (
                                        <span className="ml-2 text-amber-600">+{preview.totalToMove - totalCustomQuota} round-robin</span>
                                    )}
                                </span>
                            </div>
                            {targetGdoIds.map(id => {
                                const g = gdos.find(x => x.id === id)
                                return (
                                    <div key={id} className="flex items-center justify-between bg-white rounded-md p-2 border border-ash-100">
                                        <span className="text-sm text-ash-700">{g?.displayName || g?.name}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            value={customQuotas[id] || 0}
                                            onChange={e => setCustomQuotas(prev => ({ ...prev, [id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            className="w-20 h-8 px-2 text-sm text-right border border-ash-300 rounded-md focus:ring-brand-orange focus:border-brand-orange"
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Preview + esecuzione */}
            {preview && targetGdoIds.length > 0 && (
                <div className="bg-ash-900 rounded-xl p-5 text-white shadow-xl">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-ash-700">
                        <span className="flex items-center gap-2 text-sm font-bold text-ash-100">
                            <Users className="h-4 w-4 text-brand-orange" /> Anteprima ridistribuzione
                        </span>
                        <span className="text-xs bg-ash-800 px-2 py-1 rounded text-ash-300">
                            {previewLoading ? '...' : `${preview.totalToMove} / ${preview.totalMatching} match`}
                        </span>
                    </div>
                    <div className="text-xs text-ash-400 mb-3 flex items-center gap-2">
                        <span className="font-medium text-white">{sourceGdoName}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span>{targetGdoIds.length} GDO destinatari</span>
                    </div>
                    <div className="space-y-2">
                        {preview.perTarget.map(t => (
                            <div key={t.targetGdoId} className="flex items-center justify-between text-sm py-1">
                                <span className="text-ash-300">{t.targetGdoName}</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-24 bg-ash-800 h-2 rounded-full overflow-hidden">
                                        <div
                                            className="bg-brand-orange h-full rounded-full transition-[width] duration-500"
                                            style={{ width: `${preview.totalToMove > 0 ? (t.count / preview.totalToMove) * 100 : 0}%` }}
                                        />
                                    </div>
                                    <span className="font-bold w-12 text-right">{t.count}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-ash-700 flex items-center justify-between">
                        {resultMsg && (
                            <div className={`text-xs flex items-center gap-1 ${resultMsg.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
                                {resultMsg.type === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                                {resultMsg.text}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={handleExecute}
                            disabled={executing || preview.totalToMove === 0 || previewLoading}
                            className="ml-auto flex items-center gap-2 px-5 py-2 rounded-md text-sm font-bold text-white bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 transition-all"
                        >
                            {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
                            {executing ? 'Spostamento in corso…' : `Sposta ${preview.totalToMove} lead`}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
