'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Calendar, TrendingUp, RefreshCw, X, AlertTriangle, AlertCircle, CheckCircle2, Pencil } from 'lucide-react';
import {
    getLeadOverview,
    setLeadMonthlyTarget,
    getSuggestedWorkingDays,
    getFunnelOverview,
    setFunnelRow,
    type LeadOverviewResult,
    type FunnelOverviewResult,
    type FunnelOverviewRow,
    type FunnelStato,
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

export function PanoramicaClient({
    initialData,
    initialFunnelData,
}: {
    initialData: LeadOverviewResult;
    initialFunnelData: FunnelOverviewResult;
}) {
    const router = useRouter();
    const [data, setData] = useState<LeadOverviewResult>(initialData);
    const [funnelData, setFunnelData] = useState<FunnelOverviewResult>(initialFunnelData);
    const [modalOpen, setModalOpen] = useState(false);

    const refresh = async () => {
        const ym = data.success ? data.yearMonth : undefined;
        const [fresh, freshFunnel] = await Promise.all([
            getLeadOverview(ym),
            getFunnelOverview(ym),
        ]);
        setData(fresh);
        setFunnelData(freshFunnel);
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

            {/* Funnel table */}
            <FunnelSection data={funnelData} onRefresh={refresh} />

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

// ──────────────────────────────────────────────────────────────────────────
// Funnel table section
// ──────────────────────────────────────────────────────────────────────────

function StatoBadge({ stato }: { stato: FunnelStato }) {
    if (stato === 'ALLERT') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-700 border border-red-200">
                <AlertTriangle className="w-3 h-3" /> ALLERT
            </span>
        );
    }
    if (stato === 'PRE_RISK') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                <AlertCircle className="w-3 h-3" /> PRE_RISK
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> OK
        </span>
    );
}

function fmtPct(v: number | null): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return `${v.toFixed(2)}%`;
}

function fmtInt(n: number): string {
    return n.toLocaleString('it-IT');
}

function fmtEur(n: number): string {
    return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtRoas(n: number | null): string {
    if (n === null || !isFinite(n)) return '—';
    return `${n.toFixed(2)}x`;
}

function fmtDateShort(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function FunnelSection({ data, onRefresh }: { data: FunnelOverviewResult; onRefresh: () => void }) {
    const [editingRow, setEditingRow] = useState<FunnelOverviewRow | null>(null);

    if (!data.success) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Errore caricamento tabella funnel: {data.error}
            </div>
        );
    }

    const { yearMonth, rows, totals } = data;

    return (
        <div className="rounded-xl border border-ash-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-ash-200 bg-gradient-to-r from-ash-50 to-white">
                <TrendingUp className="w-4 h-4 text-brand-orange" />
                <h2 className="text-sm font-bold text-ash-800 uppercase tracking-wide">
                    Funnel Overview — {yearMonth}
                </h2>
                <span className="ml-auto text-[11px] text-ash-500">
                    Clicca la matita per modificare manualmente una riga
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-[#1e3a5f] text-white">
                            <th className="px-3 py-2.5 text-left font-bold uppercase text-[10px] tracking-wider">Funnel</th>
                            <th className="px-3 py-2.5 text-right font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Lead</th>
                            <th colSpan={2} className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">APP</th>
                            <th colSpan={2} className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Conferme</th>
                            <th colSpan={2} className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Trattative</th>
                            <th colSpan={2} className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Close</th>
                            <th className="px-3 py-2.5 text-right font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Fatturato</th>
                            <th className="px-3 py-2.5 text-right font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Spesa</th>
                            <th className="px-3 py-2.5 text-right font-bold uppercase text-[10px] tracking-wider border-l border-white/20">ROAS</th>
                            <th className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Data -1%</th>
                            <th className="px-3 py-2.5 text-center font-bold uppercase text-[10px] tracking-wider border-l border-white/20">Stato</th>
                            <th className="px-2 py-2.5 border-l border-white/20 w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.funnelName} className="border-t border-ash-100 hover:bg-ash-50/30 transition-colors">
                                <td className="px-3 py-2 text-white font-bold bg-brand-orange">{row.funnelName}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums font-semibold border-l border-ash-100">{fmtInt(row.leadCount)}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(row.appCount)}</td>
                                <td className="px-3 py-2 text-right text-ash-500 tabular-nums">{fmtPct(row.appPct)}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(row.confermeCount)}</td>
                                <td className="px-3 py-2 text-right text-ash-500 tabular-nums">{fmtPct(row.confermePct)}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(row.trattativeCount)}</td>
                                <td className="px-3 py-2 text-right text-ash-500 tabular-nums">{fmtPct(row.trattativePct)}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(row.closeCount)}</td>
                                <td className="px-3 py-2 text-right text-ash-500 tabular-nums">{fmtPct(row.closePct)}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{row.fatturatoEur > 0 ? fmtEur(row.fatturatoEur) : '—'}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100">{row.spesaEur > 0 ? fmtEur(row.spesaEur) : '—'}</td>
                                <td className="px-3 py-2 text-right text-ash-800 tabular-nums border-l border-ash-100 font-semibold">{fmtRoas(row.roas)}</td>
                                <td className="px-3 py-2 text-center text-ash-600 tabular-nums border-l border-ash-100">{fmtDateShort(row.dataPrimoSottoSoglia)}</td>
                                <td className="px-3 py-2 text-center border-l border-ash-100"><StatoBadge stato={row.statoSegnalazione} /></td>
                                <td className="px-2 py-2 text-center border-l border-ash-100">
                                    <button
                                        onClick={() => setEditingRow(row)}
                                        className="p-1 rounded hover:bg-ash-100 text-ash-500 hover:text-brand-orange transition-colors"
                                        title="Modifica riga"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={15} className="px-6 py-8 text-center text-ash-500 text-sm">
                                    Nessun funnel trovato per questo mese.
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-ash-300 bg-ash-50 font-bold">
                                <td className="px-3 py-2.5 text-ash-800">Totale</td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(totals.leadCount)}</td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(totals.appCount)}</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(totals.confermeCount)}</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(totals.trattativeCount)}</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtInt(totals.closeCount)}</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{totals.fatturatoEur > 0 ? fmtEur(totals.fatturatoEur) : '—'}</td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{totals.spesaEur > 0 ? fmtEur(totals.spesaEur) : '—'}</td>
                                <td className="px-3 py-2.5 text-right text-ash-800 tabular-nums border-l border-ash-100">{fmtRoas(totals.roas)}</td>
                                <td className="px-3 py-2.5 border-l border-ash-100"></td>
                                <td className="px-3 py-2.5 border-l border-ash-100"></td>
                                <td className="px-2 py-2.5 border-l border-ash-100"></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
            <div className="px-5 py-2.5 bg-ash-50/50 border-t border-ash-100 text-[11px] text-ash-500">
                ACT APP/Conferme/Trattative/Close = CRM live + delta baseline. Lead / Fatturato / Spesa sono assoluti editabili. ROAS = Fatturato ÷ Spesa. Stato auto-calcolato dalla % Close: OK se &gt; 1%, PRE_RISK appena scende sotto, ALLERT dopo 7 giorni.
            </div>

            {editingRow && (
                <FunnelEditModal
                    yearMonth={yearMonth}
                    row={editingRow}
                    onClose={() => setEditingRow(null)}
                    onSaved={() => {
                        setEditingRow(null);
                        onRefresh();
                    }}
                />
            )}
        </div>
    );
}

function FunnelEditModal({
    yearMonth,
    row,
    onClose,
    onSaved,
}: {
    yearMonth: string;
    row: FunnelOverviewRow;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [isPending, startTransition] = useTransition();
    const [leadCount, setLeadCount] = useState<number>(row.leadCount);
    const [appDisplay, setAppDisplay] = useState<number>(row.appCount);
    const [confermeDisplay, setConfermeDisplay] = useState<number>(row.confermeCount);
    const [trattativeDisplay, setTrattativeDisplay] = useState<number>(row.trattativeCount);
    const [closeDisplay, setCloseDisplay] = useState<number>(row.closeCount);
    const [fatturatoEur, setFatturatoEur] = useState<number>(row.fatturatoEur);
    const [spesaEur, setSpesaEur] = useState<number>(row.spesaEur);
    const [error, setError] = useState('');

    function handleSave() {
        setError('');
        if (leadCount < 0 || appDisplay < 0 || confermeDisplay < 0 || trattativeDisplay < 0 || closeDisplay < 0) {
            setError('I valori non possono essere negativi');
            return;
        }
        if (fatturatoEur < 0 || spesaEur < 0) {
            setError('Fatturato e spesa non possono essere negativi');
            return;
        }

        startTransition(async () => {
            const res = await setFunnelRow({
                yearMonth,
                funnelName: row.funnelName,
                leadCount,
                appDisplay,
                confermeDisplay,
                trattativeDisplay,
                closeDisplay,
                fatturatoEur,
                spesaEur,
            });
            if (res.success) onSaved();
            else setError(res.error || 'Errore salvataggio');
        });
    }

    const roasPreview = spesaEur > 0 ? fatturatoEur / spesaEur : null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-ash-200 bg-gradient-to-r from-brand-orange/10 to-white flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-bold text-ash-800">Modifica riga funnel</h2>
                        <div className="text-xs text-ash-500">{row.funnelName} — {yearMonth}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-ash-500 hover:bg-ash-100 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                        I valori APP/Conferme/Trattative/Close che imposti sono visualizzati come <b>totale finale</b>.
                        Il sistema calcola il delta rispetto al conteggio CRM live e mantiene il delta anche quando
                        nuovi lead vengono esitati → il counter continua a salire automaticamente.
                    </div>

                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-ash-500 font-bold mb-2">Totali di riga</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <LabeledInput label="Lead" value={leadCount} onChange={setLeadCount} />
                            <LabeledInput label="APP" value={appDisplay} onChange={setAppDisplay} />
                            <LabeledInput label="Conferme" value={confermeDisplay} onChange={setConfermeDisplay} />
                            <LabeledInput label="Trattative" value={trattativeDisplay} onChange={setTrattativeDisplay} />
                            <LabeledInput label="Close" value={closeDisplay} onChange={setCloseDisplay} />
                        </div>
                    </div>

                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-ash-500 font-bold mb-2">Economia funnel</div>
                        <div className="grid grid-cols-2 gap-3">
                            <LabeledInput label="Fatturato (€)" value={fatturatoEur} onChange={setFatturatoEur} step={1} />
                            <LabeledInput label="Spesa (€)" value={spesaEur} onChange={setSpesaEur} step={1} />
                        </div>
                        <div className="mt-2 text-[11px] text-ash-500">
                            ROAS calcolato:{' '}
                            <b className="text-ash-800">{roasPreview !== null && isFinite(roasPreview) ? `${roasPreview.toFixed(2)}x` : '—'}</b>
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

function LabeledInput({ label, value, onChange, help, step }: { label: string; value: number; onChange: (v: number) => void; help?: string; step?: number }) {
    return (
        <div>
            <label className="text-[10px] uppercase tracking-wider text-ash-500 font-bold block mb-1">
                {label}
            </label>
            <input
                type="number"
                value={value}
                onChange={(e) => {
                    const raw = e.target.value || '0';
                    const parsed = step ? parseFloat(raw) : parseInt(raw, 10);
                    onChange(isNaN(parsed) ? 0 : parsed);
                }}
                className="w-full px-3 py-2 rounded-lg border border-ash-200 text-sm text-ash-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/20 tabular-nums"
                min={0}
                step={step}
            />
            {help && <div className="mt-1 text-[10px] text-ash-400">{help}</div>}
        </div>
    );
}
