"use client"
import { useState, useEffect } from "react"
import {
    getManagerOperativaData,
    getOperativaCostSettings,
    setOperativaCplEur,
    OperativaDataRow,
} from "@/app/actions/managerAdvancedActions"
import { useAuth } from "@/components/AuthProvider"
import { Activity, Euro, Pencil, Check, X } from "lucide-react"

const formatEuro = (n: number) => {
    if (!isFinite(n) || n <= 0) return '—'
    return '€ ' + n.toLocaleString('it-IT', { maximumFractionDigits: 0 })
}

export function ManagerOperativaBoard() {
    const { user } = useAuth()
    const isAdmin = (user?.user_metadata as any)?.role === 'ADMIN'

    const [period, setPeriod] = useState<'OGGI' | 'MESE' | 'TRIMESTRE'>('OGGI')
    const [data, setData] = useState<OperativaDataRow[]>([])
    const [loading, setLoading] = useState(true)

    const [cplEur, setCplEur] = useState<number>(9)
    const [costoOrarioGdoEur, setCostoOrarioGdoEur] = useState<number>(12.5)
    const [cplLoaded, setCplLoaded] = useState(false)
    const [editingCpl, setEditingCpl] = useState(false)
    const [cplDraft, setCplDraft] = useState<string>('9')
    const [savingCpl, setSavingCpl] = useState(false)
    const [cplError, setCplError] = useState<string | null>(null)

    useEffect(() => {
        let isMounted = true
        getOperativaCostSettings().then(s => {
            if (!isMounted) return
            setCplEur(s.cplEur)
            setCostoOrarioGdoEur(s.costoOrarioGdoEur)
            setCplDraft(String(s.cplEur))
            setCplLoaded(true)
        }).catch(() => { if (isMounted) setCplLoaded(true) })
        return () => { isMounted = false }
    }, [])

    useEffect(() => {
        let isMounted = true
        setLoading(true)
        getManagerOperativaData(period).then(res => {
            if (isMounted) {
                setData(res)
                setLoading(false)
            }
        }).catch(err => {
            console.error(err)
            if (isMounted) setLoading(false)
        })
        return () => { isMounted = false }
    }, [period, cplEur])

    const handleSaveCpl = async () => {
        const parsed = Number(cplDraft.replace(',', '.'))
        if (!isFinite(parsed) || parsed < 0) {
            setCplError('Inserisci un numero ≥ 0')
            return
        }
        setSavingCpl(true)
        setCplError(null)
        const res = await setOperativaCplEur(parsed)
        setSavingCpl(false)
        if (!res.success) {
            setCplError(res.error || 'Errore sconosciuto')
            return
        }
        setCplEur(res.cplEur ?? parsed)
        setEditingCpl(false)
    }

    const calculateTotals = () => {
        const t = {
            userId: 'total',
            userName: 'TOTALE / MEDIA REPARTO',
            oreLavorate: 0,
            chiamate: 0,
            risposte: 0,
            appuntamenti: 0,
            leadAssegnati: 0,
            leadNuoviAssegnati: 0,
            leadGestiti: 0,
            leadDB: 0,
            leadNuovi: 0,
            contrattiChiusi: 0,
            _countGdo: data.length
        }
        data.forEach(d => {
            t.oreLavorate += d.oreLavorate
            t.chiamate += d.chiamate
            t.risposte += d.risposte
            t.appuntamenti += d.appuntamenti
            t.leadAssegnati += d.leadAssegnati
            t.leadNuoviAssegnati += d.leadNuoviAssegnati
            t.leadGestiti += d.leadGestiti
            t.leadDB += d.leadDB
            t.leadNuovi += d.leadNuovi
            t.contrattiChiusi += d.contrattiChiusi
        })

        const formatPercent = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(1) + '%' : '0.0%'
        const formatHourly = (a: number, h: number) => h > 0 ? (a / h).toFixed(1) : '0.0'

        // Costi aggregati: stessa formula applicata sui totali (non media delle medie)
        const costoBaseAggr = costoOrarioGdoEur * t.oreLavorate + t.leadNuoviAssegnati * cplEur
        const costoPerAppAggr = t.appuntamenti > 0 ? costoBaseAggr / t.appuntamenti : 0
        const costoPerContrAggr = t.contrattiChiusi > 0 ? costoBaseAggr / t.contrattiChiusi : 0

        return {
            ...t,
            tassoRisposta: formatPercent(t.risposte, t.chiamate),
            chiamateOra: formatHourly(t.chiamate, t.oreLavorate),
            appOra: formatHourly(t.appuntamenti, t.oreLavorate),
            gestitiOra: formatHourly(t.leadGestiti, t.oreLavorate),
            fissaggioTotale: formatPercent(t.appuntamenti, t.leadGestiti),
            fissaggioNuovi: formatPercent(t.appuntamenti - (data.reduce((acc, d) => acc + (d.fissaggioDB > 0 || d.fissaggioNuovi > 0 ? d.appuntamenti * (d.fissaggioNuovi / (d.fissaggioNuovi + d.fissaggioDB || 1)) : d.appuntamenti), 0)), t.leadNuovi),
            costoPerAppuntamentoEur: costoPerAppAggr,
            costoPerContrattoEur: costoPerContrAggr,
        }
    }

    const t = calculateTotals()
    const showCostColumns = period === 'MESE' || period === 'TRIMESTRE'

    return (
        <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden mt-8">
            <div className="px-3 sm:px-6 py-4 sm:py-5 border-b border-ash-200/60 bg-gradient-to-r from-ash-50 to-ash-100/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2 text-ash-800">
                        <Activity className="h-6 w-6 text-brand-orange" />
                        Dashboard Operativa Aziendale
                    </h2>
                    <div className="text-sm text-ash-500 mt-1">
                        Monitoraggio volumi, tassi di risposta, appuntamenti e conversione oraria.
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex bg-ash-100/80 p-1 rounded-lg">
                    {(['OGGI', 'MESE', 'TRIMESTRE'] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${period === p ? 'bg-white shadow-soft text-brand-orange' : 'text-ash-500 hover:text-ash-700 hover:bg-ash-200/50'}`}
                        >
                            {p === 'OGGI' ? 'Oggi' : p === 'MESE' ? 'Questo Mese' : 'Trimestre (90 gg)'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Pannello costi (visibile in MESE/TRIMESTRE) */}
            {showCostColumns && cplLoaded && (
                <div className="px-3 sm:px-6 py-3 border-b border-ash-200/60 bg-amber-50/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm">
                    <div className="flex items-center gap-1.5 text-ash-700">
                        <Euro className="h-4 w-4 text-amber-600" />
                        <span className="font-semibold">Parametri Costo:</span>
                    </div>
                    <div className="text-ash-600">
                        Costo orario GDO: <span className="font-semibold text-ash-800">€ {costoOrarioGdoEur.toFixed(2)}/h</span>
                    </div>
                    <div className="flex items-center gap-2 text-ash-600">
                        <span>CPL (lead nuovi):</span>
                        {editingCpl && isAdmin ? (
                            <div className="flex items-center gap-1.5">
                                <span className="text-ash-500">€</span>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={cplDraft}
                                    onChange={e => setCplDraft(e.target.value)}
                                    className="w-20 px-2 py-1 border border-ash-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                    disabled={savingCpl}
                                    autoFocus
                                />
                                <button
                                    onClick={handleSaveCpl}
                                    disabled={savingCpl}
                                    className="p-1 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                                    title="Salva"
                                    type="button"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => { setEditingCpl(false); setCplDraft(String(cplEur)); setCplError(null) }}
                                    disabled={savingCpl}
                                    className="p-1 rounded-md bg-ash-100 text-ash-600 hover:bg-ash-200 disabled:opacity-50"
                                    title="Annulla"
                                    type="button"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-ash-800">€ {cplEur.toFixed(2)}</span>
                                {isAdmin && (
                                    <button
                                        onClick={() => { setEditingCpl(true); setCplDraft(String(cplEur)); setCplError(null) }}
                                        className="p-1 rounded-md text-ash-400 hover:text-amber-600 hover:bg-amber-100"
                                        title="Modifica CPL (admin)"
                                        type="button"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {cplError && (
                        <div className="text-xs text-red-600">{cplError}</div>
                    )}
                    <div className="text-ash-500 italic ml-auto">
                        Formula: (€{costoOrarioGdoEur.toFixed(1)} × ore + lead nuovi × CPL) / appuntamenti o chiusure
                    </div>
                </div>
            )}

            <div className="p-0 overflow-x-auto">
                {loading ? (
                    <div className="p-12 flex flex-col justify-center items-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange"></div>
                        <div className="text-sm text-ash-400">Caricamento dati...</div>
                    </div>
                ) : (
                    <table className="w-full text-left text-xs sm:text-sm text-ash-700 whitespace-nowrap">
                        <thead className="bg-gradient-to-r from-ash-50 to-ash-100/50 text-xs uppercase text-ash-500 font-semibold border-b border-ash-200/60">
                            {period === 'OGGI' ? (
                                <tr>
                                    <th className="px-6 py-4">GDO</th>
                                    <th className="px-4 py-4 text-center">Ore Lavorate</th>
                                    <th className="px-4 py-4 text-center">Chiamate / Ora</th>
                                    <th className="px-4 py-4 text-center">Chiamate</th>
                                    <th className="px-4 py-4 text-center">Risposte</th>
                                    <th className="px-4 py-4 text-center">Tasso Risp.</th>
                                    <th className="px-4 py-4 text-center bg-emerald-50/50 text-emerald-700">App. Fissati</th>
                                    <th className="px-4 py-4 text-center bg-ash-100/50 text-ash-800 font-bold">% Fissaggio</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th className="px-6 py-4">GDO</th>
                                    <th className="px-4 py-4 text-center">Lead Assegn.</th>
                                    <th className="px-4 py-4 text-center">Ore Lavorate</th>
                                    <th className="px-4 py-4 text-center">Chiamate</th>
                                    <th className="px-4 py-4 text-center">Tasso Risp.</th>
                                    <th className="px-4 py-4 text-center bg-emerald-50/50 text-emerald-700">Appuntamenti</th>
                                    <th className="px-4 py-4 text-center">Media App/Giorno</th>
                                    <th className="px-4 py-4 text-center">App / Ora</th>
                                    <th className="px-4 py-4 text-center">Gestiti / Ora</th>
                                    <th className="px-4 py-4 text-center">Di cui Nuovi / DB</th>
                                    <th className="px-4 py-4 text-center">% Fiss. Nuovi</th>
                                    <th className="px-4 py-4 text-center">% Fiss. DB</th>
                                    <th className="px-4 py-4 text-center bg-ash-100/50 text-ash-800 font-bold">% Fiss. Totale</th>
                                    <th className="px-4 py-4 text-center text-blue-700">N° Contratti</th>
                                    <th className="px-4 py-4 text-center bg-amber-50/60 text-amber-700" title="(€12.5 × ore + lead nuovi × CPL) / appuntamenti">Costo / App.</th>
                                    <th className="px-4 py-4 text-center bg-amber-50/60 text-amber-700" title="(€12.5 × ore + lead nuovi × CPL) / chiusure">Costo / Contratto</th>
                                </tr>
                            )}
                        </thead>
                        <tbody className="divide-y divide-ash-100/60">
                            {/* RIGA TOTALE AZIENDALE */}
                            <tr className="bg-gradient-to-r from-brand-charcoal to-ash-800 text-white font-semibold">
                                <td className="px-6 py-4">{t.userName}</td>
                                {period === 'OGGI' ? (
                                    <>
                                        <td className="px-4 py-4 text-center">{t.oreLavorate.toFixed(1)}h</td>
                                        <td className="px-4 py-4 text-center">{t.chiamateOra}</td>
                                        <td className="px-4 py-4 text-center">{t.chiamate}</td>
                                        <td className="px-4 py-4 text-center">{t.risposte}</td>
                                        <td className="px-4 py-4 text-center">{t.tassoRisposta}</td>
                                        <td className="px-4 py-4 text-center text-emerald-400">{t.appuntamenti}</td>
                                        <td className="px-4 py-4 text-center">{t.fissaggioTotale}</td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-4 py-4 text-center">{t.leadAssegnati}</td>
                                        <td className="px-4 py-4 text-center">{t.oreLavorate.toFixed(1)}h</td>
                                        <td className="px-4 py-4 text-center">{t.chiamate}</td>
                                        <td className="px-4 py-4 text-center">{t.tassoRisposta}</td>
                                        <td className="px-4 py-4 text-center text-emerald-400">{t.appuntamenti}</td>
                                        <td className="px-4 py-4 text-center">{(t.appuntamenti / (t.oreLavorate / 8 > 0 ? t.oreLavorate / 8 : 1)).toFixed(1)}</td>
                                        <td className="px-4 py-4 text-center">{t.appOra}</td>
                                        <td className="px-4 py-4 text-center">{t.gestitiOra}</td>
                                        <td className="px-4 py-4 text-center">{t.leadNuovi} / {t.leadDB}</td>
                                        <td className="px-4 py-4 text-center">-</td>
                                        <td className="px-4 py-4 text-center">-</td>
                                        <td className="px-4 py-4 text-center">{t.fissaggioTotale}</td>
                                        <td className="px-4 py-4 text-center text-blue-300">{t.contrattiChiusi}</td>
                                        <td className="px-4 py-4 text-center text-amber-300">{formatEuro(t.costoPerAppuntamentoEur)}</td>
                                        <td className="px-4 py-4 text-center text-amber-300">{formatEuro(t.costoPerContrattoEur)}</td>
                                    </>
                                )}
                            </tr>

                            {/* RIGHE GDO */}
                            {data.map((d) => (
                                <tr key={d.userId} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                    <td className="px-6 py-4 font-medium text-ash-800">{d.userName}</td>
                                    {period === 'OGGI' ? (
                                        <>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.oreLavorate.toFixed(1)}h</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{(d.oreLavorate > 0 ? d.chiamate / d.oreLavorate : 0).toFixed(1)}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.chiamate}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.risposte}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.tassoRisposta}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-emerald-600 bg-emerald-50/30">{d.appuntamenti}</td>
                                            <td className="px-4 py-4 text-center font-bold text-ash-800 bg-ash-50/50">{d.fissaggioTotale}%</td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.leadAssegnati}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.oreLavorate.toFixed(1)}h</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.chiamate}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.tassoRisposta}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-emerald-600 bg-emerald-50/30">{d.appuntamenti}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{(d.appuntamenti / (d.oreLavorate / 8 > 0 ? d.oreLavorate / 8 : 1)).toFixed(1)}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.appuntamentiOrari}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.leadGestitiOrari}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.leadNuovi} / {d.leadDB}</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.fissaggioNuovi}%</td>
                                            <td className="px-4 py-4 text-center text-ash-600">{d.fissaggioDB}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-ash-800 bg-ash-50/50">{d.fissaggioTotale}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-blue-600">{d.contrattiChiusi}</td>
                                            <td className="px-4 py-4 text-center font-semibold text-amber-700 bg-amber-50/30">{formatEuro(d.costoPerAppuntamentoEur)}</td>
                                            <td className="px-4 py-4 text-center font-semibold text-amber-700 bg-amber-50/30">{formatEuro(d.costoPerContrattoEur)}</td>
                                        </>
                                    )}
                                </tr>
                            ))}

                            {data.length === 0 && (
                                <tr>
                                    <td colSpan={period === 'OGGI' ? 8 : 16} className="px-6 py-8 text-center text-ash-400">
                                        Nessun dato registrato o operatori non attivi.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
