"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Bot,
    CalendarDays,
    Database,
    Euro,
    Lock,
    Percent,
    RotateCcw,
    Sparkles,
    TrendingUp,
    Users,
} from 'lucide-react';
import { lockPrevisionale } from '@/app/actions/previsionaleActions';
import {
    CLOSING_SCENARIOS,
    CPL_SCENARIOS,
    DEFAULT_PARAMS,
    computePrevisionale,
    computeWith,
    type PrevisionaleParams,
} from '@/lib/previsionale/model';

const STORAGE_KEY = 'fenice:previsionale:params:v1';

type ParamKey = keyof PrevisionaleParams;
type Draft = Record<ParamKey, string>;

/**
 * I parametri restano stringhe finche' si digita: cosi' "65," e il campo vuoto
 * non vengono normalizzati sotto le dita di chi scrive.
 */
function toDraft(p: PrevisionaleParams): Draft {
    const out = {} as Draft;
    for (const key of Object.keys(DEFAULT_PARAMS) as ParamKey[]) {
        out[key] = String(p[key]);
    }
    return out;
}

function parseDraft(d: Draft): PrevisionaleParams {
    const out = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS) as ParamKey[]) {
        const n = Number.parseFloat((d[key] ?? '').replace(',', '.'));
        out[key] = Number.isFinite(n) ? n : 0;
    }
    return out;
}

const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (n: number) => nf0.format(Math.round(n));
const fmtOne = (n: number) => nf1.format(n);
const fmtEur0 = (n: number) => eur0.format(n);
const fmtEur2 = (n: number) => eur2.format(n);
const fmtRoas = (n: number) => `${nf2.format(n)}x`;

/* ------------------------------------------------------------------ */
/* Blocchi di UI                                                       */
/* ------------------------------------------------------------------ */

function NumberField({
    label,
    hint,
    unit,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    unit?: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ash-600">{label}</span>
            <div className="relative">
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 pr-9 text-sm font-semibold tabular-nums text-brand-charcoal outline-none transition-colors focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
                />
                {unit && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-ash-400">
                        {unit}
                    </span>
                )}
            </div>
            {hint && <span className="mt-1 block text-[11px] leading-tight text-ash-400">{hint}</span>}
        </label>
    );
}

function ParamCard({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-charcoal">
                <Icon className="h-4 w-4 text-brand-orange" />
                {title}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">{children}</div>
        </section>
    );
}

const STAT_TONES: Record<string, string> = {
    neutral: 'border-ash-200/60 bg-white',
    accent: 'border-brand-orange/30 bg-brand-orange/5',
    good: 'border-emerald-200 bg-emerald-50',
};

function Stat({
    label,
    value,
    sub,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    sub?: string;
    tone?: 'neutral' | 'accent' | 'good';
}) {
    return (
        <div className={`rounded-xl border p-3 shadow-soft ${STAT_TONES[tone]}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ash-500">{label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-brand-charcoal sm:text-2xl">{value}</div>
            {sub && <div className="mt-0.5 text-[11px] leading-tight text-ash-500">{sub}</div>}
        </div>
    );
}

function FunnelRow({
    label,
    value,
    detail,
    strong,
}: {
    label: string;
    value: string;
    detail?: string;
    strong?: boolean;
}) {
    return (
        <div
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-ash-100 py-2 last:border-b-0 ${strong ? 'font-bold text-brand-charcoal' : 'text-ash-600'}`}
        >
            <div className="min-w-0">
                <div className="text-sm">{label}</div>
                {detail && <div className="text-[11px] font-normal text-ash-400">{detail}</div>}
            </div>
            <div className="text-sm tabular-nums text-brand-charcoal">{value}</div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */

export default function PrevisionaleClient() {
    const router = useRouter();
    const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_PARAMS));
    const [restored, setRestored] = useState(false);
    const [pending, startTransition] = useTransition();

    // localStorage solo dopo il mount: leggerlo nell'inizializzatore di stato
    // farebbe divergere l'HTML del server da quello del client (hydration).
    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<Draft>;
                setDraft((prev) => {
                    const next = { ...prev };
                    for (const key of Object.keys(DEFAULT_PARAMS) as ParamKey[]) {
                        const v = parsed[key];
                        if (typeof v === 'string') next[key] = v;
                    }
                    return next;
                });
            }
        } catch {
            /* localStorage inaccessibile (private mode): si resta sui default */
        }
        setRestored(true);
    }, []);

    useEffect(() => {
        if (!restored) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        } catch {
            /* quota piena o storage negato: il modello funziona lo stesso */
        }
    }, [draft, restored]);

    const params = useMemo(() => parseDraft(draft), [draft]);
    const r = useMemo(() => computePrevisionale(params), [params]);

    const closingRows = useMemo(
        () => CLOSING_SCENARIOS.map((v) => ({ v, res: computeWith(params, 'closingRatePct', v) })),
        [params],
    );
    const cplRows = useMemo(
        () => CPL_SCENARIOS.map((v) => ({ v, res: computeWith(params, 'cpl', v) })),
        [params],
    );

    const set = (key: ParamKey) => (v: string) => setDraft((prev) => ({ ...prev, [key]: v }));

    const reset = () => setDraft(toDraft(DEFAULT_PARAMS));

    const lock = () => {
        startTransition(async () => {
            await lockPrevisionale();
            router.refresh();
        });
    };

    const capacitaSatura = r.freschi === 0 && r.ridati > r.capacitaGdo;
    const tassoConferma = r.appTotali > 0 ? (r.conferme / r.appTotali) * 100 : 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-xl font-bold text-brand-charcoal sm:text-2xl">
                        <Sparkles className="h-5 w-5 text-brand-orange" />
                        Previsionale
                    </h1>
                    <p className="mt-0.5 text-sm text-ash-500">
                        Modello del funnel: cambia i parametri, i numeri si ricalcolano subito.
                        Le impostazioni restano su questo browser.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm font-semibold text-ash-600 transition-colors hover:bg-ash-50"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Ripristina default
                    </button>
                    <button
                        type="button"
                        onClick={lock}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm font-semibold text-ash-600 transition-colors hover:bg-ash-50 disabled:opacity-50"
                    >
                        <Lock className="h-4 w-4" />
                        Blocca
                    </button>
                </div>
            </div>

            {/* ---------------- Parametri ---------------- */}
            <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ash-400">Parametri</h2>
                <div className="grid gap-4 xl:grid-cols-2">
                    <ParamCard title="Calendario" icon={CalendarDays}>
                        <NumberField label="Giorni lavorativi GDO" unit="gg" value={draft.giorniLavorativi} onChange={set('giorniLavorativi')} />
                        <NumberField label="Giorni di calendario" unit="gg" value={draft.giorniCalendario} onChange={set('giorniCalendario')} hint="Usato solo per le medie giornaliere." />
                    </ParamCard>

                    <ParamCard title="Lead nuovi (evergreen)" icon={Users}>
                        <NumberField label="GDO sui lead nuovi" unit="n." value={draft.gdoNuovi} onChange={set('gdoNuovi')} />
                        <NumberField label="Lead nuovi per GDO al giorno" unit="n." value={draft.leadPerGdo} onChange={set('leadPerGdo')} />
                        <NumberField label="CPL" unit="EUR" value={draft.cpl} onChange={set('cpl')} />
                    </ParamCard>

                    <ParamCard title="Bot fissatore" icon={Bot}>
                        <NumberField label="Lead al bot: feriali/giorno" unit="n." value={draft.botFeriali} onChange={set('botFeriali')} />
                        <NumberField label="Giorni feriali nel mese" unit="gg" value={draft.giorniFeriali} onChange={set('giorniFeriali')} />
                        <NumberField label="Lead al bot: sabato/giorno" unit="n." value={draft.botSabato} onChange={set('botSabato')} />
                        <NumberField label="Sabati nel mese" unit="gg" value={draft.giorniSabato} onChange={set('giorniSabato')} />
                        <NumberField label="Lead al bot: domenica/giorno" unit="n." value={draft.botDomenica} onChange={set('botDomenica')} />
                        <NumberField label="Domeniche nel mese" unit="gg" value={draft.giorniDomenica} onChange={set('giorniDomenica')} />
                        <NumberField label="Quota restituita dal bot" unit="%" value={draft.quotaRestituitaPct} onChange={set('quotaRestituitaPct')} hint="Il resto resta al bot come trattenuto." />
                    </ParamCard>

                    <ParamCard title="Database" icon={Database}>
                        <NumberField label="GDO sul database" unit="n." value={draft.gdoDatabase} onChange={set('gdoDatabase')} />
                        <NumberField label="Lead database per GDO al giorno" unit="n." value={draft.leadDbPerGdo} onChange={set('leadDbPerGdo')} />
                        <NumberField label="Lead database dai GDO evergreen, al giorno" unit="n." value={draft.leadDbDaEvergreen} onChange={set('leadDbDaEvergreen')} />
                    </ParamCard>

                    <ParamCard title="Fissaggio e conferma per origine" icon={Percent}>
                        <NumberField label="Fissaggio bot trattenuti" unit="%" value={draft.fissBotPct} onChange={set('fissBotPct')} />
                        <NumberField label="Conferma su app. bot" unit="%" value={draft.confBotPct} onChange={set('confBotPct')} />
                        <NumberField label="Fissaggio ridati" unit="%" value={draft.fissRidatiPct} onChange={set('fissRidatiPct')} />
                        <NumberField label="Conferma su app. ridati" unit="%" value={draft.confRidatiPct} onChange={set('confRidatiPct')} />
                        <NumberField label="Fissaggio freschi" unit="%" value={draft.fissFreschiPct} onChange={set('fissFreschiPct')} />
                        <NumberField label="Conferma su app. freschi" unit="%" value={draft.confFreschiPct} onChange={set('confFreschiPct')} />
                        <NumberField label="Fissaggio database" unit="%" value={draft.fissDatabasePct} onChange={set('fissDatabasePct')} />
                        <NumberField label="Conferma su app. database" unit="%" value={draft.confDatabasePct} onChange={set('confDatabasePct')} />
                    </ParamCard>

                    <ParamCard title="Chiusura" icon={TrendingUp}>
                        <NumberField label="Presenza su conferme" unit="%" value={draft.presenzaPct} onChange={set('presenzaPct')} />
                        <NumberField label="Closing rate" unit="%" value={draft.closingRatePct} onChange={set('closingRatePct')} />
                        <NumberField label="Ticket medio" unit="EUR" value={draft.ticketMedio} onChange={set('ticketMedio')} />
                    </ParamCard>
                </div>
            </div>

            {/* ---------------- Volumi e funnel ---------------- */}
            <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ash-400">Volumi e funnel</h2>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Stat label="Capacita GDO" value={fmtInt(r.capacitaGdo)} sub="lead lavorabili nel mese" />
                    <Stat label="Lead evergreen" value={fmtInt(r.leadEvergreen)} sub="freschi + lead al bot (acquistati)" tone="accent" />
                    <Stat label="Lead database" value={fmtInt(r.leadDatabase)} sub="a costo zero" />
                    <Stat label="Lead totali lavorati" value={fmtInt(r.leadTotali)} />
                </div>

                {capacitaSatura && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                        I lead ridati dal bot ({fmtInt(r.ridati)}) superano la capacita dei GDO sui nuovi
                        ({fmtInt(r.capacitaGdo)}): con questi parametri non si comprano lead freschi.
                    </div>
                )}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
                        <h3 className="mb-2 text-sm font-bold text-brand-charcoal">Lead per origine</h3>
                        <FunnelRow
                            label="Lead al bot"
                            value={fmtInt(r.leadAlBot)}
                            detail={`${fmtInt(params.botFeriali)} x ${fmtInt(params.giorniFeriali)} feriali + ${fmtInt(params.botSabato)} x ${fmtInt(params.giorniSabato)} sab + ${fmtInt(params.botDomenica)} x ${fmtInt(params.giorniDomenica)} dom`}
                        />
                        <FunnelRow label="Trattenuti dal bot" value={fmtInt(r.trattenuti)} detail={`${fmtOne(100 - params.quotaRestituitaPct)}% dei lead al bot`} />
                        <FunnelRow label="Ridati ai GDO" value={fmtInt(r.ridati)} detail={`${fmtOne(params.quotaRestituitaPct)}% dei lead al bot`} />
                        <FunnelRow label="Freschi ai GDO" value={fmtInt(r.freschi)} detail="capacita GDO al netto dei ridati" />
                        <FunnelRow label="Database" value={fmtInt(r.leadDatabase)} />
                        <FunnelRow label="Totale lead lavorati" value={fmtInt(r.leadTotali)} strong />
                    </div>

                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
                        <h3 className="mb-2 text-sm font-bold text-brand-charcoal">Appuntamenti per origine</h3>
                        <FunnelRow label="Da trattenuti bot" value={fmtInt(r.appBot)} detail={`${fmtOne(params.fissBotPct)}% di ${fmtInt(r.trattenuti)}`} />
                        <FunnelRow label="Da ridati" value={fmtInt(r.appRidati)} detail={`${fmtOne(params.fissRidatiPct)}% di ${fmtInt(r.ridati)}`} />
                        <FunnelRow label="Da freschi" value={fmtInt(r.appFreschi)} detail={`${fmtOne(params.fissFreschiPct)}% di ${fmtInt(r.freschi)}`} />
                        <FunnelRow label="Totale evergreen" value={fmtInt(r.appEvergreen)} />
                        <FunnelRow label="Da database" value={fmtInt(r.appDatabase)} detail={`${fmtOne(params.fissDatabasePct)}% di ${fmtInt(r.leadDatabase)}`} />
                        <FunnelRow
                            label="Appuntamenti totali"
                            value={fmtInt(r.appTotali)}
                            strong
                            detail={`${fmtOne(r.appPerGiornoLavorativo)}/giorno lavorativo - ${fmtOne(r.appPerGiornoCalendario)}/giorno di calendario`}
                        />
                    </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Stat label="Appuntamenti" value={fmtInt(r.appTotali)} />
                    <Stat label="Conferme" value={fmtInt(r.conferme)} sub={`${fmtOne(tassoConferma)}% degli appuntamenti`} />
                    <Stat label="Presenze" value={fmtInt(r.presenze)} sub={`${fmtOne(params.presenzaPct)}% delle conferme`} />
                    <Stat label="Vendite" value={fmtInt(r.vendite)} sub={`${fmtOne(params.closingRatePct)}% delle presenze`} tone="good" />
                </div>
            </div>

            {/* ---------------- Risultato ---------------- */}
            <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ash-400">Risultato</h2>
                <div className="grid gap-3 lg:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-soft">
                        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Fatturato</div>
                        <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-900 sm:text-4xl">{fmtEur0(r.fatturato)}</div>
                        <div className="mt-1 text-xs text-emerald-700">
                            {fmtInt(r.vendite)} vendite x {fmtEur0(params.ticketMedio)} - {fmtEur0(r.fatturatoPerGiornoCalendario)}/giorno
                        </div>
                    </div>
                    <div className="rounded-2xl border border-ash-200/60 bg-white p-5 shadow-soft">
                        <div className="text-xs font-semibold uppercase tracking-wide text-ash-500">Budget lead</div>
                        <div className="mt-1 text-3xl font-bold tabular-nums text-brand-charcoal sm:text-4xl">{fmtEur0(r.budget)}</div>
                        <div className="mt-1 text-xs text-ash-500">
                            {fmtInt(r.leadEvergreen)} lead evergreen x {fmtEur0(params.cpl)}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 p-5 shadow-soft">
                        <div className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/70">ROAS</div>
                        <div className="mt-1 text-3xl font-bold tabular-nums text-brand-charcoal sm:text-4xl">{fmtRoas(r.roas)}</div>
                        <div className="mt-1 text-xs text-brand-charcoal/70">fatturato diviso budget lead</div>
                    </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Stat label="Costo per appuntamento" value={fmtEur2(r.costoPerAppuntamento)} sub="budget diviso appuntamenti totali (database inclusi)" />
                    <Stat label="Costo per conferma" value={fmtEur2(r.costoPerConferma)} />
                    <Stat label="Costo per vendita" value={fmtEur2(r.costoPerVendita)} />
                </div>
            </div>

            {/* ---------------- Sensibilita ---------------- */}
            <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ash-400">Sensibilita</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-charcoal">
                            <Percent className="h-4 w-4 text-brand-orange" />
                            ROAS al variare del closing rate
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[26rem] text-sm">
                                <thead>
                                    <tr className="border-b border-ash-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                        <th className="py-2 pr-3">Closing</th>
                                        <th className="py-2 pr-3 text-right">Vendite</th>
                                        <th className="py-2 pr-3 text-right">Fatturato</th>
                                        <th className="py-2 text-right">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {closingRows.map(({ v, res }) => {
                                        const current = Math.abs(v - params.closingRatePct) < 0.001;
                                        return (
                                            <tr
                                                key={v}
                                                className={`border-b border-ash-100 last:border-b-0 ${current ? 'bg-brand-orange/10 font-bold' : ''}`}
                                            >
                                                <td className="py-2 pr-3 tabular-nums text-brand-charcoal">{fmtOne(v)}%</td>
                                                <td className="py-2 pr-3 text-right tabular-nums text-ash-600">{fmtInt(res.vendite)}</td>
                                                <td className="py-2 pr-3 text-right tabular-nums text-ash-600">{fmtEur0(res.fatturato)}</td>
                                                <td className="py-2 text-right tabular-nums text-brand-charcoal">{fmtRoas(res.roas)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-charcoal">
                            <Euro className="h-4 w-4 text-brand-orange" />
                            ROAS al variare del CPL
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[26rem] text-sm">
                                <thead>
                                    <tr className="border-b border-ash-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ash-500">
                                        <th className="py-2 pr-3">CPL</th>
                                        <th className="py-2 pr-3 text-right">Budget</th>
                                        <th className="py-2 pr-3 text-right">Costo/app.</th>
                                        <th className="py-2 text-right">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cplRows.map(({ v, res }) => {
                                        const current = Math.abs(v - params.cpl) < 0.001;
                                        return (
                                            <tr
                                                key={v}
                                                className={`border-b border-ash-100 last:border-b-0 ${current ? 'bg-brand-orange/10 font-bold' : ''}`}
                                            >
                                                <td className="py-2 pr-3 tabular-nums text-brand-charcoal">{fmtEur0(v)}</td>
                                                <td className="py-2 pr-3 text-right tabular-nums text-ash-600">{fmtEur0(res.budget)}</td>
                                                <td className="py-2 pr-3 text-right tabular-nums text-ash-600">{fmtEur2(res.costoPerAppuntamento)}</td>
                                                <td className="py-2 text-right tabular-nums text-brand-charcoal">{fmtRoas(res.roas)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ash-400">
                    Le sensibilita rieseguono il modello intero cambiando un solo parametro alla volta:
                    tutto il resto resta come impostato qui sopra.
                </p>
            </div>
        </div>
    );
}
