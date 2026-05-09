"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

interface Props {
    operatori: Array<{ id: string; name: string }>;
    currentPeriod: number;
    currentUser: string;
}

const PERIODS: Array<{ v: 7 | 14 | 30 | 90; label: string }> = [
    { v: 7, label: "7 giorni" },
    { v: 14, label: "14 giorni" },
    { v: 30, label: "30 giorni" },
    { v: 90, label: "90 giorni" },
];

export function AnalyticsFilters({ operatori, currentPeriod, currentUser }: Props) {
    const router = useRouter();
    const params = useSearchParams();
    const [pending, startTransition] = useTransition();

    const update = (key: string, value: string) => {
        const sp = new URLSearchParams(params.toString());
        sp.set(key, value);
        startTransition(() => router.push(`?${sp.toString()}`));
    };

    return (
        <div className="flex items-center gap-3 flex-wrap">
            <select
                value={String(currentPeriod)}
                onChange={(e) => update("period", e.target.value)}
                disabled={pending}
                className="px-3 py-1.5 border border-ash-200 rounded-lg text-sm font-semibold bg-white"
            >
                {PERIODS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>

            <select
                value={currentUser}
                onChange={(e) => update("user", e.target.value)}
                disabled={pending}
                className="px-3 py-1.5 border border-ash-200 rounded-lg text-sm font-semibold bg-white"
            >
                <option value="all">Tutti gli operatori</option>
                {operatori.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>

            {pending && <span className="text-xs text-ash-400">Aggiorno…</span>}
        </div>
    );
}
