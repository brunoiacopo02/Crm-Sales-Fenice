'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GamificationTargetInput, saveGamificationRule } from '@/app/actions/gdoPerformanceActions';
import { Target, CalendarDays, DollarSign, Award, Trophy } from 'lucide-react';

interface Props {
    initialData: any[]; // getManagerGdoTables result
    selectedMonth: string;
    role: string;
}

export default function ManagerGdoClient({ initialData, selectedMonth, role }: Props) {
    const router = useRouter();
    const [monthInput, setMonthInput] = useState(selectedMonth);
    const [isSaving, setIsSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    const [formData, setFormData] = useState<GamificationTargetInput>({
        month: selectedMonth,
        targetTier1: 10,
        rewardTier1: 135,
        targetTier2: 13,
        rewardTier2: 270,
    });

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMonthInput(e.target.value);
        router.push(`/manager-gdo-performance?month=${e.target.value}`);
    };

    const handleSaveTargets = async () => {
        setIsSaving(true);
        try {
            await saveGamificationRule(formData);
            setDialogOpen(false);
            router.refresh();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-slate-800 p-3 text-left whitespace-nowrap border-b border-slate-700";
    const tdClass = "p-3 border-b border-slate-100 text-sm font-medium text-slate-700";
    const tdLabelClass = "p-3 border-b border-slate-100 text-sm font-bold text-orange-600 whitespace-nowrap";

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                        <Trophy className="h-8 w-8 text-orange-600" />
                        Performance GDO Settimanali
                    </h2>
                    <p className="text-slate-500 mt-1">Supervisione presenze e andamento progressivo per i Bonus Gamification.</p>
                </div>

                <div className="flex items-center gap-4 bg-white p-2 rounded-lg border shadow-sm">
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-slate-500" />
                        <input
                            type="month"
                            value={monthInput}
                            onChange={handleMonthChange}
                            className="w-40 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                        />
                    </div>
                    <button
                        onClick={() => setDialogOpen(true)}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-orange-600 text-white hover:bg-orange-700 h-10 px-4 py-2 shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                    >
                        Imposta Bonus Mensili
                    </button>

                    {dialogOpen && (
                        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
                            <div className="grid w-full max-w-lg gap-4 border border-slate-200 bg-white p-6 shadow-lg sm:rounded-lg">
                                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                                    <h2 className="text-lg font-semibold tracking-tight">Regole Tracker - {monthInput}</h2>
                                    <p className="text-sm text-slate-500">Definisci i livelli settimanali (Lunedì-Domenica) per sbloccare i bonus GDO.</p>
                                </div>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-2 gap-4 border p-4 rounded-xl bg-slate-50">
                                        <div className="space-y-2 col-span-2"><h4 className="font-bold text-slate-700 flex items-center gap-2"><Award className="w-4 h-4 text-slate-500" /> Tier 1 (Base)</h4></div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target (Presenziati)</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={formData.targetTier1} onChange={e => setFormData({ ...formData, targetTier1: Number(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Premio €</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={formData.rewardTier1} onChange={e => setFormData({ ...formData, rewardTier1: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 border border-orange-200 p-4 rounded-xl bg-orange-50">
                                        <div className="space-y-2 col-span-2"><h4 className="font-bold text-orange-700 flex items-center gap-2"><Trophy className="w-4 h-4 text-orange-500" /> Tier 2 (Pro)</h4></div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target (Presenziati)</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={formData.targetTier2} onChange={e => setFormData({ ...formData, targetTier2: Number(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Premio €</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={formData.rewardTier2} onChange={e => setFormData({ ...formData, rewardTier2: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex sm:justify-end gap-2">
                                    <button onClick={() => setDialogOpen(false)} className="rounded-md border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100">Annulla</button>
                                    <button disabled={isSaving} onClick={handleSaveTargets} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Salva Regole</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* List of GDO Cards */}
            <div className="space-y-8">
                {initialData.length === 0 && (
                    <div className="text-center p-12 bg-white rounded-xl border border-dashed border-slate-300">
                        Nessun dato GDO per il mese selezionato.
                    </div>
                )}
                {initialData.map((gdoData, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                        <div className="bg-slate-900 text-white p-4 border-b border-slate-800 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center font-bold text-lg shadow-inner">
                                {gdoData.gdoName.charAt(0)}
                            </div>
                            <h3 className="text-xl font-bold tracking-tight">{gdoData.gdoName}</h3>
                            <div className="ml-auto flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400">Lead Assegn.</span>
                                    <span className="font-bold text-white">{gdoData.leadAssegnati ?? 0}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400">% Fissaggio</span>
                                    <span className="font-bold text-orange-400">{gdoData.percFissaggio ?? '-'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-0 lg:p-6 grid grid-cols-1 xl:grid-cols-2 gap-8">

                            {/* TABELLA A: Spaccato Funnel */}
                            <div className="overflow-x-auto border rounded-lg shadow-sm">
                                <h4 className="font-semibold text-sm bg-slate-50 p-3 border-b text-slate-700">Performance Absolute Mese</h4>
                                <table className="w-full text-left">
                                    <thead>
                                        <tr>
                                            <th className={thClass}>Funnel</th>
                                            <th className={thClass}>Fissati</th>
                                            <th className={thClass}>Conf.</th>
                                            <th className={thClass}>Pres.</th>
                                            <th className={thClass}>Closed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {gdoData.funnelRows.map((fr: any, i: number) => (
                                            <tr key={i} className="hover:bg-slate-50">
                                                <td className={tdLabelClass}>{fr.funnel}</td>
                                                <td className={tdClass}>{fr.fissati}</td>
                                                <td className={tdClass}>{fr.confermati} <span className="text-xs text-slate-400">({fr.percConf})</span></td>
                                                <td className={tdClass}>{fr.presenziati} <span className="text-xs text-slate-400">({fr.percPres})</span></td>
                                                <td className={tdClass}>{fr.chiusi} <span className="text-xs text-slate-400">({fr.percClosed})</span></td>
                                            </tr>
                                        ))}
                                        <tr className="bg-orange-50 border-t-2 border-orange-200">
                                            <td className={`${tdLabelClass} text-orange-800`}>TOTALE</td>
                                            <td className="p-3 font-bold text-slate-900">{gdoData.totalRows.fissati}</td>
                                            <td className="p-3 font-bold text-slate-900">{gdoData.totalRows.confermati} <span className="text-xs font-normal">({gdoData.totalRows.percConf})</span></td>
                                            <td className="p-3 font-bold text-slate-900">{gdoData.totalRows.presenziati} <span className="text-xs font-normal">({gdoData.totalRows.percPres})</span></td>
                                            <td className="p-3 font-bold text-slate-900">{gdoData.totalRows.chiusi} <span className="text-xs font-normal">({gdoData.totalRows.percClosed})</span></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* TABELLA B: Andamento Settimanale (Gamification Base) */}
                            <div className="overflow-x-auto border rounded-lg shadow-sm">
                                <h4 className="font-semibold text-sm bg-slate-50 p-3 border-b text-slate-700">Storico Settimanale Fissaggi & Presenze</h4>
                                <table className="w-full text-left">
                                    <thead>
                                        <tr>
                                            <th className={thClass}>Stato</th>
                                            {gdoData.weekNames.map((wName: string, i: number) => (
                                                <th key={i} className={thClass}>{wName}</th>
                                            ))}
                                            <th className={thClass}>TOT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {gdoData.weeklyRows.map((wr: any, i: number) => {
                                            const total = wr.data.reduce((a: number, b: number) => a + b, 0);
                                            return (
                                                <tr key={i} className="hover:bg-slate-50">
                                                    <td className={tdLabelClass}>{wr.label}</td>
                                                    {wr.data.map((val: number, j: number) => (
                                                        <td key={j} className={`p-3 border-b border-slate-100 text-sm font-semibold text-center ${val > 0 ? (wr.label.includes('Presen') ? 'text-orange-600 bg-orange-50/50' : 'text-slate-800') : 'text-slate-300 font-normal'}`}>
                                                            {val}
                                                        </td>
                                                    ))}
                                                    <td className="p-3 border-b border-slate-100 font-bold bg-slate-50 text-center">{total}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>

                        </div>
                    </div>
                ))}
            </div>

        </div>
    );
}
