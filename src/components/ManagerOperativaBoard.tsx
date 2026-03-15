"use client"
import { useState, useEffect } from "react"
import { getManagerOperativaData, OperativaDataRow } from "@/app/actions/managerAdvancedActions"
import { Activity, Clock, Users, Calendar, BarChart3, TrendingUp } from "lucide-react"

export function ManagerOperativaBoard() {
    const [period, setPeriod] = useState<'OGGI' | 'MESE' | 'TRIMESTRE'>('OGGI')
    const [data, setData] = useState<OperativaDataRow[]>([])
    const [loading, setLoading] = useState(true)

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
    }, [period])

    const calculateTotals = () => {
        const t = {
            userId: 'total',
            userName: 'TOTALE / MEDIA REPARTO',
            oreLavorate: 0,
            chiamate: 0,
            risposte: 0,
            appuntamenti: 0,
            leadAssegnati: 0,
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
            t.leadGestiti += d.leadGestiti
            t.leadDB += d.leadDB
            t.leadNuovi += d.leadNuovi
            t.contrattiChiusi += d.contrattiChiusi
        })

        const formatPercent = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(1) + '%' : '0.0%'
        const formatHourly = (a: number, h: number) => h > 0 ? (a / h).toFixed(1) : '0.0'

        return {
            ...t,
            tassoRisposta: formatPercent(t.risposte, t.chiamate),
            chiamateOra: formatHourly(t.chiamate, t.oreLavorate),
            appOra: formatHourly(t.appuntamenti, t.oreLavorate),
            gestitiOra: formatHourly(t.leadGestiti, t.oreLavorate),
            fissaggioTotale: formatPercent(t.appuntamenti, t.leadGestiti),
            fissaggioNuovi: formatPercent(t.appuntamenti - (data.reduce((acc, d) => acc + (d.fissaggioDB > 0 || d.fissaggioNuovi > 0 ? d.appuntamenti * (d.fissaggioNuovi / (d.fissaggioNuovi + d.fissaggioDB || 1)) : d.appuntamenti), 0)), t.leadNuovi), // Approximation for UI
        }
    }

    const t = calculateTotals()

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-8">
            <div className="px-6 py-5 border-b border-gray-100 bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2 text-brand-charcoal">
                        <Activity className="h-6 w-6 text-brand-orange" />
                        Dashboard Operativa Aziendale
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Monitoraggio volumi, tassi di risposta, appuntamenti e conversione oraria.
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex bg-gray-200/60 p-1 rounded-lg">
                    {(['OGGI', 'MESE', 'TRIMESTRE'] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${period === p ? 'bg-white shadow-sm text-brand-orange' : 'text-gray-600 hover:bg-gray-200'}`}
                        >
                            {p === 'OGGI' ? 'Oggi' : p === 'MESE' ? 'Questo Mese' : 'Trimestre (90 gg)'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-0 overflow-x-auto">
                {loading ? (
                    <div className="p-12 flex justify-center items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange"></div>
                    </div>
                ) : (
                    <table className="w-full text-left text-sm text-gray-700 whitespace-nowrap">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold border-b">
                            {period === 'OGGI' ? (
                                <tr>
                                    <th className="px-6 py-4">GDO</th>
                                    <th className="px-4 py-4 text-center">Ore Lavorate</th>
                                    <th className="px-4 py-4 text-center">Chiamate / Ora</th>
                                    <th className="px-4 py-4 text-center">Chiamate</th>
                                    <th className="px-4 py-4 text-center">Risposte</th>
                                    <th className="px-4 py-4 text-center">Tasso Risp.</th>
                                    <th className="px-4 py-4 text-center bg-green-50 text-green-700">App. Fissati</th>
                                    <th className="px-4 py-4 text-center bg-gray-100 text-gray-800 font-bold">% Fissaggio</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th className="px-6 py-4">GDO</th>
                                    <th className="px-4 py-4 text-center">Lead Assegn.</th>
                                    <th className="px-4 py-4 text-center">Ore Lavorate</th>
                                    <th className="px-4 py-4 text-center">Chiamate</th>
                                    <th className="px-4 py-4 text-center">Tasso Risp.</th>
                                    <th className="px-4 py-4 text-center bg-green-50 text-green-700">Appuntamenti</th>
                                    <th className="px-4 py-4 text-center">Media App/Giorno</th>
                                    <th className="px-4 py-4 text-center">App / Ora</th>
                                    <th className="px-4 py-4 text-center">Gestiti / Ora</th>
                                    <th className="px-4 py-4 text-center">Di cui Nuovi / DB</th>
                                    <th className="px-4 py-4 text-center">% Fiss. Nuovi</th>
                                    <th className="px-4 py-4 text-center">% Fiss. DB</th>
                                    <th className="px-4 py-4 text-center bg-gray-100 text-gray-800 font-bold">% Fiss. Totale</th>
                                    <th className="px-4 py-4 text-center text-blue-700">N° Contratti</th>
                                </tr>
                            )}
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {/* RIGA TOTALE AZIENDALE */}
                            <tr className="bg-brand-charcoal text-white font-semibold">
                                <td className="px-6 py-4">{t.userName}</td>
                                {period === 'OGGI' ? (
                                    <>
                                        <td className="px-4 py-4 text-center">{t.oreLavorate.toFixed(1)}h</td>
                                        <td className="px-4 py-4 text-center">{t.chiamateOra}</td>
                                        <td className="px-4 py-4 text-center">{t.chiamate}</td>
                                        <td className="px-4 py-4 text-center">{t.risposte}</td>
                                        <td className="px-4 py-4 text-center">{t.tassoRisposta}</td>
                                        <td className="px-4 py-4 text-center text-green-400">{t.appuntamenti}</td>
                                        <td className="px-4 py-4 text-center">{t.fissaggioTotale}</td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-4 py-4 text-center">{t.leadAssegnati}</td>
                                        <td className="px-4 py-4 text-center">{t.oreLavorate.toFixed(1)}h</td>
                                        <td className="px-4 py-4 text-center">{t.chiamate}</td>
                                        <td className="px-4 py-4 text-center">{t.tassoRisposta}</td>
                                        <td className="px-4 py-4 text-center text-green-400">{t.appuntamenti}</td>
                                        <td className="px-4 py-4 text-center">{(t.appuntamenti / (t.oreLavorate / 8 > 0 ? t.oreLavorate / 8 : 1)).toFixed(1)}</td>
                                        <td className="px-4 py-4 text-center">{t.appOra}</td>
                                        <td className="px-4 py-4 text-center">{t.gestitiOra}</td>
                                        <td className="px-4 py-4 text-center">{t.leadNuovi} / {t.leadDB}</td>
                                        <td className="px-4 py-4 text-center">-</td>
                                        <td className="px-4 py-4 text-center">-</td>
                                        <td className="px-4 py-4 text-center">{t.fissaggioTotale}</td>
                                        <td className="px-4 py-4 text-center text-blue-300">{t.contrattiChiusi}</td>
                                    </>
                                )}
                            </tr>

                            {/* RIGHE GDO */}
                            {data.map((d) => (
                                <tr key={d.userId} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">{d.userName}</td>
                                    {period === 'OGGI' ? (
                                        <>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.oreLavorate.toFixed(1)}h</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{(d.oreLavorate > 0 ? d.chiamate / d.oreLavorate : 0).toFixed(1)}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.chiamate}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.risposte}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.tassoRisposta}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-green-600 bg-green-50/50">{d.appuntamenti}</td>
                                            <td className="px-4 py-4 text-center font-bold text-gray-800 bg-gray-50/50">{d.fissaggioTotale}%</td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.leadAssegnati}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.oreLavorate.toFixed(1)}h</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.chiamate}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.tassoRisposta}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-green-600 bg-green-50/50">{d.appuntamenti}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{(d.appuntamenti / (d.oreLavorate / 8 > 0 ? d.oreLavorate / 8 : 1)).toFixed(1)}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.appuntamentiOrari}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.leadGestitiOrari}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.leadNuovi} / {d.leadDB}</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.fissaggioNuovi}%</td>
                                            <td className="px-4 py-4 text-center text-gray-600">{d.fissaggioDB}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-gray-800 bg-gray-50/50">{d.fissaggioTotale}%</td>
                                            <td className="px-4 py-4 text-center font-bold text-blue-600">{d.contrattiChiusi}</td>
                                        </>
                                    )}
                                </tr>
                            ))}

                            {data.length === 0 && (
                                <tr>
                                    <td colSpan={period === 'OGGI' ? 8 : 14} className="px-6 py-8 text-center text-gray-500">
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
