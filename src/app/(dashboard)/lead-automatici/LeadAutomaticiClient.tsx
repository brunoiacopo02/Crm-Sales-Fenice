"use client";

import { useState, useTransition } from "react";
import { Users, Zap, CheckCircle2, AlertCircle, Loader2, Power, RefreshCw, Trash2, AlertTriangle, TrendingUp } from "lucide-react";
import {
    setGdoAcIntake,
    disableAllAcIntake,
    setupAcWebhook,
    deleteAcWebhookByUrl,
    listGdosForAcIntake,
    getAcIntakeStats,
    type GdoAcIntakeRow,
    type AcIntakeStats,
    type AcIntakeDayStat,
    type BotRoutingStatus,
} from "@/app/actions/acIntakeActions";

interface Props {
    initialRows: GdoAcIntakeRow[];
    initialWebhooks: Array<{ id: string; url: string; events: string[]; name: string }>;
    initialStats: AcIntakeStats;
    /** Finestra ferie GDO attiva ADESSO (valutata dal server), o null fuori finestra. */
    holidayWindow: { from: string; until: string | null; lastDay: string | null } | null;
    /** Fascia di distribuzione in vigore + ripartizione di oggi. */
    routingStatus: BotRoutingStatus;
}

/** Come si chiama, in italiano, la finestra in vigore adesso. */
const ROUTING_LABEL: Record<BotRoutingStatus['routing'], { titolo: string; spiega: string; tono: string }> = {
    bot_only: {
        titolo: 'Fascia bot',
        spiega: "fuori dall'orario dei GDO: tutti i lead in arrivo vanno al bot, senza alcun limite.",
        tono: 'border-violet-200 bg-violet-50 text-violet-900',
    },
    bot_first: {
        titolo: 'Fascia mista',
        spiega: 'orario dei GDO: i lead vanno ai GDO, ma il bot passa avanti finché non ha raggiunto il minimo giornaliero.',
        tono: 'border-sky-200 bg-sky-50 text-sky-900',
    },
    gdo_only: {
        titolo: 'Fascia GDO',
        spiega: 'sabato 09:00–16:30: i lead vanno solo ai GDO umani, il bot resta fuori anche se è sotto il minimo giornaliero.',
        tono: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    },
    bot_half: {
        titolo: 'Rientro del bot: metà e metà',
        spiega: 'il bot prende un lead solo finché oggi ne ha meno della metà; il resto ai GDO. Finestra a scadenza, si spegne da sola.',
        tono: 'border-amber-200 bg-amber-50 text-amber-900',
    },
    legacy: {
        titolo: 'Regola oraria spenta',
        spiega: "l'env BOT_ROUTING è su off: vale il round-robin storico, bot e GDO nello stesso giro.",
        tono: 'border-ash-200 bg-ash-50 text-ash-700',
    },
};

/** '2026-08-08' → '8 agosto' (per la striscia ferie). */
function giornoIt(day: string): string {
    return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' })
        .format(new Date(`${day}T00:00:00Z`));
}

export default function LeadAutomaticiClient({ initialRows, initialWebhooks, initialStats, holidayWindow, routingStatus }: Props) {
    const [rows, setRows] = useState(initialRows);
    const [webhooks, setWebhooks] = useState(initialWebhooks);
    const [stats, setStats] = useState(initialStats);
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

    const refreshStats = async () => {
        const fresh = await getAcIntakeStats();
        setStats(fresh);
    };

    const crmWebhook = webhooks.find(w => w.url.includes('/api/webhooks/activecampaign'));

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <Zap className="h-6 w-6 text-brand-orange" /> Lead Automatici da ActiveCampaign
                </h1>
                <p className="text-sm text-ash-500">
                    Quando AC riceve un lead nuovo, viene inserito nel CRM e assegnato secondo la fascia oraria: al bot fuori dall'orario dei GDO, altrimenti in round-robin ai GDO abilitati qui sotto.
                </p>
            </header>

            {/* Ripartizione bot / GDO: la fascia in vigore e come sta andando oggi. */}
            <section className={`rounded-2xl border p-4 shadow-sm ${ROUTING_LABEL[routingStatus.routing].tono}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-bold">
                        Adesso: {ROUTING_LABEL[routingStatus.routing].titolo}
                    </h2>
                    <span className="text-xs opacity-80">
                        Bot 20:00–13:00 · GDO 13:00–20:00 · sabato GDO 09:00–16:30 · domenica bot · minimo bot/giorno
                    </span>
                </div>
                <p className="mt-0.5 text-xs opacity-90">{ROUTING_LABEL[routingStatus.routing].spiega}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                        <div className="text-xl font-black">{routingStatus.todayBot}<span className="text-sm font-bold opacity-60">/{routingStatus.dailyMin}</span></div>
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Oggi al bot (min.)</div>
                    </div>
                    <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                        <div className="text-xl font-black">{routingStatus.todayHumans}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Oggi ai GDO</div>
                    </div>
                    <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-2">
                        <div className="text-xl font-black">{routingStatus.botBacklog}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Fermi sul bot</div>
                    </div>
                    <div className={`rounded-xl border px-3 py-2 ${routingStatus.botBacklogOld > 0 ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-white/60 bg-white/70'}`}>
                        <div className="text-xl font-black">{routingStatus.botBacklogOld}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Fermi da 7+ giorni</div>
                    </div>
                </div>
            </section>

            {holidayWindow && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <div className="text-sm text-amber-900">
                        <span className="font-bold">
                            {holidayWindow.lastDay
                                ? `Tutto al bot ${giornoIt(holidayWindow.from)} – ${giornoIt(holidayWindow.lastDay)}`
                                : `Tutto al bot dal ${giornoIt(holidayWindow.from)}, senza scadenza`}
                        </span>
                        {' '}— tutti i lead ActiveCampaign in arrivo vengono assegnati al bot (GDO 201), senza
                        alcun limite giornaliero. Le selezioni qui sotto restano salvate.
                        {holidayWindow.until
                            ? ` Tornano attive da sole il ${giornoIt(holidayWindow.until)}.`
                            : ' Nessuna data di rientro: la finestra resta aperta finché non viene spenta a mano (BOT_HOLIDAY_WINDOW=off).'}
                    </div>
                </div>
            )}

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

            {/* Statistiche importazione */}
            <section className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-sm font-bold text-ash-900">
                            <TrendingUp className="h-4 w-4 text-emerald-600" /> Lead importati da AC
                        </h2>
                        <p className="text-xs text-ash-500">
                            Conteggio in base al fuso Italia (mezzanotte–mezzanotte). Niente storico.
                        </p>
                    </div>
                    <button
                        onClick={refreshStats}
                        className="flex items-center gap-1 rounded-lg border border-ash-200 bg-white px-2 py-1 text-xs font-medium text-ash-600 hover:bg-ash-50"
                        title="Aggiorna statistiche"
                    >
                        <RefreshCw className="h-3 w-3" />
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <StatCard label="Oggi" accent="emerald" stat={stats.today} />
                    <StatCard label="Ieri" accent="blue" stat={stats.yesterday} />
                    <StatCard label="Altro ieri" accent="ash" stat={stats.dayBeforeYesterday} />
                </div>
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

function StatCard({ label, stat, accent }: { label: string; stat: AcIntakeDayStat; accent: 'emerald' | 'blue' | 'ash' }) {
    const palette = {
        emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50', label: 'text-emerald-700', total: 'text-emerald-900' },
        blue: { border: 'border-blue-200', bg: 'bg-blue-50', label: 'text-blue-700', total: 'text-blue-900' },
        ash: { border: 'border-ash-200', bg: 'bg-ash-50', label: 'text-ash-600', total: 'text-ash-900' },
    }[accent];
    return (
        <div className={`rounded-xl border ${palette.border} ${palette.bg} p-3`}>
            <div className={`text-[11px] font-bold uppercase tracking-wider ${palette.label}`}>{label}</div>
            <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-3xl font-black ${palette.total}`}>{stat.total}</span>
                <span className="text-[11px] text-ash-500">lead</span>
            </div>
            <div className="mt-1 text-[11px] text-ash-600">
                Media a GDO: <strong className="text-ash-800">{stat.avgPerGdo}</strong>
                {stat.activeGdos > 0 && <span className="text-ash-400"> ({stat.activeGdos} GDO)</span>}
            </div>
        </div>
    );
}
