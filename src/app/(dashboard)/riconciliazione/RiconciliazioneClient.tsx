'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertTriangle,
    CheckCircle2,
    FileUp,
    History,
    RefreshCw,
    Scale,
    ShieldAlert,
    Undo2,
} from 'lucide-react';
import {
    confrontaMese,
    confrontaMeseDaCsv,
    applicaCorrezioni,
    annullaRun,
    elencoRun,
    type RiconciliazioneRunSummary,
} from '@/app/actions/riconciliazioneActions';
import type { DiffEntry, Family } from '@/lib/riconciliazione/match';

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

/** Ultimi n mesi ('YYYY-MM'), dal più recente, a partire dal mese corrente. Stessa logica di SalesManagerView. */
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

const eur2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEur = (n: number) => eur2.format(n);
const fmtEurSigned = (n: number) => (n > 0 ? '+' : '') + eur2.format(n);
const fmtDate = (d: Date | string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(d));

/**
 * Ordine e testi fissati dal brief: nell'ordine in cui l'errore costa di più
 * a leggersi (esiti mancanti, poi importi) prima delle famiglie più rare.
 * `solo-crm` va per ultima ed è l'unica che TOGLIE fatturato dal CRM.
 */
const FAMILY_ORDER: Family[] = ['esito-mancante', 'importo', 'lead-scartato', 'lead-assente', 'solo-crm'];

const FAMILY_META: Record<Family, { title: string; hint: string; danger?: boolean }> = {
    'esito-mancante': {
        title: 'Esito mancante nel CRM',
        hint: 'Il foglio dice che ha firmato, il CRM non registra ancora una chiusura.',
    },
    'importo': {
        title: 'Importo diverso',
        hint: "L'importo chiuso nel CRM non coincide con quello del foglio.",
    },
    'lead-scartato': {
        title: 'Lead scartato nel CRM ma firmato nel foglio',
        hint: 'Il lead risulta scartato/rifiutato, ma il foglio riporta una firma.',
    },
    'lead-assente': {
        title: 'Lead assente dal CRM',
        hint: 'Nessun lead corrisponde a questo contratto: verrà creato un lead "fuori funnel".',
    },
    'solo-crm': {
        title: 'Chiuso nel CRM ma assente dal foglio',
        hint: 'Il CRM segna una chiusura che il foglio non conferma (o è passata a Stand-by): applicare TOGLIE fatturato registrato.',
        danger: true,
    },
};

/** Spuntate di default SOLO queste due famiglie (regola esplicita del brief). */
const DEFAULT_CHECKED_FAMILIES = new Set<Family>(['esito-mancante', 'importo']);

function contactLabel(e: DiffEntry): string {
    return e.sheet?.fullName || e.crm?.fullName || '(senza nome)';
}

function amountLabel(e: DiffEntry): number {
    return e.sheet?.amountEur ?? e.crm?.amountEur ?? 0;
}

export default function RiconciliazioneClient({ currentYearMonth }: { currentYearMonth: string }) {
    const router = useRouter();
    const months = useMemo(() => lastNMonths(currentYearMonth, 12), [currentYearMonth]);
    const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // `source`/`csvText` viaggiano SEMPRE insieme al resto del risultato: sono
    // ciò che garantisce che un Applica vada verso la stessa sorgente da cui è
    // arrivato il confronto mostrato a schermo (mai comparare da CSV e
    // applicare contro il foglio live, o viceversa). `csvText` è il testo
    // esatto già confrontato: applicaCorrezioni lo ri-userà per il ricalcolo
    // server-side, non ne serve uno nuovo dal file (che nel frattempo l'admin
    // potrebbe aver sostituito sul disco).
    const [result, setResult] = useState<{
        entries: DiffEntry[];
        sheetContracts: number;
        sheetTotalEur: number;
        crmTotalEur: number;
        monthKey: string;
        source: 'sheet' | 'csv';
        csvText: string | null;
    } | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [csvLoading, setCsvLoading] = useState(false);
    const [csvFileName, setCsvFileName] = useState<string | null>(null);

    const [runs, setRuns] = useState<RiconciliazioneRunSummary[] | null>(null);
    const [runsError, setRunsError] = useState<string | null>(null);

    const [applying, setApplying] = useState(false);
    const [applyMessage, setApplyMessage] = useState<string | null>(null);
    const [revertingId, setRevertingId] = useState<string | null>(null);

    const loadRuns = useCallback(async (monthKey: string) => {
        setRunsError(null);
        try {
            const rows = await elencoRun(monthKey);
            setRuns(rows);
        } catch (e) {
            // elencoRun LANCIA (non ritorna { success:false }) su "non admin" o mese
            // malformato: qui va intercettato esplicitamente, altrimenti la pagina
            // crasherebbe invece di mostrare un errore leggibile.
            setRuns(null);
            setRunsError(e instanceof Error ? e.message : 'Impossibile leggere lo storico delle riconciliazioni.');
        }
    }, []);

    const runConfronto = useCallback(async (monthKey: string) => {
        setLoading(true);
        setError(null);
        setApplyMessage(null);
        try {
            const res = await confrontaMese(monthKey);
            if (!res.success) {
                setError(res.error);
                setResult(null);
                setChecked(new Set());
            } else {
                setResult({ entries: res.entries, sheetContracts: res.sheetContracts, sheetTotalEur: res.sheetTotalEur, crmTotalEur: res.crmTotalEur, monthKey, source: 'sheet', csvText: null });
                setCsvFileName(null);
                // Default: spuntate solo esito-mancante/importo, e solo se applicabili
                // (una riga bloccata non deve mai partire spuntata).
                const initial = new Set(
                    res.entries
                        .filter(e => DEFAULT_CHECKED_FAMILIES.has(e.family) && e.appliable)
                        .map(e => e.key),
                );
                setChecked(initial);
            }
        } finally {
            setLoading(false);
        }
        await loadRuns(monthKey);
    }, [loadRuns]);

    // Percorso di riserva: stesso normalizzatore (parseSheetRows), stesse regole,
    // solo un'origine diversa per le righe grezze. `csvText` resta agganciato al
    // risultato così l'Applica successivo ricalcola SEMPRE dallo stesso CSV, mai
    // dal foglio live.
    const runConfrontoCsv = useCallback(async (monthKey: string, csvText: string) => {
        setCsvLoading(true);
        setError(null);
        setApplyMessage(null);
        try {
            const res = await confrontaMeseDaCsv(monthKey, csvText);
            if (!res.success) {
                setError(res.error);
                setResult(null);
                setChecked(new Set());
            } else {
                setResult({ entries: res.entries, sheetContracts: res.sheetContracts, sheetTotalEur: res.sheetTotalEur, crmTotalEur: res.crmTotalEur, monthKey, source: 'csv', csvText });
                const initial = new Set(
                    res.entries
                        .filter(e => DEFAULT_CHECKED_FAMILIES.has(e.family) && e.appliable)
                        .map(e => e.key),
                );
                setChecked(initial);
            }
        } finally {
            setCsvLoading(false);
        }
        await loadRuns(monthKey);
    }, [loadRuns]);

    const handleCsvFile = useCallback((file: File) => {
        setCsvFileName(file.name);
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            runConfrontoCsv(selectedMonth, text);
        };
        reader.onerror = () => {
            setError('Impossibile leggere il file CSV selezionato.');
        };
        reader.readAsText(file, 'utf-8');
    }, [runConfrontoCsv, selectedMonth]);

    // Storico caricato anche all'apertura pagina, per il mese corrente, così
    // l'admin vede subito se qualcuno ha già lavorato il mese senza dover
    // premere Confronta.
    useEffect(() => {
        loadRuns(currentYearMonth);
    }, [currentYearMonth, loadRuns]);

    const toggleRow = (key: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const grouped = useMemo(() => {
        if (!result) return null;
        const byFamily = new Map<Family, DiffEntry[]>();
        for (const f of FAMILY_ORDER) byFamily.set(f, []);
        for (const e of result.entries) {
            byFamily.get(e.family)?.push(e);
        }
        return byFamily;
    }, [result]);

    const selectedEntries = useMemo(() => {
        if (!result) return [];
        return result.entries.filter(e => checked.has(e.key));
    }, [result, checked]);

    const handleApplica = async () => {
        if (!result || selectedEntries.length === 0) return;
        const totalDelta = selectedEntries.reduce((s, e) => s + e.deltaEur, 0);
        const hasSoloCrm = selectedEntries.some(e => e.family === 'solo-crm');
        const confirmMsg =
            `Stai per applicare ${selectedEntries.length} correzion${selectedEntries.length === 1 ? 'e' : 'i'} ` +
            `per ${monthLabel(result.monthKey)}, spostamento netto sul fatturato CRM: ${fmtEurSigned(totalDelta)}.` +
            (hasSoloCrm ? '\n\nATTENZIONE: fra queste ci sono righe "solo-crm" che TOLGONO fatturato già registrato.' : '') +
            '\n\nConfermi?';
        if (!window.confirm(confirmMsg)) return;

        setApplying(true);
        setApplyMessage(null);
        try {
            const keys = selectedEntries.map(e => e.key);
            // La sorgente dell'Applica è SEMPRE quella del confronto mostrato a
            // schermo: se `result` viene da un CSV caricato, il ricalcolo
            // server-side deve rileggere lo STESSO CSV, mai il foglio live (che
            // potrebbe nel frattempo dire un'altra cosa, o essere proprio la
            // ragione per cui l'admin è passato al CSV).
            const res = result.source === 'csv'
                ? await applicaCorrezioni(result.monthKey, keys, result.csvText!)
                : await applicaCorrezioni(result.monthKey, keys);
            if (!res.success) {
                setApplyMessage('Errore: ' + res.error);
            } else {
                setApplyMessage(`Applicate ${res.applied} correzioni.`);
                if (result.source === 'csv') await runConfrontoCsv(result.monthKey, result.csvText!);
                else await runConfronto(result.monthKey);
                router.refresh();
            }
        } finally {
            setApplying(false);
        }
    };

    const handleAnnulla = async (run: RiconciliazioneRunSummary) => {
        if (!window.confirm(`Annullare la riconciliazione del ${fmtDate(run.appliedAt)} (${run.entryCount} correzioni)? Ripristina lo stato precedente su ogni lead toccato.`)) return;
        setRevertingId(run.id);
        try {
            const res = await annullaRun(run.id);
            if (!res.success) {
                window.alert('Errore: ' + res.error);
            } else {
                window.alert(`Annullate ${res.reverted} correzioni.`);
                // Ri-confronta con la STESSA sorgente mostrata a schermo (vedi
                // handleApplica): l'annullamento è indipendente dalla sorgente
                // (agisce sulle entries salvate, non ricalcola), ma il refresh
                // successivo del confronto deve restare coerente con essa.
                if (result?.source === 'csv') await runConfrontoCsv(result.monthKey, result.csvText!);
                else if (result) await runConfronto(result.monthKey);
                else await loadRuns(selectedMonth);
                router.refresh();
            }
        } finally {
            setRevertingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Scale className="h-6 w-6 text-brand-orange" />
                <h1 className="text-xl font-bold text-ash-800">Riconciliazione fatturato</h1>
            </div>
            <p className="text-sm text-ash-500">
                Confronta un mese del CRM con il foglio &quot;Database Clienti&quot;, seleziona le correzioni da applicare e tieni
                traccia di ogni run per poterla annullare in caso di errore.
            </p>

            {/* Selettore mese + Confronta, stesso pattern di /panoramica-generale */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-ash-200 bg-white px-3 py-2 shadow-sm">
                    <label htmlFor="ric-month" className="text-xs font-semibold uppercase tracking-wider text-ash-500">
                        Mese
                    </label>
                    <select
                        id="ric-month"
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
                <div>
                    <button
                        type="button"
                        disabled={loading || csvLoading}
                        onClick={() => runConfronto(selectedMonth)}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        {loading ? 'Confronto in corso…' : 'Confronta'}
                    </button>
                </div>

                {/*
                    Riserva manuale: quando il service account perde l'accesso al
                    foglio o l'IMPORTRANGE si rompe, confrontaMese torna un errore
                    e l'admin non ha altro modo di chiudere il mese. Questo input
                    carica il CSV esportato a mano dal tab "Database Clienti" e lo
                    fa passare dallo STESSO parseSheetRows del percorso live
                    (via confrontaMeseDaCsv): le regole non possono divergere.
                */}
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-ash-300 bg-white px-3 py-2 shadow-sm">
                    <label
                        htmlFor="ric-csv-input"
                        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-ash-100 px-3 py-1.5 text-xs font-semibold text-ash-700 transition hover:bg-ash-200"
                    >
                        <FileUp className={`h-3.5 w-3.5 ${csvLoading ? 'animate-pulse' : ''}`} />
                        {csvLoading ? 'Carico il CSV…' : 'Oppure carica il CSV del tab Database Clienti'}
                    </label>
                    <input
                        id="ric-csv-input"
                        type="file"
                        accept=".csv,text/csv"
                        disabled={loading || csvLoading}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleCsvFile(file);
                            // Reset per poter ricaricare lo stesso file una seconda volta
                            // (onChange non spara se il valore non cambia).
                            e.target.value = '';
                        }}
                        className="hidden"
                    />
                    {csvFileName && !csvLoading && (
                        <span className="text-xs text-ash-500">{csvFileName}</span>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            {applyMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>{applyMessage}</div>
                </div>
            )}

            {result && (
                <>
                    {/*
                        La sorgente del confronto mostrato dev'essere sempre visibile:
                        un Applica va SEMPRE verso questa stessa sorgente (mai
                        confrontare da CSV e applicare contro il foglio live), quindi
                        l'admin deve poter vedere a colpo d'occhio da dove viene ciò
                        che sta per approvare.
                    */}
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ash-500">
                        Sorgente confronto:
                        {result.source === 'csv' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                                <FileUp className="h-3 w-3" /> CSV caricato{csvFileName ? ` (${csvFileName})` : ''}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                                Foglio Google (live)
                            </span>
                        )}
                    </div>

                    {/* Riepilogo */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <SummaryCard label="Contratti nel foglio" value={String(result.sheetContracts)} />
                        <SummaryCard label="Totale foglio" value={fmtEur(result.sheetTotalEur)} />
                        <SummaryCard label="Totale CRM" value={fmtEur(result.crmTotalEur)} />
                        <SummaryCard
                            label="Differenza"
                            value={fmtEurSigned(result.sheetTotalEur - result.crmTotalEur)}
                            accent={result.sheetTotalEur - result.crmTotalEur === 0 ? 'ok' : 'warn'}
                        />
                    </div>

                    {/* Una sezione per famiglia, nell'ordine fissato */}
                    <div className="space-y-4">
                        {FAMILY_ORDER.map((family) => {
                            const rows = grouped?.get(family) ?? [];
                            if (rows.length === 0) return null;
                            return (
                                <FamilySection
                                    key={family}
                                    family={family}
                                    rows={rows}
                                    checked={checked}
                                    onToggle={toggleRow}
                                />
                            );
                        })}
                        {result.entries.length === 0 && (
                            <div className="rounded-lg border border-ash-200 bg-white p-6 text-center text-sm text-ash-500">
                                Nessuna differenza trovata per {monthLabel(result.monthKey)}.
                            </div>
                        )}
                    </div>

                    {/* Applica */}
                    <div className="flex items-center gap-3 rounded-lg border border-ash-200 bg-white p-4 shadow-sm">
                        <div className="text-sm text-ash-600">
                            {selectedEntries.length} riga{selectedEntries.length === 1 ? '' : 'he'} selezionat{selectedEntries.length === 1 ? 'a' : 'e'},
                            {' '}spostamento netto {fmtEurSigned(selectedEntries.reduce((s, e) => s + e.deltaEur, 0))}
                        </div>
                        <div>
                            <button
                                type="button"
                                disabled={applying || selectedEntries.length === 0}
                                onClick={handleApplica}
                                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <CheckCircle2 className="h-4 w-4" />
                                {applying ? 'Applico…' : 'Applica le correzioni spuntate'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Storico run del mese selezionato (o, se non ancora confrontato, del mese corrente) */}
            <div className="rounded-lg border border-ash-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                    <History className="h-4 w-4 text-ash-500" />
                    <h2 className="text-sm font-bold text-ash-800">
                        Storico riconciliazioni — {monthLabel(result?.monthKey ?? selectedMonth)}
                    </h2>
                </div>
                {runsError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div>{runsError}</div>
                    </div>
                )}
                {!runsError && runs !== null && runs.length === 0 && (
                    <p className="text-sm text-ash-500">Nessuna riconciliazione applicata per questo mese.</p>
                )}
                {!runsError && runs !== null && runs.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ash-100 text-left text-xs font-semibold uppercase tracking-wider text-ash-500">
                                    <th className="py-2 pr-3">Data</th>
                                    <th className="py-2 pr-3">Da</th>
                                    <th className="py-2 pr-3">Correzioni</th>
                                    <th className="py-2 pr-3">Stato</th>
                                    <th className="py-2 pr-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {runs.map((run) => (
                                    <tr key={run.id} className="border-b border-ash-50 last:border-0">
                                        <td className="py-2 pr-3 text-ash-700">{fmtDate(run.appliedAt)}</td>
                                        <td className="py-2 pr-3 text-ash-700">{run.appliedBy}</td>
                                        <td className="py-2 pr-3 text-ash-700">{run.entryCount}</td>
                                        <td className="py-2 pr-3">
                                            {run.revertedAt ? (
                                                <span className="rounded-full bg-ash-100 px-2 py-0.5 text-xs font-semibold text-ash-500">
                                                    Annullata il {fmtDate(run.revertedAt)}
                                                </span>
                                            ) : (
                                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                                    Attiva
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-3 text-right">
                                            {!run.revertedAt && (
                                                <div>
                                                    <button
                                                        type="button"
                                                        disabled={revertingId === run.id}
                                                        onClick={() => handleAnnulla(run)}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        <Undo2 className="h-3.5 w-3.5" />
                                                        {revertingId === run.id ? 'Annullo…' : 'Annulla'}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: 'ok' | 'warn' }) {
    const color = accent === 'ok' ? 'text-emerald-600' : accent === 'warn' ? 'text-brand-orange' : 'text-ash-800';
    return (
        <div className="rounded-lg border border-ash-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ash-500">{label}</div>
            <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
        </div>
    );
}

function FamilySection({
    family,
    rows,
    checked,
    onToggle,
}: {
    family: Family;
    rows: DiffEntry[];
    checked: Set<string>;
    onToggle: (key: string) => void;
}) {
    const meta = FAMILY_META[family];
    const total = rows.reduce((s, e) => s + e.deltaEur, 0);
    const isDanger = !!meta.danger;

    // solo-crm deve saltare all'occhio: bordo e sfondo rossi, banner esplicito,
    // così una spunta distratta in questa sezione (l'unica che toglie
    // fatturato già registrato) non passi inosservata.
    return (
        <div className={`rounded-lg border p-4 shadow-sm ${isDanger ? 'border-red-300 bg-red-50' : 'border-ash-200 bg-white'}`}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {isDanger && <ShieldAlert className="h-4 w-4 text-red-600" />}
                    <h3 className={`text-sm font-bold ${isDanger ? 'text-red-800' : 'text-ash-800'}`}>{meta.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isDanger ? 'bg-red-200 text-red-800' : 'bg-ash-100 text-ash-600'}`}>
                        {rows.length}
                    </span>
                </div>
                <div className={`text-sm font-semibold ${isDanger ? 'text-red-800' : 'text-ash-700'}`}>{fmtEurSigned(total)}</div>
            </div>
            <p className={`mb-3 text-xs ${isDanger ? 'text-red-700' : 'text-ash-500'}`}>{meta.hint}</p>
            {isDanger && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 p-2 text-xs font-semibold text-red-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <div>Nessuna riga di questa sezione è spuntata di default: verificale una per una prima di applicarle, rimuovono fatturato già chiuso.</div>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-ash-100 text-left text-xs font-semibold uppercase tracking-wider text-ash-500">
                            <th className="w-8 py-1.5 pr-2" />
                            <th className="py-1.5 pr-3">Contatto</th>
                            <th className="py-1.5 pr-3">Importo</th>
                            <th className="py-1.5 pr-3">Delta</th>
                            <th className="py-1.5 pr-3">Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((e) => (
                            <tr key={e.key} className="border-b border-ash-50 last:border-0 align-top">
                                <td className="py-1.5 pr-2">
                                    <div>
                                        <input
                                            type="checkbox"
                                            checked={checked.has(e.key)}
                                            disabled={!e.appliable}
                                            onChange={() => onToggle(e.key)}
                                            className="h-4 w-4 cursor-pointer accent-brand-orange disabled:cursor-not-allowed"
                                        />
                                    </div>
                                </td>
                                <td className="py-1.5 pr-3 text-ash-700">{contactLabel(e)}</td>
                                <td className="py-1.5 pr-3 text-ash-700">{fmtEur(amountLabel(e))}</td>
                                <td className="py-1.5 pr-3 font-semibold text-ash-700">{fmtEurSigned(e.deltaEur)}</td>
                                <td className="py-1.5 pr-3 text-xs text-ash-500">
                                    {e.blockedReason ? (
                                        <span className="font-semibold text-red-600">{e.blockedReason}</span>
                                    ) : e.note ? (
                                        <span>{e.note}</span>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
