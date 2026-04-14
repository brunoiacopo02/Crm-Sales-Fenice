'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Calendar, TrendingUp, RefreshCw, X } from 'lucide-react';
import {
    getLeadOverview,
    setLeadMonthlyTarget,
    getSuggestedWorkingDays,
    type LeadOverviewResult,
} from '@/app/actions/panoramicaActions';

function formatPercent(v: number | null): string {
    if (v === null || v === undefined) return '—';
    return `${v.toFixed(2)}%`;
}

function formatMonthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
}

export function PanoramicaClient({ initialData }: { initialData: LeadOverviewResult }) {
    const router = useRouter();
    const [data, setData] = useState<LeadOverviewResult>(initialData);
    const [modalOpen, setModalOpen] = useState(false);

    const refresh = async () => {
        const ym = data.success ? data.yearMonth : undefined;
        const fresh = await getLeadOverview(ym);
        setData(fresh);
    };

    if (!data.success) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
                Errore: {data.error}
            </div>
        );
    }

    const { yearMonth, isConfigured, config, workingDaysElapsed, rows, totals } = data;

    return (
        <>
            {/* Header card with month + actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ash-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-brand-orange/10">
                        <Calendar className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div>
                        <div className="text-xs uppercase tracking-wider text-ash-500 font-semibold">Mese corrente</div>
                        <div className="text-base font-bold text-ash-800">{formatMonthLabel(yearMonth)}</div>
                    </div>
                    {isConfigured && config && (
                        <div className="ml-4 flex items-center gap-4 text-xs text-ash-600 border-l border-ash-200 pl-4">
                            <div>
                                <span className="text-ash-500">Giorni lav.</span>{' '}
                                <span className="font-bold text-ash-800">{workingDaysElapsed}</span>
                                <span className="text-ash-400">/{config.workingDays}</span>
                            </div>
                            <div>
                                <span className="text-ash-500">Target mensile</span>{' '}
                                <span className="font-bold text-ash-800">{(config.targetNuovi + config.targetDatabase).toLocaleString('it-IT')}</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={refresh}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ash-200 text-xs font-semibold text-ash-600 hover:bg-ash-50 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
                    </button>
                    <button
                        onClick={() => setModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-orange hover:brightness-110 transition-all"
                    >
                        <Settings className="w-3.5 h-3.5" /> {isConfigured ? 'Modifica target' : 'Imposta target'}
                    </button>
                </div>
            </div>

            {!isConfigured && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    ⚠️ Target mensile non ancora impostato. Clicca <b>&quot;Imposta target&quot;</b> per configurare
                    target mensile, giorni lavorativi e baseline iniziale del mese.
                </div>
            )}

            {/* Main table — matches the screenshot layout */}
            <div className="rounded-xl border border-ash-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-ash-200 bg-gradient-to-r from-ash-50 to-white">
                    <TrendingUp className="w-4 h-4 text-brand-orange" />
                    <h2 className="text-sm font-bold text-ash-800 uppercase tracking-wide">
                        Caricamento Lead — {formatMonthLabel(yearMonth)}
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[#1e3a5f] text-white">
                                <th className="px-4 py-2.5 text-left font-bold uppercase text-xs tracking-wider w-[110px]">Lead</th>
                                <th colSpan={2} className="px-4 py-2.5 text-center font-bold uppercase text-xs tracking-wider border-l border-white/20">ACT</th>
                                <th colSpan={2} className="px-4 py-2.5 text-center font-bold uppercase text-xs tracking-wider border-l border-white/20">Target</th>
                                <th className="px-4 py-2.5 text-center font-bold uppercase text-xs tracking-wider border-l border-white/20 w-[130px]">Aggiungere</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => {
                                const isTotale = row.label === 'Totale';
                                return (
                                    <tr key={row.label} className={isTotale ? 'bg-ash-50/50 font-bold border-t-2 border-ash-300' : 'hover:bg-ash-50/30 border-t border-ash-100'}>
                                        <td className="px-4 py-3 text-white font-bold bg-brand-orange">
                                            {row.label}
                                        </td>
                                        <td className="px-4 py-3 text-right text-ash-800 tabular-nums border-l border-ash-100">
                                            {row.actCount.toLocaleString('it-IT')}
                                        </td>
                                        <td className="px-4 py-3 text-right text-ash-600 tabular-nums">
                                            {isTotale
                                                ? totals.actDailyAvg.toLocaleString('it-IT')
                                                : formatPercent(row.actPercent)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-ash-800 tabular-nums border-l border-ash-100">
                                            {row.targetCount.toLocaleString('it-IT')}
                                        </td>
                                        <td className="px-4 py-3 text-right text-ash-600 tabular-nums">
                                            {isTotale
                                                ? totals.targetDailyAvg.toLocaleString('it-IT')
                                                : formatPercent(row.targetPercent)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-ash-800 tabular-nums border-l border-ash-100">
                                            {row.aggiungere === null ? '' : row.aggiungere.toLocaleString('it-IT')}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="px-5 py-2.5 bg-ash-50/50 border-t border-ash-100 text-[11px] text-ash-500">
                    ACT = Baseline + tutti i lead caricati nel CRM nel mese corrente
                    {' '}· Target proporzionale basato su {workingDaysElapsed}/{config?.workingDays || '?'} giorni lavorativi
                </div>
            </div>

            {modalOpen && (
                <TargetModal
                    yearMonth={yearMonth}
                    initialConfig={config}
                    onClose={() => setModalOpen(false)}
                    onSaved={() => {
                        setModalOpen(false);
                        refresh();
                    }}
                />
            )}
        </>
    );
}

function TargetModal({
    yearMonth,
    initialConfig,
    onClose,
    onSaved,
}: {
    yearMonth: string;
    initialConfig: NonNullable<Extract<LeadOverviewResult, { success: true }>['config']>| null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [isPending, startTransition] = useTransition();
    const [targetNuovi, setTargetNuovi] = useState<number>(initialConfig?.targetNuovi ?? 0);
    const [targetDatabase, setTargetDatabase] = useState<number>(initialConfig?.targetDatabase ?? 0);
    const [workingDays, setWorkingDays] = useState<number>(initialConfig?.workingDays ?? 0);
    const [baselineNuovi, setBaselineNuovi] = useState<number>(initialConfig?.baselineNuovi ?? 0);
    const [baselineDatabase, setBaselineDatabase] = useState<number>(initialConfig?.baselineDatabase ?? 0);
    const [error, setError] = useState<string>('');

    // If editing a fresh month with no config, prefill workingDays with the auto-computed value
    useEffect(() => {
        if (!initialConfig) {
            getSuggestedWorkingDays(yearMonth).then((wd) => {
                setWorkingDays(wd);
            });
        }
    }, [yearMonth, initialConfig]);

    function handleSave() {
        setError('');
        if (targetNuovi < 0 || targetDatabase < 0) {
            setError('Target non può essere negativo');
            return;
        }
        if (workingDays <= 0) {
            setError('I giorni lavorativi devono essere > 0');
            return;
        }
        if (baselineNuovi < 0 || baselineDatabase < 0) {
            setError('Baseline non può essere negativa');
            return;
        }

        startTransition(async () => {
            const res = await setLeadMonthlyTarget({
                yearMonth,
                targetNuovi,
                targetDatabase,
                workingDays,
                baselineNuovi,
                baselineDatabase,
            });
            if (res.success) {
                onSaved();
            } else {
                setError(res.error || 'Errore durante il salvataggio');
            }
        });
    }

    const monthLabel = formatMonthLabel(yearMonth);

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-ash-200 bg-gradient-to-r from-brand-orange/10 to-white flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-bold text-ash-800">Target mensile lead</h2>
                        <div className="text-xs text-ash-500">{monthLabel}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-ash-500 hover:bg-ash-100 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    {/* Target */}
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-ash-500 font-bold mb-2">Target mensile</div>
                        <div className="grid grid-cols-2 gap-3">
                            <LabeledInput label="Nuovi" value={targetNuovi} onChange={setTargetNuovi} />
                            <LabeledInput label="Database" value={targetDatabase} onChange={setTargetDatabase} />
                        </div>
                    </div>

                    <div>
                        <LabeledInput
                            label="Giorni lavorativi del mese"
                            value={workingDays}
                            onChange={setWorkingDays}
                            help="Auto-calcolato escludendo domeniche e festivi italiani. Modificabile."
                        />
                    </div>

                    {/* Baseline */}
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-ash-500 font-bold mb-1">Baseline mensile</div>
                        <div className="text-[11px] text-ash-500 mb-2 leading-relaxed">
                            Lead già caricati fino ad ora (es. su Excel o in passato nel CRM). Dal momento
                            in cui salvi, i nuovi lead caricati nel CRM verranno <b>sommati</b> a questa baseline.
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <LabeledInput label="Baseline Nuovi" value={baselineNuovi} onChange={setBaselineNuovi} />
                            <LabeledInput label="Baseline Database" value={baselineDatabase} onChange={setBaselineDatabase} />
                        </div>
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-ash-200 bg-ash-50 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-ash-600 hover:bg-ash-100 transition-colors"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isPending}
                        className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-brand-orange hover:brightness-110 disabled:opacity-50 transition-all"
                    >
                        {isPending ? 'Salvataggio...' : 'Salva'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function LabeledInput({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help?: string }) {
    return (
        <div>
            <label className="text-[10px] uppercase tracking-wider text-ash-500 font-bold block mb-1">
                {label}
            </label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value || '0', 10))}
                className="w-full px-3 py-2 rounded-lg border border-ash-200 text-sm text-ash-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/20 tabular-nums"
                min={0}
            />
            {help && <div className="mt-1 text-[10px] text-ash-400">{help}</div>}
        </div>
    );
}
