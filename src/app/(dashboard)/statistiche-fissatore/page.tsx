import { getBotFissatoreStats, getBotFissatoreCutoverComparison } from '@/app/actions/botStatsActions';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server";
import Link from 'next/link';
import { Activity, ArrowRightLeft, CalendarCheck, TrendingUp, Undo2 } from 'lucide-react';

const PRESETS = [7, 14, 30, 60, 90];

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
    return (
        <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft p-4">
            <div className="text-xs font-semibold text-ash-500 uppercase tracking-wider">{label}</div>
            <div className={`mt-1 text-2xl font-bold tracking-tight ${accent || 'text-brand-charcoal'}`}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-ash-500">{sub}</div>}
        </div>
    );
}

export default async function StatisticheFissatorePage({
    searchParams
}: {
    searchParams: { days?: string }
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['MANAGER', 'ADMIN', 'TL'].includes(role)) {
        redirect('/unauthorized');
    }

    const days = Math.min(Math.max(parseInt(searchParams.days || '30', 10) || 30, 1), 365);
    const [stats, cutover] = await Promise.all([
        getBotFissatoreStats(days),
        getBotFissatoreCutoverComparison(),
    ]);

    if (!stats) {
        return (
            <div className="p-6 lg:p-8">
                <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">Statistiche Fissatore</h1>
                <div className="mt-6 text-center p-12 bg-white rounded-xl border border-dashed border-ash-300 text-ash-400">
                    Nessun account fissatore attivo per questa azienda.
                </div>
            </div>
        );
    }

    const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const pct = (num: number, den: number) => den > 0 ? (num / den * 100).toFixed(1) + '%' : '-';
    const eur = (v: number) => '€ ' + Math.round(v).toLocaleString('it-IT');

    return (
        <div className="p-6 lg:p-8 space-y-8">
            {/* Header + selettore periodo */}
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal flex items-center gap-2">
                        <Activity className="w-6 h-6 text-brand-orange" /> Statistiche Fissatore
                    </h1>
                    <p className="mt-1 text-sm text-ash-500">
                        {stats.botName} · finestra mobile {fmt(stats.from)} → {fmt(stats.to)} · coorte per data di presa in carico
                    </p>
                </div>
                <div className="lg:ml-auto flex flex-wrap items-center gap-2">
                    {PRESETS.map(p => (
                        <Link
                            key={p}
                            href={`/statistiche-fissatore?days=${p}`}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${p === stats.days
                                ? 'bg-brand-charcoal text-white border-brand-charcoal'
                                : 'bg-white text-ash-600 border-ash-200/60 hover:border-brand-orange/50 hover:text-brand-charcoal'}`}
                        >
                            {p} gg
                        </Link>
                    ))}
                    <form method="GET" className="flex items-center gap-1.5">
                        <input
                            type="number"
                            name="days"
                            min={1}
                            max={365}
                            defaultValue={stats.days}
                            className="h-9 w-20 rounded-lg border border-ash-200/60 bg-white px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30"
                        />
                        <button type="submit" className="h-9 px-3 rounded-lg bg-brand-orange text-white text-sm font-medium hover:bg-brand-orange-600 transition-colors">
                            Applica
                        </button>
                    </form>
                </div>
            </div>

            {/* Flusso lead */}
            <section>
                <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-brand-orange" /> Flusso lead ({stats.days} giorni)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                    <StatCard label="Ricevuti" value={stats.ricevuti} sub="entrati in carico nel periodo" />
                    <StatCard label="Ridati ai GDO" value={stats.ridati} sub={`${stats.percRidati} dei ricevuti`} accent="text-amber-500" />
                    <StatCard label="Tenuti" value={stats.tenuti} sub="mai ridistribuiti" />
                    <StatCard label="Fissati" value={stats.fissati} sub={`${stats.percFissRicevuti} dei ricevuti`} accent="text-emerald-600" />
                    <StatCard label="Scartati" value={stats.scartati} sub={`obiezione ferrea · ${stats.percScartati}`} accent="text-red-500" />
                    <StatCard label="In lavorazione" value={stats.inLavorazione} sub="ancora in chat" accent="text-sky-600" />
                </div>
            </section>

            {/* Conversione fissaggio */}
            <section>
                <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <CalendarCheck className="w-4 h-4 text-brand-orange" /> Conversione fissaggio
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard
                        label="% Fissaggio su tutti i ricevuti"
                        value={stats.percFissRicevuti}
                        sub={`${stats.fissati} fissati su ${stats.ricevuti} ricevuti`}
                        accent="text-brand-orange"
                    />
                    <StatCard
                        label="% Fissaggio sui tenuti"
                        value={stats.percFissTenuti}
                        sub={`${stats.fissatiTenuti} fissati su ${stats.tenuti} lead non ridistribuiti`}
                        accent="text-emerald-600"
                    />
                    <StatCard
                        label="Ridati poi fissati dai GDO"
                        value={`${stats.fissatiRidatiGdo} (${stats.percRidatiFissati})`}
                        sub={`${stats.fissatiRidatiMaiRisposto} da mai risposto · ${stats.fissatiRidatiChatInterrotta} da chat interrotta`}
                        accent="text-amber-500"
                    />
                </div>
            </section>

            {/* Dettaglio ridati + esiti a valle */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <section>
                    <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Undo2 className="w-4 h-4 text-brand-orange" /> Motivo dei ridati
                    </h2>
                    <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft divide-y divide-ash-100">
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Mai risposto</div>
                            <div className="font-bold text-brand-charcoal">{stats.ridatiMaiRisposto}</div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Chat interrotta</div>
                            <div className="font-bold text-brand-charcoal">{stats.ridatiChatInterrotta}</div>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-ash-50/50">
                            <div className="text-sm font-semibold text-ash-700">Totale ridati</div>
                            <div className="font-bold text-amber-500">{stats.ridati}</div>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-brand-orange" /> A valle dei fissati ({stats.fissati})
                    </h2>
                    <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft divide-y divide-ash-100">
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Confermati (Conferme)</div>
                            <div className="font-bold text-sky-600">{stats.confermati} <span className="text-ash-400 font-normal text-sm">({stats.percConfermati})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Presenziati (Venditore)</div>
                            <div className="font-bold text-brand-charcoal">{stats.presenziati} <span className="text-ash-400 font-normal text-sm">({stats.percPresenziati})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Chiusi</div>
                            <div className="font-bold text-emerald-600">{stats.chiusi} <span className="text-ash-400 font-normal text-sm">({stats.percChiusi})</span></div>
                        </div>
                    </div>
                </section>
            </div>

            {/* Funnel dei ridati: quanto costano e quanto rendono i lead restituiti ai GDO */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <section>
                    <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Undo2 className="w-4 h-4 text-brand-orange" /> Lavorazione GDO sui ridati ({stats.ridati})
                    </h2>
                    <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft divide-y divide-ash-100">
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Lavorati (almeno 1 chiamata)</div>
                            <div className="font-bold text-brand-charcoal">{stats.ridatiLavoratiGdo} <span className="text-ash-400 font-normal text-sm">({pct(stats.ridatiLavoratiGdo, stats.ridati)})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Chiamate GDO spese</div>
                            <div className="font-bold text-brand-charcoal">{stats.ridatiChiamateGdo} <span className="text-ash-400 font-normal text-sm">({stats.ridatiLavoratiGdo > 0 ? (stats.ridatiChiamateGdo / stats.ridatiLavoratiGdo).toFixed(1) : '-'} per lead)</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Fissati dai GDO</div>
                            <div className="font-bold text-amber-500">{stats.fissatiRidatiGdo} <span className="text-ash-400 font-normal text-sm">({stats.percRidatiFissati})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Scartati dai GDO</div>
                            <div className="font-bold text-red-500">{stats.ridatiScartatiGdo} <span className="text-ash-400 font-normal text-sm">({pct(stats.ridatiScartatiGdo, stats.ridati)})</span></div>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-brand-orange" /> A valle dei ridati fissati ({stats.fissatiRidatiGdo})
                    </h2>
                    <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft divide-y divide-ash-100">
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Confermati (Conferme)</div>
                            <div className="font-bold text-sky-600">{stats.ridatiConfermati} <span className="text-ash-400 font-normal text-sm">({pct(stats.ridatiConfermati, stats.fissatiRidatiGdo)})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Presenziati (Venditore)</div>
                            <div className="font-bold text-brand-charcoal">{stats.ridatiPresenziati} <span className="text-ash-400 font-normal text-sm">({pct(stats.ridatiPresenziati, stats.fissatiRidatiGdo)})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="text-sm text-ash-600">Chiusi</div>
                            <div className="font-bold text-emerald-600">{stats.ridatiChiusi} <span className="text-ash-400 font-normal text-sm">({pct(stats.ridatiChiusi, stats.fissatiRidatiGdo)})</span></div>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-ash-50/50">
                            <div className="text-sm font-semibold text-ash-700">Fatturato dai ridati</div>
                            <div className="font-bold text-emerald-600">{eur(stats.ridatiFatturatoEur)}</div>
                        </div>
                    </div>
                </section>
            </div>

            {/* Confronto coorti pre/post modifiche fornitore del 24/07 (report quindicinale) */}
            {cutover && (
                <section>
                    <h2 className="text-sm font-semibold text-ash-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-brand-orange" /> Pre/post modifiche fissatore (24/07) — target ridati ≤50%, fissati ≥8%
                    </h2>
                    <div className="rounded-xl border border-ash-200/60 bg-white shadow-soft overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ash-100 text-xs font-semibold text-ash-500 uppercase tracking-wider">
                                    <th className="text-left p-4">Metrica</th>
                                    <th className="text-right p-4">Pre (30gg fino al 23/07)</th>
                                    <th className="text-right p-4">Post (dal 24/07 · {cutover.postDays} gg)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ash-100">
                                <tr>
                                    <td className="p-4 text-ash-600">Ricevuti</td>
                                    <td className="p-4 text-right font-bold text-brand-charcoal">{cutover.pre.ricevuti}</td>
                                    <td className="p-4 text-right font-bold text-brand-charcoal">{cutover.post.ricevuti}</td>
                                </tr>
                                <tr>
                                    <td className="p-4 text-ash-600">Ridati ai GDO</td>
                                    <td className="p-4 text-right font-bold text-amber-500">{cutover.pre.ridati} <span className="text-ash-400 font-normal text-xs">({cutover.pre.percRidati})</span></td>
                                    <td className="p-4 text-right font-bold text-amber-500">{cutover.post.ridati} <span className="text-ash-400 font-normal text-xs">({cutover.post.percRidati})</span></td>
                                </tr>
                                <tr>
                                    <td className="p-4 text-ash-600">Fissati dal fissatore</td>
                                    <td className="p-4 text-right font-bold text-emerald-600">{cutover.pre.fissati} <span className="text-ash-400 font-normal text-xs">({cutover.pre.percFissRicevuti})</span></td>
                                    <td className="p-4 text-right font-bold text-emerald-600">{cutover.post.fissati} <span className="text-ash-400 font-normal text-xs">({cutover.post.percFissRicevuti})</span></td>
                                </tr>
                                <tr>
                                    <td className="p-4 text-ash-600">Scartati (obiezione ferrea)</td>
                                    <td className="p-4 text-right font-bold text-red-500">{cutover.pre.scartati} <span className="text-ash-400 font-normal text-xs">({cutover.pre.percScartati})</span></td>
                                    <td className="p-4 text-right font-bold text-red-500">{cutover.post.scartati} <span className="text-ash-400 font-normal text-xs">({cutover.post.percScartati})</span></td>
                                </tr>
                                <tr>
                                    <td className="p-4 text-ash-600">In lavorazione</td>
                                    <td className="p-4 text-right font-bold text-sky-600">{cutover.pre.inLavorazione}</td>
                                    <td className="p-4 text-right font-bold text-sky-600">{cutover.post.inLavorazione}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    {cutover.postDays < 14 && (
                        <div className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2">
                            ⚠️ Con le sequenze da 12 giorni la coorte post matura in ~14 giorni: molti lead post-24/07 sono
                            ancora in lavorazione e le percentuali di ridati/fissati sono provvisorie (attesi numeri stabili da metà agosto).
                        </div>
                    )}
                </section>
            )}

            <p className="text-xs text-ash-400">
                Nota: la coorte è per data di presa in carico (primo push riuscito, riassegnazione o chiamata registrata).
                I fissati sono contati dagli esiti registrati, quindi restano conteggiati anche se il lead viene poi scartato o riassegnato.
            </p>
        </div>
    );
}
