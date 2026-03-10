'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TargetStatsResponse, MonthlyTargetInput, saveMonthlyTarget } from '@/app/actions/targetActions';
import { AlertCircle, Target, TrendingDown, TrendingUp, Calendar, CalendarDays, Activity } from 'lucide-react';

interface Props {
    initialData: TargetStatsResponse;
    selectedMonth: string;
    role: string;
}

export default function ManagerTargetsClient({ initialData, selectedMonth, role }: Props) {
    const router = useRouter();
    const [monthInput, setMonthInput] = useState(selectedMonth);
    const [isSaving, setIsSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    // Form State
    const [formData, setFormData] = useState<MonthlyTargetInput>({
        month: selectedMonth,
        targetAppFissati: initialData.targetData.targetAppFissati || 0,
        targetAppConfermati: initialData.targetData.targetAppConfermati || 0,
        targetTrattative: initialData.targetData.targetTrattative || 0,
        targetClosed: initialData.targetData.targetClosed || 0,
        targetValoreContratti: initialData.targetData.targetValoreContratti || 0,
    });

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMonthInput(e.target.value);
        router.push(`/manager-targets?month=${e.target.value}`);
    };

    const handleSaveTargets = async () => {
        setIsSaving(true);
        try {
            await saveMonthlyTarget(formData);
            setDialogOpen(false);
            router.refresh(); // ricarica la pagina coi nuovi dati dal server
        } catch (error) {
            console.error("Failed to save target", error);
        } finally {
            setIsSaving(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount);
    };

    const formatPerc = (val: number) => {
        return val.toFixed(2) + '%';
    };

    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-slate-800 p-3 lg:p-4 text-left whitespace-nowrap border-b border-slate-700";
    const tdClass = "p-3 lg:p-4 border-b border-slate-100 text-sm font-medium text-slate-700";
    const tdLabelClass = "p-3 lg:p-4 border-b border-slate-100 text-sm font-bold text-orange-600 whitespace-nowrap"; // "Key Labels Arancio"

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">

            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                        <Target className="h-8 w-8 text-orange-600" />
                        Target & Previsioni
                    </h2>
                    <p className="text-slate-500 mt-1">Confronto Performance Attuali vs Target previsionali GDO</p>
                </div>

                <div className="flex items-center gap-4 bg-white p-2 rounded-lg border shadow-sm">
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-slate-500" />
                        <input
                            type="month"
                            value={monthInput}
                            onChange={handleMonthChange}
                            className="w-40 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                    <button
                        onClick={() => setDialogOpen(true)}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-orange-600 text-white hover:bg-orange-700 h-10 px-4 py-2"
                    >
                        Imposta Target
                    </button>
                    {dialogOpen && (
                        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                            <div className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-slate-200 bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
                                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                                    <h2 className="text-lg font-semibold leading-none tracking-tight">Imposta Target Mese - {monthInput}</h2>
                                    <p className="text-sm text-slate-500">Inserisci i target previsionali previsti per questo mese solare.</p>
                                </div>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tFissati" className="text-sm font-medium leading-none text-right">Fissati</label>
                                        <input id="tFissati" type="number" className="col-span-3 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2" value={formData.targetAppFissati} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetAppFissati: Number(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tConfermati" className="text-sm font-medium leading-none text-right">Confermati</label>
                                        <input id="tConfermati" type="number" className="col-span-3 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2" value={formData.targetAppConfermati} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetAppConfermati: Number(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tTrattative" className="text-sm font-medium leading-none text-right">Trattative</label>
                                        <input id="tTrattative" type="number" className="col-span-3 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2" value={formData.targetTrattative} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetTrattative: Number(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tClosed" className="text-sm font-medium leading-none text-right">Closed</label>
                                        <input id="tClosed" type="number" className="col-span-3 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2" value={formData.targetClosed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetClosed: Number(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tEur" className="text-sm font-medium leading-none text-right">Stima €</label>
                                        <input id="tEur" type="number" className="col-span-3 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2" value={formData.targetValoreContratti} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetValoreContratti: Number(e.target.value) })} />
                                    </div>
                                </div>
                                <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
                                    <button onClick={() => setDialogOpen(false)} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900 h-10 px-4 py-2 mt-2 sm:mt-0">Annulla</button>
                                    <button disabled={isSaving} onClick={handleSaveTargets} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-slate-900 text-slate-50 hover:bg-slate-900/90 h-10 px-4 py-2">Salva Cambiamenti</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Global Calendar Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm">
                    <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                        <h3 className="tracking-tight text-sm font-medium">Giorni Lavorativi Mese</h3>
                        <Calendar className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="p-6 pt-0">
                        <div className="text-2xl font-bold text-slate-900">{initialData.giorniLavorativiTotaliMese}</div>
                        <p className="text-xs text-slate-400 mt-1">Domeniche Escluse</p>
                    </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm">
                    <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                        <h3 className="tracking-tight text-sm font-medium">Giorni Trascorsi</h3>
                        <Activity className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="p-6 pt-0">
                        <div className="text-2xl font-bold text-orange-600">{initialData.giorniLavorativiTrascorsiOggi}</div>
                        <p className="text-xs text-slate-400 mt-1">Fino a Oggi inclusa</p>
                    </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm">
                    <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                        <h3 className="tracking-tight text-sm font-medium">Forza Vendita Attiva</h3>
                        <Target className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="p-6 pt-0">
                        <div className="text-2xl font-bold text-slate-900">{initialData.gdoAttivi} GDO</div>
                        <p className="text-xs text-slate-400 mt-1">Esclusi inattivi/sospesi</p>
                    </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm">
                    <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                        <h3 className="tracking-tight text-sm font-medium">Lead Totali Mese</h3>
                        <CalendarDays className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="p-6 pt-0">
                        <div className="text-2xl font-bold text-slate-900">{initialData.totaleLeadDelMese}</div>
                        <p className="text-xs text-slate-400 mt-1">Acquisiti nel CRM / Mese</p>
                    </div>
                </div>
            </div>

            {/* ALERT CRITICO */}
            {initialData.is7DaysAlertActive && (
                <div className="relative w-full rounded-lg border border-red-600 bg-red-50 text-red-900 p-4 [&>svg]:absolute [&>svg]:text-red-900 [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&:has(svg)]:pl-11">
                    <AlertCircle className="h-5 w-5" />
                    <h5 className="mb-1 font-bold leading-none tracking-tight text-lg">ATTENZIONE CRITICA</h5>
                    <div className="text-sm [&_p]:leading-relaxed">
                        Fissaggio sotto il <strong>-20%</strong> da 7 o più giorni lavorativi consecutivi. Primo drop il {initialData.dataPrimoMeno20}. Investigare le dinamiche dei lead e script al più presto.
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* TABELLA A: Numeri Mensili */}
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm overflow-hidden col-span-1 xl:col-span-2">
                    <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b">
                        <h3 className="font-semibold leading-none tracking-tight text-lg text-slate-800">1. Numeri Mensili</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className={thClass}>Metrica</th>
                                    <th className={thClass}>ACT</th>
                                    <th className={thClass}>ACT %</th>
                                    <th className={thClass}>TARGET/DAY</th>
                                    <th className={thClass}>TODAY</th>
                                    <th className={thClass}>TARGET PREV</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className={tdLabelClass}>Appuntamenti fissati</td>
                                    <td className={tdClass}>{initialData.actAppsFissati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercFissati)}</td>
                                    <td className={tdClass}>{initialData.targetDayFissati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayFissati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetAppFissati}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Appuntamenti Confermati</td>
                                    <td className={tdClass}>{initialData.actAppsConfermati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercConfermati)}</td>
                                    <td className={tdClass}>{initialData.targetDayConfermati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayConfermati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetAppConfermati}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Trattative presenziati</td>
                                    <td className={tdClass}>{initialData.actAppsPresenziati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercPresenziati)}</td>
                                    <td className={tdClass}>{initialData.targetDayPresenziati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayPresenziati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetTrattative}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Closed</td>
                                    <td className={tdClass}>{initialData.actClosed}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercClosed)}</td>
                                    <td className={tdClass}>{initialData.targetDayClosed.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayClosed}</td>
                                    <td className={tdClass}>{initialData.targetData.targetClosed}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Valore Contratti firmati</td>
                                    <td className={tdClass}>{formatCurrency(initialData.actValoreContratti)}</td>
                                    <td className={tdClass}>-</td>
                                    <td className={tdClass}>{formatCurrency(initialData.targetDayValoreContratti)}</td>
                                    <td className={tdClass}>-</td>
                                    <td className={tdClass}>{formatCurrency(initialData.targetData.targetValoreContratti)}</td>
                                </tr>
                                <tr className="bg-slate-50">
                                    <td className={tdLabelClass}>[EXTRA] Trattative su lead</td>
                                    <td className={tdClass} colSpan={5}>{formatPerc(initialData.trattativeSuLeadPerc)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* TABELLA B: DATO & FORECAST */}
                <div className="rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm overflow-hidden col-span-1 xl:col-span-2">
                    <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b">
                        <h3 className="font-semibold leading-none tracking-tight text-lg text-slate-800">2. Dato Operativo & Forecast</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className={thClass}>Metriche d'Allarme / Forecast</th>
                                    <th className={thClass}>Valore Attuale</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className={tdLabelClass}>Fissaggio (Variazione %)</td>
                                    <td className={tdClass}>
                                        <div className={`flex items-center gap-2 font-bold ${initialData.fissaggioVariazionePerc < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                            {initialData.fissaggioVariazionePerc < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                                            {formatPerc(initialData.fissaggioVariazionePerc)}
                                            <span className="text-xs text-slate-400 ml-2 font-normal">(Delta: {formatPerc(initialData.fissaggioVariazioneAss)})</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Data primo &lt;= -20%</td>
                                    <td className={tdClass}>
                                        {initialData.dataPrimoMeno20 ? (
                                            <span className="text-red-600 font-semibold flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4" />
                                                {initialData.dataPrimoMeno20}
                                            </span>
                                        ) : (
                                            <span className="text-green-600">Nessuna Deficit Rilevata o Assorbita</span>
                                        )}
                                    </td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Media app/day/GDO</td>
                                    <td className={tdClass}>{initialData.mediaAppDayGdo.toFixed(2)} appuntamenti</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Vendite/GDO (previste nel mese)</td>
                                    <td className={tdClass}>{initialData.mediaVenditePrevisteMeseGdo.toFixed(2)} chiusure / GDO</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    );
}
