'use client';

/**
 * Storico cicli bisettimanali GDO mostrato su /kpi-gdo ("Le mie Performance").
 * Mostra il ciclo corrente in evidenza + ultimi N cicli chiusi con
 * presenze, tier raggiunti e bonus maturato.
 */

import { useEffect, useState } from 'react';
import { CalendarCheck, History, Trophy, Gift } from 'lucide-react';
import { getBiweeklyHistory, type BiweeklyCycleSummary } from '@/app/actions/biweeklyBonusActions';

interface Props {
    /** ID del GDO di cui mostrare lo storico. */
    userId: string;
    /** Numero cicli chiusi da mostrare oltre al corrente. Default 8. */
    lookback?: number;
}

export function BiweeklyHistoryTable({ userId, lookback = 8 }: Props) {
    const [rows, setRows] = useState<BiweeklyCycleSummary[] | null>(null);

    useEffect(() => {
        if (!userId) return;
        setRows(null);
        getBiweeklyHistory(userId, lookback).then(setRows).catch(console.error);
    }, [userId, lookback]);

    if (!rows) {
        return (
            <div className="bg-white p-5 border border-ash-200/60 rounded-xl shadow-soft animate-pulse">
                <div className="h-5 w-64 bg-ash-100 rounded mb-4"></div>
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-10 bg-ash-50 rounded"></div>
                    ))}
                </div>
            </div>
        );
    }

    const totalBonus = rows.reduce((s, r) => s + (r.isCurrent ? 0 : r.bonusEur), 0);

    return (
        <div className="bg-white p-5 border border-ash-200/60 rounded-xl shadow-soft">
            <div className="flex items-center justify-between mb-4 border-b border-ash-200/60 pb-2">
                <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-brand-orange" />
                    <h3 className="font-bold text-ash-800">Storico Cicli Bisettimanali — Presenze e Bonus</h3>
                </div>
                <div className="text-xs text-ash-500">
                    Bonus maturati (cicli chiusi): <span className="font-bold text-emerald-700">€{totalBonus.toLocaleString('it-IT')}</span>
                </div>
            </div>

            <div className="text-xs text-ash-400 mb-3">
                Ciclo = 14 giorni (lun-dom-lun-dom), ancora 4 mag 2026. Una "presenza" = lead esitato dal venditore come <em>Chiuso</em> o <em>Non chiuso</em> (incluse rettifiche manuali admin).
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                    <thead>
                        <tr className="border-b border-ash-200/60 text-left">
                            <th className="pb-2 pr-3 text-ash-500 font-semibold">Ciclo</th>
                            <th className="pb-2 pr-3 text-ash-500 font-semibold">Date</th>
                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Presenze</th>
                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Tier 1</th>
                            <th className="pb-2 pr-3 text-ash-500 font-semibold text-right">Tier 2</th>
                            <th className="pb-2 text-ash-500 font-semibold text-right">Bonus</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const denom = r.target2 || 1;
                            const progPerc = Math.min((r.presences / denom) * 100, 100);
                            const status = r.tier2Reached ? 'tier2' : r.tier1Reached ? 'tier1' : 'miss';
                            return (
                                <tr key={r.cycleIndex} className={`border-b border-ash-100/60 transition-all duration-200 hover:bg-brand-orange-50/20 ${r.isCurrent ? 'bg-brand-orange-50/30' : ''}`}>
                                    <td className="py-2.5 pr-3 font-semibold text-brand-charcoal">
                                        <div className="flex items-center gap-2">
                                            <CalendarCheck className="h-4 w-4 text-brand-orange/70" />
                                            <span>{r.label}</span>
                                            {r.isCurrent && <span className="text-[10px] font-bold uppercase tracking-wider text-brand-orange-700 bg-brand-orange-100 rounded px-1.5 py-0.5">In corso</span>}
                                        </div>
                                    </td>
                                    <td className="py-2.5 pr-3 text-ash-600 text-xs">
                                        {r.startDateStr} → {r.endDateStr}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right">
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="font-bold text-ash-800">{r.presences} <span className="text-ash-400 font-normal">/ {r.target2}</span></div>
                                            <div className="w-20 h-1.5 bg-ash-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-[width] duration-700 ${status === 'tier2' ? 'bg-gold-500' : status === 'tier1' ? 'bg-brand-orange' : 'bg-ash-300'}`}
                                                    style={{ width: `${progPerc}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-2.5 pr-3 text-right">
                                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${r.tier1Reached ? 'text-emerald-700' : 'text-ash-400'}`}>
                                            <Gift className="h-3.5 w-3.5" />
                                            {r.tier1Reached ? `✓ €${r.reward1}` : `${r.target1} (€${r.reward1})`}
                                        </span>
                                    </td>
                                    <td className="py-2.5 pr-3 text-right">
                                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${r.tier2Reached ? 'text-gold-700' : 'text-ash-400'}`}>
                                            <Trophy className="h-3.5 w-3.5" />
                                            {r.tier2Reached ? `✓ €${r.reward2}` : `${r.target2} (€${r.reward2})`}
                                        </span>
                                    </td>
                                    <td className="py-2.5 text-right">
                                        <span className={`font-black ${r.bonusEur > 0 ? (r.tier2Reached ? 'text-gold-700' : 'text-emerald-700') : 'text-ash-400'}`}>
                                            €{r.bonusEur.toLocaleString('it-IT')}
                                        </span>
                                        {r.isCurrent && r.bonusEur > 0 && <div className="text-[10px] text-ash-400">previsto</div>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
