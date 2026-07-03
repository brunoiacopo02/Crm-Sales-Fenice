import { getBotFissatoreStats } from '@/app/actions/botStatsActions';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server";
import Link from 'next/link';
import { Activity, ArrowRightLeft, CalendarCheck, Undo2 } from 'lucide-react';

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
    const stats = await getBotFissatoreStats(days);

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
                        sub={`sui ${stats.ridati} lead restituiti al team`}
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

            <p className="text-xs text-ash-400">
                Nota: la coorte è per data di presa in carico (primo push riuscito, riassegnazione o chiamata registrata).
                I fissati sono contati dagli esiti registrati, quindi restano conteggiati anche se il lead viene poi scartato o riassegnato.
            </p>
        </div>
    );
}
