'use client';

import { useEffect, useState } from 'react';
import { getGdoQualityReport, type GdoQualityReportResult, type QualityRow, type FunnelScope } from '@/app/actions/gdoCoachingReportActions';
import { X, Printer, Loader2 } from 'lucide-react';

interface Props {
    gdoId: string;
    gdoName: string;
    onClose: () => void;
}

function fmtPct(v: number | null): string {
    return v === null ? '—' : `${v.toFixed(1)}%`;
}

function fmtNum(v: number | null, digits = 2): string {
    return v === null ? '—' : v.toFixed(digits);
}

const SCOPES: { key: FunnelScope; label: string }[] = [
    { key: 'ALL', label: 'Tutti i funnel' },
    { key: 'NON_DATABASE', label: 'Solo lead nuovi' },
    { key: 'DATABASE', label: 'Solo Database' },
];

function KpiTable({ title, rows, showMix }: { title: string; rows: QualityRow[]; showMix: boolean }) {
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
                        <th className={thClass}>Chiamate</th>
                        <th className={thClass}>Media tent.</th>
                        <th className={thClass}>Fissati (% su lav.)</th>
                        <th className={thClass}>Confermati (% su esitati)</th>
                        <th className={thClass}>Scarti NR (%)</th>
                        <th className={thClass}>Scarti 1ª call (%)</th>
                        {showMix && <th className={thClass}>Mix Database</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className={`hover:bg-brand-orange-50/20 transition-colors ${i === 0 ? 'bg-ash-50/60' : ''}`}>
                            <td className={`${tdClass} font-bold ${i === 0 ? 'text-ash-500' : 'text-brand-orange-600'}`}>{r.label}</td>
                            <td className={tdClass}>{r.lavorati}</td>
                            <td className={tdClass}>{r.chiamate}</td>
                            <td className={tdClass}>{fmtNum(r.mediaTentativi)}</td>
                            <td className={tdClass}>{r.fissati} <span className="text-xs text-ash-400">({fmtPct(r.pctFissSuLavorati)})</span></td>
                            <td className={`${tdClass} font-semibold`}>
                                {r.confermati} <span className="text-xs text-ash-400">({fmtPct(r.pctConf)})</span>
                                {r.pendenti > 0 && (
                                    <span className="ml-1.5 text-xs font-normal text-amber-600" title="Fissati che le Conferme non hanno ancora esitato: esclusi dalla percentuale">
                                        +{r.pendenti} in attesa
                                    </span>
                                )}
                            </td>
                            <td className={tdClass}>{r.scartiNr} <span className="text-xs text-ash-400">({fmtPct(r.pctNr)})</span></td>
                            <td className={tdClass}>
                                {r.scarti1a} <span className="text-xs text-ash-400">({fmtPct(r.pctScarti1a)} su {r.primeChiamate})</span>
                            </td>
                            {showMix && <td className={tdClass}>{fmtPct(r.pctDatabase)}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function GdoQualityReportModal({ gdoId, gdoName, onClose }: Props) {
    const [data, setData] = useState<GdoQualityReportResult | null>(null);
    const [scope, setScope] = useState<FunnelScope>('ALL');

    useEffect(() => {
        let alive = true;
        setData(null);
        getGdoQualityReport(gdoId, scope).then(res => { if (alive) setData(res); });
        return () => { alive = false; };
    }, [gdoId, scope]);

    const todayStr = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
    const scopeLabel = SCOPES.find(s => s.key === scope)?.label ?? '';

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in print:bg-white print:p-0">
            <div className="gdo-report-print-area w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-ash-200/60 shadow-elevated p-6 space-y-5 print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:rounded-none">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-ash-800">Report qualità — {gdoName}</h2>
                        <div className="text-sm text-ash-500 mt-0.5">
                            KPI settimanali coaching (lun-dom) dal 20/07/2026 + baseline pre-piano. {scopeLabel}. Generato il {todayStr}.
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

                <div className="flex flex-wrap items-center gap-2 print:hidden">
                    <span className="text-xs font-semibold uppercase tracking-wider text-ash-500">Funnel</span>
                    <div className="inline-flex rounded-lg border border-ash-200 overflow-hidden">
                        {SCOPES.map(s => (
                            <button
                                key={s.key}
                                onClick={() => setScope(s.key)}
                                className={`px-3 h-8 text-sm font-medium transition-colors ${scope === s.key
                                    ? 'bg-brand-orange text-white'
                                    : 'bg-white text-ash-600 hover:bg-ash-50'}`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-ash-400">
                        I lead Database convertono in modo strutturalmente diverso dai lead nuovi: confronta le settimane a parità di funnel.
                    </span>
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
                        <KpiTable title={`Andamento ${gdoName}`} rows={data.rows} showMix={scope === 'ALL'} />
                        <KpiTable title="Media team (GDO attivi, bot escluso) — stesso periodo" rows={data.teamRows} showMix={scope === 'ALL'} />
                        <div className="text-xs text-ash-400 space-y-1">
                            <div>
                                <strong>Definizioni.</strong> Lavorati = lead distinti chiamati nel periodo. Chiamate = chiamate fatte nel periodo.
                                Media tent. = chiamate / lavorati. Fissati = per data di fissaggio.
                                Scarti 1ª call = lead al loro primo contatto in assoluto scartati proprio a quella chiamata (il denominatore è il numero di primi contatti, indicato accanto).
                            </div>
                            <div>
                                <strong>Confermati e Scarti NR</strong> sono l&apos;esito che le Conferme hanno dato agli appuntamenti fissati nel periodo.
                                La percentuale è calcolata sui soli appuntamenti <em>già esitati</em>: quelli ancora in attesa sono indicati a parte e non contano come mancate conferme.
                                Sulla settimana in corso è normale vedere quasi tutto in attesa. &quot;Scarti NR&quot; comprende sia 3 NR sia 4 NR consecutivi.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
