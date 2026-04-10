'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GamificationTargetInput, saveGamificationRule } from '@/app/actions/gdoPerformanceActions';
import { Target, CalendarDays, DollarSign, Award, Trophy, BookOpen } from 'lucide-react';

interface Props {
    initialData: any[]; // getManagerGdoTables result
    selectedMonth: string;
    role: string;
    scriptRates?: Record<string, { completionRate: number; scriptCompletedCount: number }>;
}

export default function ManagerGdoClient({ initialData, selectedMonth, role, scriptRates = {} }: Props) {
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

    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-gradient-to-r from-ash-800 to-brand-charcoal p-3 text-left whitespace-nowrap border-b border-ash-700";
    const tdClass = "p-3 border-b border-ash-100/60 text-sm font-medium text-ash-700";
    const tdLabelClass = "p-3 border-b border-ash-100/60 text-sm font-bold text-brand-orange-600 whitespace-nowrap";

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-ash-800 flex items-center gap-2">
                        <Trophy className="h-8 w-8 text-brand-orange" />
                        Performance GDO Settimanali
                    </h2>
                    <div className="text-ash-500 mt-1">Supervisione presenze e andamento progressivo per i Bonus Gamification.</div>
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
                        Imposta Bonus Mensili
                    </button>

                    {dialogOpen && (
                        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                            <div className="grid w-full max-w-lg gap-4 border border-ash-200/60 bg-white p-6 shadow-elevated rounded-2xl">
                                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                                    <h2 className="text-lg font-semibold tracking-tight text-ash-800">Regole Tracker - {monthInput}</h2>
                                    <div className="text-sm text-ash-500">Definisci i livelli settimanali (Lunedì-Domenica) per sbloccare i bonus GDO.</div>
                                </div>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-2 gap-4 border border-ash-200/60 p-4 rounded-xl bg-ash-50/50">
                                        <div className="space-y-2 col-span-2"><h4 className="font-bold text-ash-700 flex items-center gap-2"><Award className="w-4 h-4 text-ash-500" /> Tier 1 (Base)</h4></div>
                                        <div>
                                            <label className="text-xs font-semibold text-ash-500 uppercase tracking-wider">Target (Presenziati)</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={formData.targetTier1} onChange={e => setFormData({ ...formData, targetTier1: Number(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-ash-500 uppercase tracking-wider">Premio €</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={formData.rewardTier1} onChange={e => setFormData({ ...formData, rewardTier1: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 border border-brand-orange-200/60 p-4 rounded-xl bg-brand-orange-50/30">
                                        <div className="space-y-2 col-span-2"><h4 className="font-bold text-brand-orange-700 flex items-center gap-2"><Trophy className="w-4 h-4 text-brand-orange-500" /> Tier 2 (Pro)</h4></div>
                                        <div>
                                            <label className="text-xs font-semibold text-ash-500 uppercase tracking-wider">Target (Presenziati)</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={formData.targetTier2} onChange={e => setFormData({ ...formData, targetTier2: Number(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-ash-500 uppercase tracking-wider">Premio €</label>
                                            <input type="number" className="mt-1 flex h-10 w-full rounded-lg border border-ash-200/60 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30" value={formData.rewardTier2} onChange={e => setFormData({ ...formData, rewardTier2: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex sm:justify-end gap-2">
                                    <button onClick={() => setDialogOpen(false)} className="btn-ghost h-10 px-4 py-2 text-sm">Annulla</button>
                                    <button disabled={isSaving} onClick={handleSaveTargets} className="inline-flex items-center justify-center rounded-lg text-sm font-medium bg-brand-charcoal text-white hover:bg-ash-800 h-10 px-4 py-2 transition-all disabled:opacity-50">{isSaving ? 'Salvataggio...' : 'Salva Regole'}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* List of GDO Cards */}
            <div className="space-y-8">
                {initialData.length === 0 && (
                    <div className="text-center p-12 bg-white rounded-xl border border-dashed border-ash-300 text-ash-400">
                        Nessun dato GDO per il mese selezionato.
                    </div>
                )}
                {initialData.map((gdoData, idx) => (
                    <div key={idx} className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-hidden flex flex-col animate-fade-in" style={{ animationDelay: `${Math.min(idx * 80, 400)}ms`, animationFillMode: 'backwards' }}>
                        <div className="bg-gradient-to-r from-brand-charcoal to-ash-800 text-white p-4 border-b border-ash-700 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-orange to-brand-orange-600 flex items-center justify-center font-bold text-lg shadow-glow-orange">
                                {gdoData.gdoName.charAt(0)}
                            </div>
                            <h3 className="text-xl font-bold tracking-tight">{gdoData.gdoName}</h3>
                            <div className="ml-auto flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-1.5">
                                    <div className="text-ash-400">Lead Assegn.</div>
                                    <div className="font-bold text-white">{gdoData.leadAssegnati ?? 0}</div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="text-ash-400">% Fissaggio</div>
                                    <div className="font-bold text-brand-orange">{gdoData.percFissaggio ?? '-'}</div>
                                </div>
                                {(() => {
                                    const rate = gdoData.gdoId ? scriptRates[gdoData.gdoId] : undefined;
                                    const pct = rate?.completionRate ?? 0;
                                    const colorClass = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400';
                                    return (
                                        <div className="flex items-center gap-1.5">
                                            <BookOpen className="w-3.5 h-3.5 text-ash-400" />
                                            <div className="text-ash-400">% Script</div>
                                            <div className={`font-bold ${colorClass}`}>{rate ? `${pct}%` : '-'}</div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        <div className="p-0 lg:p-6 grid grid-cols-1 xl:grid-cols-2 gap-8">

                            {/* TABELLA A: Spaccato Funnel */}
                            <div className="overflow-x-auto border border-ash-200/60 rounded-xl shadow-soft">
                                <h4 className="font-semibold text-sm bg-gradient-to-r from-ash-50 to-ash-100/50 p-3 border-b border-ash-200/60 text-ash-700">Performance Absolute Mese</h4>
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
                                            <tr key={i} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                <td className={tdLabelClass}>{fr.funnel}</td>
                                                <td className={tdClass}>{fr.fissati}</td>
                                                <td className={tdClass}>{fr.confermati} <div className="inline text-xs text-ash-400">({fr.percConf})</div></td>
                                                <td className={tdClass}>{fr.presenziati} <div className="inline text-xs text-ash-400">({fr.percPres})</div></td>
                                                <td className={tdClass}>{fr.chiusi} <div className="inline text-xs text-ash-400">({fr.percClosed})</div></td>
                                            </tr>
                                        ))}
                                        <tr className="bg-brand-orange-50/30 border-t-2 border-brand-orange-200/60">
                                            <td className={`${tdLabelClass} text-brand-orange-800`}>TOTALE</td>
                                            <td className="p-3 font-bold text-ash-800">{gdoData.totalRows.fissati}</td>
                                            <td className="p-3 font-bold text-ash-800">{gdoData.totalRows.confermati} <div className="inline text-xs font-normal text-ash-400">({gdoData.totalRows.percConf})</div></td>
                                            <td className="p-3 font-bold text-ash-800">{gdoData.totalRows.presenziati} <div className="inline text-xs font-normal text-ash-400">({gdoData.totalRows.percPres})</div></td>
                                            <td className="p-3 font-bold text-ash-800">{gdoData.totalRows.chiusi} <div className="inline text-xs font-normal text-ash-400">({gdoData.totalRows.percClosed})</div></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* TABELLA B: Andamento Settimanale (Gamification Base) */}
                            <div className="overflow-x-auto border border-ash-200/60 rounded-xl shadow-soft">
                                <h4 className="font-semibold text-sm bg-gradient-to-r from-ash-50 to-ash-100/50 p-3 border-b border-ash-200/60 text-ash-700">Storico Settimanale Fissaggi & Presenze</h4>
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
                                                <tr key={i} className="hover:bg-brand-orange-50/20 transition-colors duration-200">
                                                    <td className={tdLabelClass}>{wr.label}</td>
                                                    {wr.data.map((val: number, j: number) => (
                                                        <td key={j} className={`p-3 border-b border-ash-100/60 text-sm font-semibold text-center ${val > 0 ? (wr.label.includes('Presen') ? 'text-brand-orange-600 bg-brand-orange-50/30' : 'text-ash-800') : 'text-ash-300 font-normal'}`}>
                                                            {val}
                                                        </td>
                                                    ))}
                                                    <td className="p-3 border-b border-ash-100/60 font-bold bg-ash-50/50 text-center text-ash-800">{total}</td>
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
