'use client';

import { useState, type ReactNode } from 'react';
import { Calendar } from 'lucide-react';
import { PanoramicaClient } from './PanoramicaClient';
import type {
    LeadOverviewResult,
    FunnelOverviewResult,
    MetricsOverviewResult,
} from '@/app/actions/panoramicaActions';

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

/** Ultimi n mesi ('YYYY-MM'), dal più recente, a partire dal mese corrente. */
function lastNMonths(currentYm: string, n: number): string[] {
    const [y, m] = currentYm.split('-').map(Number);
    const out: string[] = [];
    let yy = y;
    let mm = m;
    for (let i = 0; i < n; i++) {
        out.push(`${yy}-${String(mm).padStart(2, '0')}`);
        mm -= 1;
        if (mm === 0) { mm = 12; yy -= 1; }
    }
    return out;
}

function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

export function SalesManagerView({
    initialData,
    initialFunnelData,
    initialMetricsData,
    readOnly = false,
    readOnlyVariant = 'all-companies',
    currentYearMonth,
    strips,
}: {
    initialData: LeadOverviewResult;
    initialFunnelData: FunnelOverviewResult;
    initialMetricsData: MetricsOverviewResult;
    readOnly?: boolean;
    readOnlyVariant?: 'all-companies' | 'viewer';
    currentYearMonth: string;
    /** Strisce operative (Alert MTD, Parametri Manager) montate solo sul mese corrente. */
    strips: ReactNode;
}) {
    const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
    const months = lastNMonths(currentYearMonth, 12);
    const isCurrent = selectedMonth === currentYearMonth;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-ash-200 bg-white px-3 py-2 shadow-sm">
                    <Calendar className="w-4 h-4 text-brand-orange" />
                    <label htmlFor="sm-month" className="text-xs font-semibold uppercase tracking-wider text-ash-500">
                        Periodo
                    </label>
                    <select
                        id="sm-month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="cursor-pointer bg-transparent text-sm font-bold text-ash-800 outline-none"
                    >
                        {months.map((ym) => (
                            <option key={ym} value={ym}>
                                {monthLabel(ym)}{ym === currentYearMonth ? ' (in corso)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                {!isCurrent && (
                    <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                        Vista storica in sola lettura
                    </span>
                )}
            </div>

            {isCurrent && strips}

            <PanoramicaClient
                initialData={initialData}
                initialFunnelData={initialFunnelData}
                initialMetricsData={initialMetricsData}
                readOnly={readOnly}
                readOnlyVariant={readOnlyVariant}
                selectedMonth={selectedMonth}
                currentYearMonth={currentYearMonth}
            />
        </div>
    );
}
