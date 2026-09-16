"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Users, Zap, RotateCcw, Package, Power, ArrowRightLeft } from "lucide-react";
import {
    setGdoPool, setDailyFreshCap, setGdoActive, spostaLeadAperti,
    type GdoPoolRow, type PoolKind,
} from "@/app/actions/gestionePoolActions";

/**
 * Chiave di sessione del blocco a password. sessionStorage e non localStorage:
 * chiusa la scheda, la password si richiede di nuovo.
 */
const CHIAVE_SBLOCCO = "gestione:sbloccata";
const PASSWORD = "1243";

export default function GestioneClient({ initialGdos }: { initialGdos: GdoPoolRow[] }) {
    const [sbloccata, setSbloccata] = useState(() => {
        try { return sessionStorage.getItem(CHIAVE_SBLOCCO) === "1"; } catch { return false; }
    });

    if (!sbloccata) return <BloccoPassword onSblocca={() => setSbloccata(true)} />;
    return <Pannello initialGdos={initialGdos} />;
}

function BloccoPassword({ onSblocca }: { onSblocca: () => void }) {
    const [valore, setValore] = useState("");
    const [errore, setErrore] = useState(false);

    const prova = (e: React.FormEvent) => {
        e.preventDefault();
        if (valore !== PASSWORD) { setErrore(true); setValore(""); return; }
        try { sessionStorage.setItem(CHIAVE_SBLOCCO, "1"); } catch { /* sessione non disponibile: si procede comunque */ }
        onSblocca();
    };

    return (
        <div className="max-w-md mx-auto px-4 py-20">
            <form onSubmit={prova} className="rounded-2xl border border-ash-200/60 bg-white shadow-soft p-8 text-center">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ash-100 mb-4">
                    <Lock className="h-7 w-7 text-ash-500" />
                </div>
                <h1 className="text-xl font-bold text-ash-800 mb-1">Gestione</h1>
                <p className="text-sm text-ash-500 mb-6">Inserisci il codice per continuare.</p>
                <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={valore}
                    onChange={(e) => { setValore(e.target.value); setErrore(false); }}
                    className={`w-full rounded-lg border px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none transition-colors ${
                        errore ? "border-red-300 bg-red-50 text-red-900" : "border-ash-200 focus:border-brand-orange"
                    }`}
                    placeholder="••••"
                />
                {errore && <p className="mt-2 text-sm text-red-600">Codice errato.</p>}
                <button
                    type="submit"
                    className="mt-5 w-full rounded-lg bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
                >
                    Entra
                </button>
            </form>
        </div>
    );
}

const POOL_META: Record<PoolKind, { etichetta: string; icona: typeof Zap; spiega: string; tono: string }> = {
    freschi: {
        etichetta: "Freschi",
        icona: Zap,
        spiega: "riceve i lead nuovi in arrivo da ActiveCampaign",
        tono: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    ridati: {
        etichetta: "Ridati",
        icona: RotateCcw,
        spiega: "riceve i lead che il bot restituisce (mai risposto o chat interrotta)",
        tono: "bg-sky-50 text-sky-700 border-sky-200",
    },
    scorta: {
        etichetta: "Scorta",
        icona: Package,
        spiega: "riceve i freschi in eccedenza quando gli altri hanno raggiunto il tetto",
        tono: "bg-amber-50 text-amber-700 border-amber-200",
    },
};

function Pannello({ initialGdos }: { initialGdos: GdoPoolRow[] }) {
    const router = useRouter();
    const [inCorso, startTransition] = useTransition();
    const [avviso, setAvviso] = useState<{ tipo: "ok" | "errore"; testo: string } | null>(null);
    const [spostaDa, setSpostaDa] = useState<GdoPoolRow | null>(null);

    const gdos = initialGdos.filter((g) => !g.isBot);
    const bot = initialGdos.find((g) => g.isBot);

    const esegui = (azione: () => Promise<{ success: boolean; error?: string }>, okTesto: string) => {
        startTransition(async () => {
            const r = await azione();
            setAvviso(r.success ? { tipo: "ok", testo: okTesto } : { tipo: "errore", testo: r.error ?? "Non ha funzionato." });
            if (r.success) router.refresh();
        });
    };

    const nome = (g: GdoPoolRow) => g.displayName ?? g.name ?? "senza nome";

    return (
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <header className="mb-6">
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-800">
                    <Users className="h-6 w-6 text-brand-orange" /> Gestione
                </h1>
                <p className="mt-1 text-sm text-ash-500">
                    Chi riceve quali lead. I tre pool sono indipendenti: un GDO può stare in più di uno.
                </p>
            </header>

            <div className="mb-6 grid gap-2 sm:grid-cols-3">
                {(Object.keys(POOL_META) as PoolKind[]).map((k) => {
                    const m = POOL_META[k];
                    const Icona = m.icona;
                    return (
                        <div key={k} className={`rounded-xl border px-3 py-2.5 text-xs ${m.tono}`}>
                            <div className="flex items-center gap-1.5 font-semibold">
                                <Icona className="h-3.5 w-3.5" /> {m.etichetta}
                            </div>
                            <p className="mt-0.5 opacity-80">{m.spiega}</p>
                        </div>
                    );
                })}
            </div>

            {avviso && (
                <div
                    role="status"
                    className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${
                        avviso.tipo === "ok"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-red-200 bg-red-50 text-red-800"
                    }`}
                >
                    {avviso.testo}
                </div>
            )}

            <div className="overflow-x-auto rounded-2xl border border-ash-200/60 bg-white shadow-soft">
                <table className="w-full text-sm">
                    <thead className="border-b border-ash-200/60 bg-ash-50/60 text-xs uppercase tracking-wide text-ash-500">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold">GDO</th>
                            <th className="px-3 py-3 text-center font-semibold">Freschi</th>
                            <th className="px-3 py-3 text-center font-semibold">Ridati</th>
                            <th className="px-3 py-3 text-center font-semibold">Scorta</th>
                            <th className="px-3 py-3 text-center font-semibold">Tetto/gg</th>
                            <th className="px-3 py-3 text-right font-semibold">Oggi</th>
                            <th className="px-3 py-3 text-right font-semibold">1ª chiamata</th>
                            <th className="px-3 py-3 text-right font-semibold">In lavoraz.</th>
                            <th className="px-3 py-3 text-center font-semibold">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ash-100">
                        {gdos.map((g) => (
                            <tr key={g.id} className={g.isActive ? "" : "bg-ash-50/50 text-ash-400"}>
                                <td className="px-4 py-3 font-medium text-ash-800">
                                    <div className="flex items-center gap-2">
                                        <span className={g.isActive ? "" : "line-through"}>{nome(g)}</span>
                                        {!g.isActive && (
                                            <span className="rounded bg-ash-200 px-1.5 py-0.5 text-[10px] font-semibold text-ash-600">
                                                SPENTO
                                            </span>
                                        )}
                                    </div>
                                </td>
                                {(Object.keys(POOL_META) as PoolKind[]).map((k) => (
                                    <td key={k} className="px-3 py-3 text-center">
                                        <input
                                            type="checkbox"
                                            checked={g[k]}
                                            disabled={inCorso || !g.isActive}
                                            onChange={(e) =>
                                                esegui(
                                                    () => setGdoPool(g.id, k, e.target.checked),
                                                    `${nome(g)}: pool ${POOL_META[k].etichetta.toLowerCase()} aggiornato.`,
                                                )
                                            }
                                            className="h-4 w-4 cursor-pointer accent-brand-orange disabled:cursor-not-allowed"
                                            aria-label={`${nome(g)} — pool ${POOL_META[k].etichetta}`}
                                        />
                                    </td>
                                ))}
                                <td className="px-3 py-3 text-center">
                                    <input
                                        type="number"
                                        min={0}
                                        max={1000}
                                        defaultValue={g.dailyFreshCap ?? ""}
                                        disabled={inCorso || !g.isActive}
                                        placeholder="—"
                                        onBlur={(e) => {
                                            const grezzo = e.target.value.trim();
                                            const nuovo = grezzo === "" ? null : Number(grezzo);
                                            if (nuovo === (g.dailyFreshCap ?? null)) return;
                                            esegui(() => setDailyFreshCap(g.id, nuovo), `${nome(g)}: tetto aggiornato.`);
                                        }}
                                        className="w-16 rounded border border-ash-200 px-2 py-1 text-center text-sm outline-none focus:border-brand-orange disabled:bg-ash-50"
                                        aria-label={`${nome(g)} — tetto giornaliero`}
                                    />
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums">
                                    <span className={g.dailyFreshCap != null && g.freschiOggi >= g.dailyFreshCap ? "font-semibold text-amber-600" : ""}>
                                        {g.freschiOggi}
                                    </span>
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums font-medium">{g.maiChiamati}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-ash-500">{g.inLavorazione}</td>
                                <td className="px-3 py-3">
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            type="button"
                                            disabled={inCorso || g.maiChiamati + g.inLavorazione === 0}
                                            onClick={() => setSpostaDa(g)}
                                            title="Sposta i lead aperti a un altro GDO"
                                            className="rounded p-1.5 text-ash-500 transition-colors hover:bg-ash-100 hover:text-ash-800 disabled:opacity-30"
                                        >
                                            <ArrowRightLeft className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={inCorso}
                                            onClick={() =>
                                                esegui(
                                                    () => setGdoActive(g.id, !g.isActive),
                                                    `${nome(g)}: account ${g.isActive ? "spento" : "riacceso"}.`,
                                                )
                                            }
                                            title={g.isActive ? "Spegni l'account" : "Riaccendi l'account"}
                                            className={`rounded p-1.5 transition-colors hover:bg-ash-100 disabled:opacity-30 ${
                                                g.isActive ? "text-ash-500 hover:text-red-600" : "text-emerald-600"
                                            }`}
                                        >
                                            <Power className="h-4 w-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {bot && (
                <p className="mt-3 text-xs text-ash-500">
                    Il bot ({nome(bot)}) non compare in tabella: non passa da questi pool, lo governa la fascia
                    oraria. Oggi ha preso <strong className="tabular-nums">{bot.freschiOggi}</strong> lead.
                </p>
            )}

            {spostaDa && (
                <DialogoSposta
                    da={spostaDa}
                    candidati={gdos.filter((g) => g.id !== spostaDa.id && g.isActive)}
                    inCorso={inCorso}
                    onChiudi={() => setSpostaDa(null)}
                    onConferma={(aId) => {
                        const dest = gdos.find((g) => g.id === aId);
                        setSpostaDa(null);
                        startTransition(async () => {
                            const r = await spostaLeadAperti(spostaDa.id, aId);
                            setAvviso(
                                r.success
                                    ? { tipo: "ok", testo: `Spostati ${r.spostati ?? 0} lead da ${nome(spostaDa)} a ${dest ? nome(dest) : "destinazione"}.` }
                                    : { tipo: "errore", testo: r.error ?? "Non ha funzionato." },
                            );
                            if (r.success) router.refresh();
                        });
                    }}
                />
            )}
        </div>
    );
}

function DialogoSposta({
    da, candidati, inCorso, onChiudi, onConferma,
}: {
    da: GdoPoolRow;
    candidati: GdoPoolRow[];
    inCorso: boolean;
    onChiudi: () => void;
    onConferma: (aId: string) => void;
}) {
    const [dest, setDest] = useState("");
    const totale = da.maiChiamati + da.inLavorazione;
    const nome = (g: GdoPoolRow) => g.displayName ?? g.name ?? "senza nome";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ash-900/40 px-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <h2 className="text-lg font-bold text-ash-800">Sposta i lead aperti</h2>
                <p className="mt-1 text-sm text-ash-500">
                    Da <strong>{nome(da)}</strong>: {da.maiChiamati} di prima chiamata e {da.inLavorazione} in
                    lavorazione, {totale} in tutto. Gli appuntamenti restano a lui.
                </p>
                <select
                    value={dest}
                    onChange={(e) => setDest(e.target.value)}
                    className="mt-4 w-full rounded-lg border border-ash-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                >
                    <option value="">Scegli il GDO di destinazione…</option>
                    {candidati.map((g) => (
                        <option key={g.id} value={g.id}>
                            {nome(g)} — ha {g.maiChiamati} di prima chiamata
                        </option>
                    ))}
                </select>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onChiudi}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-ash-600 transition-colors hover:bg-ash-100"
                    >
                        Annulla
                    </button>
                    <button
                        type="button"
                        disabled={!dest || inCorso}
                        onClick={() => onConferma(dest)}
                        className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                    >
                        Sposta {totale} lead
                    </button>
                </div>
            </div>
        </div>
    );
}
