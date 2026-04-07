'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TargetStatsResponse, MonthlyTargetInput, saveMonthlyTarget } from '@/app/actions/targetActions';
import { updateVenditoreSalesTarget } from '@/app/actions/managerRpgActions';
import { AlertCircle, Target, TrendingDown, TrendingUp, Calendar, CalendarDays, Activity, UserCheck, Euro, Trophy, CheckCircle2, Settings } from 'lucide-react';

interface VenditoreTarget {
    id: string;
    name: string | null;
    displayName: string | null;
    email: string | null;
    isActive: boolean;
    salesTargetEur: number | null;
}

interface Props {
    initialData: TargetStatsResponse;
    selectedMonth: string;
    role: string;
    venditori: VenditoreTarget[];
}

const TABS = [
    { id: 'gdo', label: 'Target GDO', icon: Target },
    { id: 'conferme', label: 'Target Conferme', icon: CheckCircle2 },
    { id: 'venditori', label: 'Target Venditori', icon: UserCheck },
    { id: 'giorni', label: 'Giorni Lavorativi', icon: Calendar },
    { id: 'gamification', label: 'Regole Gamification', icon: Trophy },
] as const;

type TabId = typeof TABS[number]['id'];

export default function ManagerTargetsClient({ initialData, selectedMonth, role, venditori }: Props) {
    const router = useRouter();
    const [monthInput, setMonthInput] = useState(selectedMonth);
    const [isSaving, setIsSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<TabId>('gdo');

    // Venditori target state
    const [editingVenditoreId, setEditingVenditoreId] = useState<string | null>(null);
    const [editTargetValue, setEditTargetValue] = useState('');
    const [savingVenditoreId, setSavingVenditoreId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<MonthlyTargetInput>({
        month: selectedMonth,
        targetAppFissati: initialData.targetData.targetAppFissati || 0,
        targetAppConfermati: initialData.targetData.targetAppConfermati || 0,
        targetTrattative: initialData.targetData.targetTrattative || 0,
        targetClosed: initialData.targetData.targetClosed || 0,
        targetValoreContratti: initialData.targetData.targetValoreContratti || 0,
        workingDaysOverride: initialData.workingDaysOverride ?? null,
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
            router.refresh();
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

    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-gradient-to-r from-ash-800 to-brand-charcoal p-3 lg:p-4 text-left whitespace-nowrap border-b border-ash-700";
    const tdClass = "p-3 lg:p-4 border-b border-ash-100/60 text-sm font-medium text-ash-700";
    const tdLabelClass = "p-3 lg:p-4 border-b border-ash-100/60 text-sm font-bold text-brand-orange-600 whitespace-nowrap";

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full animate-fade-in">

            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-ash-800 flex items-center gap-2">
                        <Target className="h-8 w-8 text-brand-orange" />
                        Target & Previsioni
                    </h2>
                    <div className="text-ash-500 mt-1">Confronto Performance Attuali vs Target previsionali GDO</div>
                </div>

                <div className="flex items-center gap-4 bg-white/90 backdrop-blur-sm p-2 rounded-xl border border-ash-200/60 shadow-soft">
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-ash-500" />
                        <input
                            type="month"
                            value={monthInput}
                            onChange={handleMonthChange}
                            className="w-40 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30"
                        />
                    </div>
                    <button
                        onClick={() => setDialogOpen(true)}
                        className="btn-primary h-10 px-4 py-2 text-sm"
                    >
                        Imposta Target
                    </button>
                    {dialogOpen && (
                        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                            <div className="w-full max-w-lg gap-4 border border-ash-200/60 bg-white p-6 shadow-elevated rounded-2xl">
                                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                                    <h2 className="text-lg font-semibold leading-none tracking-tight text-ash-800">Imposta Target Mese - {monthInput}</h2>
                                    <div className="text-sm text-ash-500">Inserisci i target previsionali previsti per questo mese solare.</div>
                                </div>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <label htmlFor="tWorkingDays" className="text-sm font-medium leading-none text-right text-ash-600">Giorni Lav.</label>
                                        <div className="col-span-3 flex items-center gap-2">
                                            <input id="tWorkingDays" type="number" min="1" max="31" placeholder="Auto" className="flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm placeholder:text-ash-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={formData.workingDaysOverride ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, workingDaysOverride: e.target.value ? Number(e.target.value) : null })} />
                                            {formData.workingDaysOverride != null && (
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, workingDaysOverride: null })}
                                                    className="text-xs text-ash-500 hover:text-ember-500 whitespace-nowrap transition-colors"
                                                >
                                                    Reset Auto
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {[
                                        { id: 'tFissati', label: 'Fissati', key: 'targetAppFissati' },
                                        { id: 'tConfermati', label: 'Confermati', key: 'targetAppConfermati' },
                                        { id: 'tTrattative', label: 'Trattative', key: 'targetTrattative' },
                                        { id: 'tClosed', label: 'Closed', key: 'targetClosed' },
                                        { id: 'tEur', label: 'Stima €', key: 'targetValoreContratti' },
                                    ].map(field => (
                                        <div key={field.id} className="grid grid-cols-4 items-center gap-4">
                                            <label htmlFor={field.id} className="text-sm font-medium leading-none text-right text-ash-600">{field.label}</label>
                                            <input id={field.id} type="number" className="col-span-3 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={(formData as any)[field.key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, [field.key]: Number(e.target.value) })} />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-4">
                                    <button onClick={() => setDialogOpen(false)} className="btn-ghost h-10 px-4 py-2 text-sm mt-2 sm:mt-0">Annulla</button>
                                    <button disabled={isSaving} onClick={handleSaveTargets} className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all bg-brand-charcoal text-white hover:bg-ash-800 h-10 px-4 py-2 disabled:opacity-50">{isSaving ? 'Salvataggio...' : 'Salva Cambiamenti'}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex flex-wrap gap-2 bg-white/90 backdrop-blur-sm p-1.5 rounded-xl border border-ash-200/60 shadow-soft">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                                isActive
                                    ? 'bg-gradient-to-r from-brand-charcoal to-ash-800 text-white shadow-soft'
                                    : 'text-ash-500 hover:text-ash-700 hover:bg-ash-100/50'
                            }`}
                        >
                            <Icon className={`h-4 w-4 ${isActive ? 'text-brand-orange' : ''}`} />
                            <div className="hidden sm:block">{tab.label}</div>
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="animate-fade-in">

                {/* === TAB: Target GDO === */}
                {activeTab === 'gdo' && (
                    <div className="space-y-6">
                        {/* Global Calendar Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {[
                                { title: 'Giorni Lavorativi Mese', value: initialData.giorniLavorativiTotaliMese, subtitle: initialData.workingDaysOverride != null ? <div className="text-brand-orange-600 font-semibold">Override manuale</div> : 'Domeniche Escluse', icon: Calendar, iconColor: 'text-ash-400' },
                                { title: 'Giorni Trascorsi', value: initialData.giorniLavorativiTrascorsiOggi, subtitle: 'Fino a Oggi inclusa', icon: Activity, iconColor: 'text-brand-orange', valueColor: 'text-brand-orange' },
                                { title: 'Forza Vendita Attiva', value: `${initialData.gdoAttivi} GDO`, subtitle: 'Esclusi inattivi/sospesi', icon: Target, iconColor: 'text-ash-400' },
                                { title: 'Lead Totali Mese', value: initialData.totaleLeadDelMese, subtitle: 'Acquisiti nel CRM / Mese', icon: CalendarDays, iconColor: 'text-ash-400' },
                            ].map((card, i) => (
                                <div key={i} className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                    <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                        <h3 className="tracking-tight text-sm font-medium text-ash-600">{card.title}</h3>
                                        <card.icon className={`h-4 w-4 ${card.iconColor}`} />
                                    </div>
                                    <div className="p-6 pt-0">
                                        <div className={`text-2xl font-bold ${card.valueColor || 'text-ash-800'}`}>{card.value}</div>
                                        <div className="text-xs text-ash-400 mt-1">{card.subtitle}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ALERT CRITICO */}
                        {initialData.is7DaysAlertActive && (
                            <div className="relative w-full rounded-xl border border-ember-400 bg-gradient-to-r from-ember-50 to-ember-100/50 text-ember-900 p-4 pl-11 shadow-soft animate-fade-in">
                                <AlertCircle className="h-5 w-5 absolute left-4 top-4 text-ember-500" />
                                <h5 className="mb-1 font-bold leading-none tracking-tight text-lg">ATTENZIONE CRITICA</h5>
                                <div className="text-sm">
                                    Fissaggio sotto il <strong>-20%</strong> da 7 o più giorni lavorativi consecutivi. Primo drop il {initialData.dataPrimoMeno20}. Investigare le dinamiche dei lead e script al più presto.
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                            {/* TABELLA A: Numeri Mensili */}
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden col-span-1 xl:col-span-2">
                                <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                    <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                        <Target className="h-5 w-5 text-brand-orange" />
                                        1. Numeri Mensili
                                    </h3>
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
                                            {[
                                                { label: 'Appuntamenti fissati', act: initialData.actAppsFissati, perc: formatPerc(initialData.actPercFissati), dayTarget: initialData.targetDayFissati.toFixed(2), today: initialData.todayFissati, target: initialData.targetData.targetAppFissati },
                                                { label: 'Appuntamenti Confermati', act: initialData.actAppsConfermati, perc: formatPerc(initialData.actPercConfermati), dayTarget: initialData.targetDayConfermati.toFixed(2), today: initialData.todayConfermati, target: initialData.targetData.targetAppConfermati },
                                                { label: 'Trattative presenziati', act: initialData.actAppsPresenziati, perc: formatPerc(initialData.actPercPresenziati), dayTarget: initialData.targetDayPresenziati.toFixed(2), today: initialData.todayPresenziati, target: initialData.targetData.targetTrattative },
                                                { label: 'Closed', act: initialData.actClosed, perc: formatPerc(initialData.actPercClosed), dayTarget: initialData.targetDayClosed.toFixed(2), today: initialData.todayClosed, target: initialData.targetData.targetClosed },
                                            ].map((row, i) => (
                                                <tr key={i} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                    <td className={tdLabelClass}>{row.label}</td>
                                                    <td className={tdClass}>{row.act}</td>
                                                    <td className={tdClass}>{row.perc}</td>
                                                    <td className={tdClass}>{row.dayTarget}</td>
                                                    <td className={tdClass}>{row.today}</td>
                                                    <td className={tdClass}>{row.target}</td>
                                                </tr>
                                            ))}
                                            <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>Valore Contratti firmati</td>
                                                <td className={tdClass}>{formatCurrency(initialData.actValoreContratti)}</td>
                                                <td className={tdClass}>-</td>
                                                <td className={tdClass}>{formatCurrency(initialData.targetDayValoreContratti)}</td>
                                                <td className={tdClass}>-</td>
                                                <td className={tdClass}>{formatCurrency(initialData.targetData.targetValoreContratti)}</td>
                                            </tr>
                                            <tr className="bg-ash-50/50">
                                                <td className={tdLabelClass}>[EXTRA] Trattative su lead</td>
                                                <td className={tdClass} colSpan={5}>{formatPerc(initialData.trattativeSuLeadPerc)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* TABELLA B: DATO & FORECAST */}
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden col-span-1 xl:col-span-2">
                                <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                    <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                        <TrendingUp className="h-5 w-5 text-brand-orange" />
                                        2. Dato Operativo & Forecast
                                    </h3>
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
                                            <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>Fissaggio (Variazione %)</td>
                                                <td className={tdClass}>
                                                    <div className={`flex items-center gap-2 font-bold ${initialData.fissaggioVariazionePerc < 0 ? 'text-ember-500' : 'text-emerald-600'}`}>
                                                        {initialData.fissaggioVariazionePerc < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                                                        {formatPerc(initialData.fissaggioVariazionePerc)}
                                                        <div className="text-xs text-ash-400 ml-2 font-normal">(Delta: {formatPerc(initialData.fissaggioVariazioneAss)})</div>
                                                    </div>
                                                </td>
                                            </tr>
                                            <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>Data primo &lt;= -20%</td>
                                                <td className={tdClass}>
                                                    {initialData.dataPrimoMeno20 ? (
                                                        <div className="text-ember-600 font-semibold flex items-center gap-2">
                                                            <AlertCircle className="h-4 w-4" />
                                                            {initialData.dataPrimoMeno20}
                                                        </div>
                                                    ) : (
                                                        <div className="text-emerald-600">Nessuna Deficit Rilevata o Assorbita</div>
                                                    )}
                                                </td>
                                            </tr>
                                            <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>Media app/day/GDO</td>
                                                <td className={tdClass}>{initialData.mediaAppDayGdo.toFixed(2)} appuntamenti</td>
                                            </tr>
                                            <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>Vendite/GDO (previste nel mese)</td>
                                                <td className={tdClass}>{initialData.mediaVenditePrevisteMeseGdo.toFixed(2)} chiusure / GDO</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* === TAB: Target Conferme === */}
                {activeTab === 'conferme' && (
                    <div className="space-y-6">
                        {/* Conferme Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Appuntamenti Confermati</h3>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{initialData.actAppsConfermati}</div>
                                    <div className="text-xs text-ash-400 mt-1">su {initialData.targetData.targetAppConfermati} target previsti</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">% Raggiungimento</h3>
                                    <TrendingUp className="h-4 w-4 text-brand-orange" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className={`text-2xl font-bold ${initialData.actPercConfermati >= 100 ? 'text-emerald-600' : initialData.actPercConfermati >= 50 ? 'text-brand-orange' : 'text-ember-500'}`}>
                                        {formatPerc(initialData.actPercConfermati)}
                                    </div>
                                    <div className="text-xs text-ash-400 mt-1">Confermati vs Target</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Target / Giorno</h3>
                                    <CalendarDays className="h-4 w-4 text-ash-400" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{initialData.targetDayConfermati.toFixed(2)}</div>
                                    <div className="text-xs text-ash-400 mt-1">Conferme necessarie / giorno</div>
                                </div>
                            </div>
                        </div>

                        {/* Conferme Table */}
                        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden">
                            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    Metriche Conferme
                                </h3>
                                <div className="text-sm text-ash-500">Dettaglio performance del team Conferme per il mese selezionato</div>
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
                                        <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                            <td className={tdLabelClass}>Appuntamenti Confermati</td>
                                            <td className={tdClass}>{initialData.actAppsConfermati}</td>
                                            <td className={tdClass}>{formatPerc(initialData.actPercConfermati)}</td>
                                            <td className={tdClass}>{initialData.targetDayConfermati.toFixed(2)}</td>
                                            <td className={tdClass}>{initialData.todayConfermati}</td>
                                            <td className={tdClass}>{initialData.targetData.targetAppConfermati}</td>
                                        </tr>
                                        <tr className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                            <td className={tdLabelClass}>Trattative Presenziati</td>
                                            <td className={tdClass}>{initialData.actAppsPresenziati}</td>
                                            <td className={tdClass}>{formatPerc(initialData.actPercPresenziati)}</td>
                                            <td className={tdClass}>{initialData.targetDayPresenziati.toFixed(2)}</td>
                                            <td className={tdClass}>{initialData.todayPresenziati}</td>
                                            <td className={tdClass}>{initialData.targetData.targetTrattative}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* === TAB: Target Venditori === */}
                {activeTab === 'venditori' && (
                    <div className="space-y-6">
                        {/* Venditori Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Contratti Chiusi</h3>
                                    <Euro className="h-4 w-4 text-emerald-500" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{initialData.actClosed}</div>
                                    <div className="text-xs text-ash-400 mt-1">su {initialData.targetData.targetClosed} target previsti</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Valore Contratti</h3>
                                    <TrendingUp className="h-4 w-4 text-brand-orange" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-brand-orange">{formatCurrency(initialData.actValoreContratti)}</div>
                                    <div className="text-xs text-ash-400 mt-1">su {formatCurrency(initialData.targetData.targetValoreContratti)} target</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Venditori Attivi</h3>
                                    <UserCheck className="h-4 w-4 text-ash-400" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{venditori.filter(v => v.isActive).length}</div>
                                    <div className="text-xs text-ash-400 mt-1">Con target fatturato assegnato</div>
                                </div>
                            </div>
                        </div>

                        {/* Venditori Target Table */}
                        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden">
                            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                    <UserCheck className="h-5 w-5 text-brand-orange" />
                                    Target Fatturato Venditori
                                </h3>
                                <div className="text-sm text-ash-500">Imposta il target di fatturato mensile per ogni venditore</div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr>
                                            <th className={thClass}>Venditore</th>
                                            <th className={thClass}>Email</th>
                                            <th className={thClass}>Target Fatturato (€)</th>
                                            <th className={thClass}>Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {venditori.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="p-6 text-center text-ash-400">
                                                    Nessun venditore attivo trovato
                                                </td>
                                            </tr>
                                        )}
                                        {venditori.map(v => (
                                            <tr key={v.id} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdClass}>
                                                    <div className="font-semibold text-ash-800">
                                                        {v.displayName || v.name || 'N/D'}
                                                    </div>
                                                </td>
                                                <td className={tdClass}>
                                                    <div className="text-ash-500">{v.email || '-'}</div>
                                                </td>
                                                <td className={tdClass}>
                                                    {editingVenditoreId === v.id ? (
                                                        <div className="flex items-center gap-2">
                                                            <Euro className="h-4 w-4 text-ash-400" />
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="100"
                                                                value={editTargetValue}
                                                                onChange={(e) => setEditTargetValue(e.target.value)}
                                                                className="w-32 flex h-9 rounded-lg border border-ash-200/60 bg-white px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1">
                                                            {v.salesTargetEur != null ? (
                                                                <div className="font-semibold text-brand-orange-600">
                                                                    {formatCurrency(v.salesTargetEur)}
                                                                </div>
                                                            ) : (
                                                                <div className="text-ash-400 italic">Non impostato</div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={tdClass}>
                                                    {editingVenditoreId === v.id ? (
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                disabled={savingVenditoreId === v.id}
                                                                onClick={async () => {
                                                                    const val = parseFloat(editTargetValue);
                                                                    if (isNaN(val) || val < 0) return;
                                                                    setSavingVenditoreId(v.id);
                                                                    try {
                                                                        await updateVenditoreSalesTarget(v.id, val);
                                                                        setEditingVenditoreId(null);
                                                                        router.refresh();
                                                                    } catch (e) {
                                                                        console.error('Errore salvataggio target:', e);
                                                                    } finally {
                                                                        setSavingVenditoreId(null);
                                                                    }
                                                                }}
                                                                className="btn-primary h-8 px-3 text-sm"
                                                            >
                                                                {savingVenditoreId === v.id ? 'Salvo...' : 'Salva'}
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingVenditoreId(null)}
                                                                className="btn-ghost h-8 px-3 text-sm"
                                                            >
                                                                Annulla
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                setEditingVenditoreId(v.id);
                                                                setEditTargetValue(v.salesTargetEur != null ? String(v.salesTargetEur) : '');
                                                            }}
                                                            className="btn-ghost h-8 px-3 text-sm"
                                                        >
                                                            Modifica
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* === TAB: Giorni Lavorativi === */}
                {activeTab === 'giorni' && (
                    <div className="space-y-6">
                        {/* Working Days Summary */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Giorni Lavorativi Totali</h3>
                                    <Calendar className="h-4 w-4 text-brand-orange" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{initialData.giorniLavorativiTotaliMese}</div>
                                    <div className="text-xs text-ash-400 mt-1">
                                        {initialData.workingDaysOverride != null
                                            ? <div className="text-brand-orange-600 font-semibold">Override manuale attivo</div>
                                            : 'Calcolati automaticamente (dom. escluse)'
                                        }
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Giorni Trascorsi</h3>
                                    <Activity className="h-4 w-4 text-brand-orange" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-brand-orange">{initialData.giorniLavorativiTrascorsiOggi}</div>
                                    <div className="text-xs text-ash-400 mt-1">Fino a oggi inclusa</div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft group hover:shadow-card transition-all duration-200">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2 p-6">
                                    <h3 className="tracking-tight text-sm font-medium text-ash-600">Giorni Rimanenti</h3>
                                    <CalendarDays className="h-4 w-4 text-ash-400" />
                                </div>
                                <div className="p-6 pt-0">
                                    <div className="text-2xl font-bold text-ash-800">{Math.max(0, initialData.giorniLavorativiTotaliMese - initialData.giorniLavorativiTrascorsiOggi)}</div>
                                    <div className="text-xs text-ash-400 mt-1">Giorni lavorativi rimasti nel mese</div>
                                </div>
                            </div>
                        </div>

                        {/* Working Days Configuration */}
                        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden">
                            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                    <Settings className="h-5 w-5 text-brand-orange" />
                                    Configurazione Giorni Lavorativi
                                </h3>
                                <div className="text-sm text-ash-500">Override manuale dei giorni lavorativi o calcolo automatico (esclusione domeniche)</div>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-ash-700 mb-1">Modalità Corrente</div>
                                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                                            initialData.workingDaysOverride != null
                                                ? 'bg-brand-orange-50 text-brand-orange-700 border border-brand-orange-200'
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        }`}>
                                            {initialData.workingDaysOverride != null ? 'Override Manuale' : 'Calcolo Automatico'}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-sm text-ash-500">
                                    Per modificare i giorni lavorativi del mese, usa il pulsante <strong>&quot;Imposta Target&quot;</strong> in alto a destra. La prima voce del form permette di sovrascrivere il calcolo automatico dei giorni lavorativi.
                                </div>
                            </div>
                        </div>

                        {/* Daily Breakdown */}
                        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden">
                            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                    <Activity className="h-5 w-5 text-brand-orange" />
                                    Target Giornalieri Calcolati
                                </h3>
                                <div className="text-sm text-ash-500">Ripartizione giornaliera automatica basata sui giorni lavorativi del mese</div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr>
                                            <th className={thClass}>Metrica</th>
                                            <th className={thClass}>Target Mensile</th>
                                            <th className={thClass}>Target / Giorno</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { label: 'App. Fissati', target: initialData.targetData.targetAppFissati, daily: initialData.targetDayFissati.toFixed(2) },
                                            { label: 'App. Confermati', target: initialData.targetData.targetAppConfermati, daily: initialData.targetDayConfermati.toFixed(2) },
                                            { label: 'Trattative', target: initialData.targetData.targetTrattative, daily: initialData.targetDayPresenziati.toFixed(2) },
                                            { label: 'Closed', target: initialData.targetData.targetClosed, daily: initialData.targetDayClosed.toFixed(2) },
                                            { label: 'Valore Contratti', target: formatCurrency(initialData.targetData.targetValoreContratti), daily: formatCurrency(initialData.targetDayValoreContratti) },
                                        ].map((row, i) => (
                                            <tr key={i} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>{row.label}</td>
                                                <td className={tdClass}>{row.target}</td>
                                                <td className={tdClass}>{row.daily}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* === TAB: Regole Gamification === */}
                {activeTab === 'gamification' && (
                    <div className="space-y-6">
                        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden">
                            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-ash-50 to-ash-100/50 border-b border-ash-200/60">
                                <h3 className="font-semibold leading-none tracking-tight text-lg text-ash-800 flex items-center gap-2">
                                    <Trophy className="h-5 w-5 text-brand-orange" />
                                    Regole Gamification
                                </h3>
                                <div className="text-sm text-ash-500">Panoramica del sistema di incentivi e ricompense attivo nel CRM</div>
                            </div>
                            <div className="p-6 space-y-6">
                                {/* Coins Economy */}
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-ash-800 flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-brand-orange"></div>
                                        Economia Fenice Coins
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {[
                                            { action: 'Chiamata effettuata', coins: '1-2 FC' },
                                            { action: 'Appuntamento fissato', coins: '10-25 FC' },
                                            { action: 'Appuntamento confermato', coins: '15-30 FC' },
                                            { action: 'Contratto chiuso', coins: '50-100 FC' },
                                            { action: 'Streak giornaliera', coins: '5-20 FC bonus' },
                                            { action: 'Quest completata', coins: 'Variabile' },
                                        ].map((rule, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 bg-ash-50/50 rounded-lg border border-ash-100/60">
                                                <div className="text-sm text-ash-700">{rule.action}</div>
                                                <div className="text-sm font-semibold text-brand-orange-600">{rule.coins}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Level System */}
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-ash-800 flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
                                        Sistema Livelli & XP
                                    </h4>
                                    <div className="text-sm text-ash-600 leading-relaxed">
                                        Ogni azione completata nel CRM guadagna XP (Experience Points). Al raggiungimento di soglie XP l&apos;operatore sale di livello,
                                        sbloccando badge e ricompense nello Store. I livelli vanno da 1 (Novizio) a livelli avanzati con crescita progressiva della XP richiesta.
                                    </div>
                                </div>

                                {/* Store Tiers */}
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-ash-800 flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                                        Fasce Prezzo Store
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                        {[
                                            { tier: 'Comune', range: '50 - 200 FC', color: 'bg-ash-100 text-ash-700 border-ash-200' },
                                            { tier: 'Raro', range: '300 - 999 FC', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                                            { tier: 'Epico', range: '1.000 - 2.999 FC', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                                            { tier: 'Leggendario', range: '3.000+ FC', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                                        ].map((t, i) => (
                                            <div key={i} className={`p-3 rounded-lg border text-center ${t.color}`}>
                                                <div className="text-sm font-bold">{t.tier}</div>
                                                <div className="text-xs mt-1">{t.range}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Link to RPG Monitor */}
                                <div className="pt-2">
                                    <div className="text-sm text-ash-500">
                                        Per il monitoraggio dettagliato di livelli, coins e achievement di ogni operatore, visita la sezione{' '}
                                        <a href="/rpg-monitor" className="text-brand-orange hover:text-brand-orange-600 font-semibold underline underline-offset-2 transition-colors">
                                            RPG Monitor
                                        </a>.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
