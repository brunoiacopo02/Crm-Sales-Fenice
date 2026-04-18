"use client";

import { useState, useTransition } from "react";
import { Users, Zap, CheckCircle2, AlertCircle, Loader2, Power, RefreshCw, Trash2, AlertTriangle, ExternalLink, RotateCcw, Check } from "lucide-react";
import {
    setGdoAcIntake,
    disableAllAcIntake,
    setupAcWebhook,
    deleteAcWebhookByUrl,
    listGdosForAcIntake,
    listAcFailures,
    retryAcFailure,
    resolveAcFailure,
    type GdoAcIntakeRow,
    type AcFailureRow,
} from "@/app/actions/acIntakeActions";

interface Props {
    initialRows: GdoAcIntakeRow[];
    initialWebhooks: Array<{ id: string; url: string; events: string[]; name: string }>;
    initialFailures: AcFailureRow[];
}

export default function LeadAutomaticiClient({ initialRows, initialWebhooks, initialFailures }: Props) {
    const [rows, setRows] = useState(initialRows);
    const [webhooks, setWebhooks] = useState(initialWebhooks);
    const [failures, setFailures] = useState(initialFailures);
    const [busyFailureId, setBusyFailureId] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    const activeCount = rows.filter(r => r.acAutoIntake).length;

    const handleToggle = async (r: GdoAcIntakeRow) => {
        setSaving(r.id);
        const next = !r.acAutoIntake;
        const res = await setGdoAcIntake(r.id, next);
        setSaving(null);
        if (!res.success) {
            setMsg({ type: 'err', text: res.error || 'Errore' });
            return;
        }
        setRows(prev => prev.map(x => x.id === r.id ? { ...x, acAutoIntake: next } : x));
    };

    const handleDisableAll = async () => {
        if (!confirm("Disabilitare tutti i GDO dal flusso automatico AC?")) return;
        const res = await disableAllAcIntake();
        if (!res.success) { setMsg({ type: 'err', text: res.error || 'Errore' }); return; }
        setRows(prev => prev.map(x => ({ ...x, acAutoIntake: false })));
    };

    const handleSetupWebhook = async () => {
        startTransition(async () => {
            const res = await setupAcWebhook();
            if (!res.success) {
                setMsg({ type: 'err', text: res.error || 'Errore' });
                return;
            }
            setMsg({ type: 'ok', text: `Webhook pronto (id ${res.webhookId}). URL registrato su AC.` });
            if (res.webhookId && res.url) {
                setWebhooks(w => {
                    const filtered = w.filter(x => !x.url.includes('/api/webhooks/activecampaign'));
                    return [...filtered, { id: res.webhookId!, url: res.url!, events: ['subscribe'], name: 'CRM Fenice — Lead Auto-Intake' }];
                });
            }
        });
    };

    const handleDeleteWebhook = async () => {
        if (!confirm("Rimuovere il webhook CRM da ActiveCampaign? I nuovi lead non arriveranno più.")) return;
        const res = await deleteAcWebhookByUrl();
        if (!res.success) { setMsg({ type: 'err', text: res.error || 'Errore' }); return; }
        setMsg({ type: 'ok', text: 'Webhook AC rimosso.' });
        setWebhooks(w => w.filter(x => !x.url.includes('/api/webhooks/activecampaign')));
    };

    const refreshRows = async () => {
        const fresh = await listGdosForAcIntake();
        setRows(fresh);
    };

    const refreshFailures = async () => {
        const fresh = await listAcFailures(true);
        setFailures(fresh);
    };

    const handleRetry = async (id: string) => {
        setBusyFailureId(id);
        const res = await retryAcFailure(id);
        setBusyFailureId(null);
        if (!res.success) {
            setMsg({ type: 'err', text: `Retry fallito: ${res.error}` });
            return;
        }
        setMsg({ type: 'ok', text: `Lead importato (id: ${res.leadId?.slice(0, 8)}…)` });
        setFailures((f) => f.filter((x) => x.id !== id));
    };

    const handleResolve = async (id: string) => {
        setBusyFailureId(id);
        const res = await resolveAcFailure(id);
        setBusyFailureId(null);
        if (!res.success) { setMsg({ type: 'err', text: res.error || 'Errore' }); return; }
        setFailures((f) => f.filter((x) => x.id !== id));
    };

    const crmWebhook = webhooks.find(w => w.url.includes('/api/webhooks/activecampaign'));

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <Zap className="h-6 w-6 text-brand-orange" /> Lead Automatici da ActiveCampaign
                </h1>
                <p className="text-sm text-ash-500">
                    Quando AC riceve un lead nuovo, viene inserito nel CRM e assegnato in round-robin a uno dei GDO abilitati qui sotto.
                </p>
            </header>

            {msg && (
                <div className={`rounded-xl border px-4 py-2 text-sm ${msg.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                    {msg.text}
                </div>
            )}

            {/* Webhook status */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-bold text-ash-900">Collegamento webhook AC</h2>
                        <p className="text-xs text-ash-500">
                            {crmWebhook
                                ? `Attivo — AC invia i nuovi contatti a questo CRM (webhook id ${crmWebhook.id}).`
                                : 'Non collegato — i lead AC non arrivano nel CRM finché non attivi il webhook.'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSetupWebhook}
                            disabled={isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                            {crmWebhook ? 'Ricrea/Aggiorna webhook' : 'Attiva webhook'}
                        </button>
                        {crmWebhook && (
                            <button
                                onClick={handleDeleteWebhook}
                                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                            >
                                <Trash2 className="h-3.5 w-3.5" /> Disattiva
                            </button>
                        )}
                    </div>
                </div>
                {crmWebhook && (
                    <div className="rounded-lg bg-ash-50 p-2 text-[11px] font-mono text-ash-600 break-all">
                        {crmWebhook.url.replace(/secret=[^&]+/, 'secret=***')}
                        <div className="mt-1 text-ash-500">Eventi: {crmWebhook.events.join(', ')}</div>
                    </div>
                )}
            </section>

            {/* Lead non importati */}
            <section className="rounded-2xl border border-ash-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-ash-100 px-4 py-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-ash-900">
                            <AlertTriangle className="h-4 w-4 text-amber-600" /> Lead non importati
                            {failures.length > 0 && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{failures.length}</span>
                            )}
                        </h2>
                        <p className="text-xs text-ash-500">
                            Contatti AC che non sono entrati nel CRM. Clicca "Riprova" per reimportare, oppure "Risolto" per nasconderli dopo averli gestiti manualmente su AC.
                        </p>
                    </div>
                    <button onClick={refreshFailures} className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2 py-1 text-xs font-medium text-ash-600 hover:bg-ash-50" title="Ricarica">
                        <RefreshCw className="h-3 w-3" />
                    </button>
                </div>
                {failures.length === 0 ? (
                    <div className="p-6 text-center text-sm text-ash-400">
                        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                        Nessun errore in sospeso
                    </div>
                ) : (
                    <div className="divide-y divide-ash-100">
                        {failures.map(f => {
                            const fullName = [f.firstName, f.lastName].filter(Boolean).join(' ').trim();
                            return (
                                <div key={f.id} className="p-4 space-y-2">
                                    {/* Motivo in linguaggio naturale */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2 min-w-0 flex-1">
                                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                            <div className="text-sm font-semibold text-ash-900">{f.reasonHuman}</div>
                                        </div>
                                        <span className="text-[10px] text-ash-400 shrink-0 font-mono">{new Date(f.createdAt).toLocaleString('it-IT')}</span>
                                    </div>

                                    {/* Griglia dati lead */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-lg bg-ash-50 p-3">
                                        <InfoCell label="Nome" value={fullName || '—'} />
                                        <InfoCell label="Email" value={f.email || '—'} mono />
                                        <InfoCell label="Telefono" value={f.phoneRaw || '—'} mono highlight={f.reasonCategory === 'phone'} />
                                        <InfoCell label="Provenienza" value={f.provenienza || '—'} />
                                    </div>

                                    {/* Azioni */}
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="text-[11px] text-ash-500">
                                            {f.acContactId ? <>ID AC: <code className="font-mono">{f.acContactId}</code></> : 'Nessun ID AC'}
                                        </div>
                                        <div className="flex gap-1.5">
                                            {f.acContactLink && (
                                                <a
                                                    href={f.acContactLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                                >
                                                    <ExternalLink className="h-3 w-3" /> Apri su AC
                                                </a>
                                            )}
                                            {f.acContactId && (
                                                <button
                                                    onClick={() => handleRetry(f.id)}
                                                    disabled={busyFailureId === f.id}
                                                    className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                                >
                                                    {busyFailureId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                                    Riprova
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleResolve(f.id)}
                                                disabled={busyFailureId === f.id}
                                                className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-ash-700 hover:bg-ash-50 disabled:opacity-50"
                                            >
                                                <Check className="h-3 w-3" /> Risolto
                                            </button>
                                        </div>
                                    </div>

                                    {/* Dettagli tecnici collassati */}
                                    <details className="group">
                                        <summary className="cursor-pointer text-[10px] text-ash-400 hover:text-ash-600">Dettagli tecnici</summary>
                                        <div className="mt-1 space-y-1">
                                            <div className="text-[10px] text-ash-500">Messaggio grezzo: <code className="font-mono">{f.reason}</code></div>
                                            <pre className="overflow-x-auto rounded-md bg-ash-100 p-2 text-[10px] leading-snug text-ash-700 max-h-40">
                                                {JSON.stringify(f.payload, null, 2)}
                                            </pre>
                                        </div>
                                    </details>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* GDO round robin */}
            <section className="rounded-2xl border border-ash-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-ash-100 px-4 py-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-ash-900">
                            <Users className="h-4 w-4" /> GDO abilitati al round-robin
                        </h2>
                        <p className="text-xs text-ash-500">
                            Attivi: <strong>{activeCount}</strong> su {rows.length}. Abilita solo chi oggi è operativo e deve ricevere i nuovi lead.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={refreshRows}
                            className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2 py-1 text-xs font-medium text-ash-600 hover:bg-ash-50"
                            title="Ricarica"
                        >
                            <RefreshCw className="h-3 w-3" />
                        </button>
                        <button
                            onClick={handleDisableAll}
                            className="rounded-lg border border-ash-200 bg-white px-3 py-1 text-xs font-medium text-ash-600 hover:bg-ash-50"
                        >
                            Disabilita tutti
                        </button>
                    </div>
                </div>
                <div className="divide-y divide-ash-100">
                    {rows.length === 0 && (
                        <div className="p-4 text-center text-sm text-ash-400">Nessun GDO trovato.</div>
                    )}
                    {rows.map(r => (
                        <div key={r.id} className={`flex items-center justify-between px-4 py-3 ${!r.isActive ? 'opacity-50' : ''}`}>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="rounded-md bg-ash-100 px-2 py-0.5 text-xs font-bold font-mono text-ash-700">{r.gdoCode ?? '?'}</span>
                                    <span className="text-sm font-semibold text-ash-900">{r.displayName || r.name || 'GDO'}</span>
                                    {!r.isActive && <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">DISATTIVO</span>}
                                </div>
                                <div className="text-[11px] text-ash-500">
                                    {r.acLastAssignedAt
                                        ? `Ultimo lead AC: ${new Date(r.acLastAssignedAt).toLocaleString('it-IT')}`
                                        : 'Nessun lead AC ricevuto ancora'}
                                </div>
                            </div>
                            <button
                                onClick={() => handleToggle(r)}
                                disabled={saving === r.id || !r.isActive}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${r.acAutoIntake ? 'bg-emerald-500' : 'bg-ash-300'} disabled:opacity-50`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${r.acAutoIntake ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                {saving === r.id && <Loader2 className="absolute -right-6 h-3 w-3 animate-spin text-ash-400" />}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            {activeCount === 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertCircle className="h-4 w-4" />
                    Nessun GDO abilitato: i lead AC in arrivo verranno scartati con notifica al manager.
                </div>
            )}
            {crmWebhook && activeCount > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Sistema attivo: {activeCount} GDO in round-robin.
                </div>
            )}
        </div>
    );
}

function InfoCell({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ash-500">{label}</div>
            <div
                className={`truncate text-xs ${mono ? 'font-mono' : 'font-medium'} ${highlight ? 'text-rose-700 font-bold' : 'text-ash-800'}`}
                title={value}
            >
                {value}
            </div>
        </div>
    );
}
