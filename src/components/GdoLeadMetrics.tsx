'use client';

import { useEffect, useState } from 'react';
import { getGdoLeadOutcomeMetrics } from '@/app/actions/gdoPerformanceActions';
import { CalendarCheck, UserCheck, HandshakeIcon, TrendingUp } from 'lucide-react';

interface GdoLeadMetricsProps {
    gdoUserId: string;
}

interface Metrics {
    fissati: number;
    confermati: number;
    presenziati: number;
    chiusi: number;
    weekStart: string;
    weekEnd: string;
}

export function GdoLeadMetrics({ gdoUserId }: GdoLeadMetricsProps) {
    const [metrics, setMetrics] = useState<Metrics | null>(null);

    useEffect(() => {
        getGdoLeadOutcomeMetrics(gdoUserId).then(setMetrics);

        const handler = () => {
            getGdoLeadOutcomeMetrics(gdoUserId).then(setMetrics);
        };
        window.addEventListener('realtime_update', handler);
        return () => window.removeEventListener('realtime_update', handler);
    }, [gdoUserId]);

    if (!metrics) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
                        <div className="h-8 bg-gray-200 rounded w-12" />
                    </div>
                ))}
            </div>
        );
    }

    const cards = [
        {
            label: 'Appuntamenti Fissati',
            value: metrics.fissati,
            icon: CalendarCheck,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
        },
        {
            label: 'Confermati',
            value: metrics.confermati,
            icon: UserCheck,
            color: 'text-green-600',
            bg: 'bg-green-50',
        },
        {
            label: 'Presenze',
            value: metrics.presenziati,
            icon: HandshakeIcon,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
        },
        {
            label: 'Chiusure',
            value: metrics.chiusi,
            icon: TrendingUp,
            color: 'text-purple-600',
            bg: 'bg-purple-50',
        },
    ];

    const ws = new Date(metrics.weekStart);
    const we = new Date(metrics.weekEnd);
    const fmt = (d: Date) => d.toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/Rome',
    });
    const weekLabel = `${fmt(ws)} — ${fmt(we)}`;

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-500">I tuoi lead — settimana {weekLabel}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <div
                            key={card.label}
                            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3"
                        >
                            <div className={`${card.bg} ${card.color} p-2 rounded-lg`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{card.value}</div>
                                <div className="text-xs text-gray-500">{card.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
