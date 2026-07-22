'use client';

import { useEffect, useState } from 'react';
import { getGdoQualityReport, type GdoQualityReportResult, type QualityRow } from '@/app/actions/gdoCoachingReportActions';
import { X, Printer, Loader2 } from 'lucide-react';

interface Props {
    gdoId: string;
    gdoName: string;
    onClose: () => void;
}

function fmtPct(v: number | null): string {
    return v === null ? '-' : `${v.toFixed(1)}%`;
}

function fmtNum(v: number | null, digits = 2): string {
    return v === null ? '-' : v.toFixed(digits);
}

function KpiTable({ title, rows }: { title: string; rows: QualityRow[] }) {
    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-gradient-to-r from-ash-800 to-brand-charcoal p-2.5 text-left whitespace-nowrap border-b border-ash-700";
    const tdClass = "p-2.5 border-b border-ash-100/60 text-sm text-ash-700 whitespace-nowrap";

    return (
        <div className="overflow-x-auto border border-ash-200/60 rounded-xl shadow-soft">
            <h4 className="font-semibold text-sm bg-gradient-to-r from-ash-50 to-ash-100/50 p-3 border-b border-ash-200/60 text-ash-700">{title}</h4>
            <table className="w-full text-left">
                <thead>
                    <tr>
                        <th className={thClass}>Periodo</th>
                        <th className={thClass}>Lavorati</th>
                        <th className={thClass}>Fissati (% su lav.)</th>
                        <th className={thClass}>Confermati (% su fiss.)</th>
                        <th className={thClass}>Scarti 3NR (%)</th>
                        <th className={thClass}>Media tent.</th>
                        <th className={thClass}>Scarti 1ª call (%)</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className={`hover:bg-brand-orange-50/20 transition-colors ${i === 0 ? 'bg-ash-50/60' : ''}`}>
                            <td className={`${tdClass} font-bold ${i === 0 ? 'text-ash-500' : 'text-brand-orange-600'}`}>{r.label}</td>
                            <td className={tdClass}>{r.lavorati}</td>
                            <td className={tdClass}>{r.fissati} <div className="inline text-xs text-ash-400">({fmtPct(r.pctFissSuLavorati)})</div></td>
                            <td className={`${tdClass} font-semibold`}>{r.confermati} <div className="inline text-xs text-ash-400">({fmtPct(r.pctConf)})</div></td>
                            <td className={tdClass}>{r.scarti3nr} <div className="inline text-xs text-ash-400">({fmtPct(r.pct3nr)})</div></td>
                            <td className={tdClass}>{fmtNum(r.mediaTentativi)}</td>
                            <td className={tdClass}>{fmtPct(r.pctScarti1a)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function GdoQualityReportModal({ gdoId, gdoName, onClose }: Props) {
    const [data, setData] = useState<GdoQualityReportResult | null>(null);

    useEffect(() => {
        let alive = true;
        getGdoQualityReport(gdoId).then(res => { if (alive) setData(res); });
        return () => { alive = false; };
    }, [gdoId]);

    const todayStr = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in print:bg-white print:p-0">
            <div className="gdo-report-print-area w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-ash-200/60 shadow-elevated p-6 space-y-5 print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:rounded-none">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-ash-800">Report qualità — {gdoName}</h2>
                        <div className="text-sm text-ash-500 mt-0.5">
                            KPI settimanali coaching (lun-dom) dal 20/07/2026 + baseline pre-piano. Generato il {todayStr}.
                        </div>
                    </div>
                    <div className="flex items-center gap-2 print:hidden">
                        <button
                            onClick={() => window.print()}
                            disabled={!data || !data.success}
                            className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium bg-brand-charcoal text-white hover:bg-ash-800 h-9 px-3 transition-all disabled:opacity-50"
                        >
                            <Printer className="w-4 h-4" /> Scarica PDF
                        </button>
                        <button onClick={onClose} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center rounded-lg">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {!data && (
                    <div className="flex items-center justify-center gap-2 p-12 text-ash-500">
                        <Loader2 className="w-5 h-5 animate-spin" /> Estrazione dati...
                    </div>
                )}

                {data && !data.success && (
                    <div className="p-6 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                        Errore nell'estrazione del report: {data.error}
                    </div>
                )}

                {data && data.success && (
                    <div className="space-y-5">
                        <KpiTable title={`Andamento ${gdoName}`} rows={data.rows} />
                        <KpiTable title="Media team (GDO attivi, bot escluso) — stesso periodo" rows={data.teamRows} />
                        <div className="text-xs text-ash-400">
                            Definizioni: Lavorati = lead con almeno 1 chiamata nel periodo (per data ultima chiamata). Fissati = per data di fissaggio.
                            Confermati e Scarti 3NR = esito della coorte dei fissati del periodo. Media tent. = media chiamate per lead lavorato.
                            Scarti 1ª call = lead scartati con una sola chiamata.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
