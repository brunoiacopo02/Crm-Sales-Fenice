'use client';

import { useState } from 'react';

type RunResult = {
    ok: boolean;
    httpStatus: number;
    body: unknown;
};

export default function BackfillClient() {
    const [loading, setLoading] = useState<'dry' | 'send' | null>(null);
    const [result, setResult] = useState<RunResult | null>(null);
    const [cutoffIso, setCutoffIso] = useState<string>('2026-05-07T00:00:00.000Z');

    async function call(dryRun: boolean) {
        setLoading(dryRun ? 'dry' : 'send');
        setResult(null);
        try {
            const res = await fetch('/api/marketing/backfill-historical', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun, cutoffIso }),
            });
            const body = await res.json().catch(() => ({ error: 'non_json_response' }));
            setResult({ ok: res.ok, httpStatus: res.status, body });
        } catch (e) {
            setResult({ ok: false, httpStatus: 0, body: { error: e instanceof Error ? e.message : String(e) } });
        } finally {
            setLoading(null);
        }
    }

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Backfill Marketing Webhooks</h1>
                <p className="text-sm text-gray-400 mt-1">
                    Invia gli appuntamenti storici (occurredAt &lt; cutoff) al CRM marketing
                    via <code className="text-brand-orange">POST /api/crm/import-appointments</code>.
                    Dedup automatica via <code>eventId</code>.
                </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
                <label className="block">
                    <span className="text-sm text-gray-300">Cutoff ISO (occurredAt &lt; cutoff)</span>
                    <input
                        type="text"
                        value={cutoffIso}
                        onChange={(e) => setCutoffIso(e.target.value)}
                        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-white font-mono text-sm"
                    />
                    <span className="text-xs text-gray-500 mt-1 block">
                        Default: 2026-05-07T00:00:00.000Z (data go-live webhook live)
                    </span>
                </label>

                <div className="flex gap-3">
                    <button
                        onClick={() => call(true)}
                        disabled={loading !== null}
                        className="px-4 py-2 rounded bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-50"
                    >
                        {loading === 'dry' ? 'Calcolo...' : 'Dry-run (preview)'}
                    </button>
                    <button
                        onClick={() => {
                            if (!confirm('Confermi invio reale al CRM marketing?')) return;
                            call(false);
                        }}
                        disabled={loading !== null}
                        className="px-4 py-2 rounded bg-brand-orange text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {loading === 'send' ? 'Invio in corso...' : 'Invia ora'}
                    </button>
                </div>
            </div>

            {result && (
                <div className={`rounded-lg p-4 border ${result.ok ? 'border-green-700 bg-green-950/30' : 'border-red-700 bg-red-950/30'}`}>
                    <div className="text-sm font-semibold mb-2 text-white">
                        HTTP {result.httpStatus} {result.ok ? '✓' : '✗'}
                    </div>
                    <pre className="text-xs text-gray-200 overflow-auto max-h-[60vh] whitespace-pre-wrap">
                        {JSON.stringify(result.body, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}
