"use client";

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Check, Clock, Hand, Phone, UserPlus, X } from 'lucide-react';
import {
    assignContactRequest,
    closeContactRequest,
    resolveContactRequest,
    takeChargeContactRequest,
    type ContactOutcome,
    type ContactRequestRow,
    type ContactRequestsView,
} from '@/app/actions/contactRequestActions';
import { contactCategoryLabel } from '@/lib/bot-fissatore/contactRequests';

/**
 * Le etichette degli esiti. Le chiavi sono il vocabolario condiviso col
 * fornitore e vivono in contactRequestActions: quel file è `'use server'` e
 * Next.js accetta solo export di funzioni async, quindi le etichette leggibili
 * stanno qui. Il `Record<ContactOutcome, string>` non è decorativo — è il
 * vincolo che fa fallire il type-check se di là si aggiunge o si toglie un
 * esito e qui nessuno se ne accorge.
 */
const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
    chiamato_ok: 'Parlato, tutto a posto',
    non_raggiungibile: 'Non raggiungibile',
    rifissato: 'Appuntamento rifissato',
    disdetto: 'Ha disdetto',
    non_gestito: 'Non gestito',
};

/** "38 ore" non dice niente a colpo d'occhio: oltre le 48 si ragiona in giorni. */
function waitLabel(hours: number): string {
    if (hours < 1) return 'meno di un\'ora';
    if (hours < 48) return `${hours} ${hours === 1 ? 'ora' : 'ore'}`;
    return `${Math.floor(hours / 24)} giorni`;
}

function waitTone(hours: number): string {
    if (hours >= 72) return 'bg-red-50 text-red-700 border-red-200';
    if (hours >= 24) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-ash-50 text-ash-600 border-ash-200';
}

const STATUS_LABEL: Record<string, string> = {
    NEW: 'Nuovo',
    IN_PROGRESS: 'In lavorazione',
    APPOINTMENT: 'Appuntamento fissato',
    REJECTED: 'Scartato',
};

function InfoGrid({ info }: { info: Record<string, unknown> }) {
    const entries = Object.entries(info).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return null;
    return (
        <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {entries.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-sm">
                    <span className="shrink-0 font-medium capitalize text-ash-500">{k.replace(/([A-Z])/g, ' $1')}:</span>
                    <span className="text-brand-charcoal">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                </div>
            ))}
        </div>
    );
}

function RequestCard({ row, gdos, canAssign }: { row: ContactRequestRow; gdos: ContactRequestsView['gdos']; canAssign: boolean }) {
    const router = useRouter();
    const [gdoId, setGdoId] = useState('');
    const [outcome, setOutcome] = useState<ContactOutcome | ''>('');
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
        setError(null);
        startTransition(async () => {
            const res = await fn();
            if (!res.ok) setError(res.error ?? 'Operazione non riuscita.');
            else router.refresh();
        });
    };

    return (
        <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-brand-charcoal">{row.leadName}</span>
                        <span className="rounded-full border border-ash-200 bg-ash-50 px-2 py-0.5 text-xs font-semibold text-ash-600">
                            {contactCategoryLabel(row.category)}
                        </span>
                        {row.updatesCount > 1 && (
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                ha riscritto {row.updatesCount} volte
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ash-500">
                        {row.leadPhone && (
                            <a href={`tel:${row.leadPhone}`} className="inline-flex items-center gap-1 font-medium text-brand-charcoal hover:underline">
                                <Phone className="h-3.5 w-3.5" />{row.leadPhone}
                            </a>
                        )}
                        <span>{STATUS_LABEL[row.leadStatus] ?? row.leadStatus}</span>
                        {row.leadFunnel && <span>· {row.leadFunnel}</span>}
                        {row.currentOwnerName && <span>· ora a {row.currentOwnerName}</span>}
                    </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${waitTone(row.waitingHours)}`}>
                    <Clock className="h-3.5 w-3.5" />aspetta da {waitLabel(row.waitingHours)}
                </span>
            </div>

            <blockquote className="mt-3 border-l-2 border-brand-orange/60 bg-ash-50/60 px-3 py-2 text-sm italic text-brand-charcoal">
                {row.reason}
            </blockquote>

            {row.leadInfo && <InfoGrid info={row.leadInfo} />}

            {row.locked && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        Ha già un appuntamento{row.appointmentDate ? ` per il ${new Date(row.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}:
                        il lead <strong>non cambia mano</strong> (sposterebbe presenze e fatturato già contati).
                        Il GDO che scegli riceve la richiesta e può chiamarlo dalla scheda.
                    </span>
                </div>
            )}

            {canAssign && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <select
                        value={gdoId}
                        onChange={(e) => setGdoId(e.target.value)}
                        disabled={pending}
                        className="rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm font-medium text-brand-charcoal focus:border-brand-orange focus:outline-none"
                    >
                        <option value="">Scegli il GDO che lo chiama…</option>
                        {gdos.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                    <button
                        type="button"
                        disabled={!gdoId || pending}
                        onClick={() => act(() => assignContactRequest(row.id, gdoId))}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-orange px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <UserPlus className="h-4 w-4" />Assegna e fai chiamare
                    </button>
                    <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => closeContactRequest(row.id))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 px-3 py-2 text-sm font-medium text-ash-600 transition hover:bg-ash-50 disabled:opacity-40"
                    >
                        <X className="h-4 w-4" />Chiudi senza assegnare
                    </button>
                </div>
            )}

            {/* Contenitori <div>, mai <span>: un bottone dentro un tag testuale
                fa esplodere l'idratazione e porta al WSOD su Vercel. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ash-100 pt-3">
                {row.status === 'pending' && (
                    <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => takeChargeContactRequest(row.id))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-sm font-semibold text-brand-orange transition hover:bg-brand-orange/20 disabled:opacity-40"
                    >
                        <Hand className="h-4 w-4" />La prendo io
                    </button>
                )}
                {row.status !== 'closed' && (
                    <>
                        <select
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value as ContactOutcome | '')}
                            disabled={pending}
                            className="rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm font-medium text-brand-charcoal focus:border-brand-orange focus:outline-none"
                        >
                            <option value="">Com&apos;è finita…</option>
                            {(Object.keys(CONTACT_OUTCOME_LABELS) as ContactOutcome[]).map(k => (
                                <option key={k} value={k}>{CONTACT_OUTCOME_LABELS[k]}</option>
                            ))}
                        </select>
                        <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Nota (facoltativa)"
                            disabled={pending}
                            className="min-w-0 flex-1 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-brand-charcoal focus:border-brand-orange focus:outline-none"
                        />
                        <button
                            type="button"
                            disabled={!outcome || pending}
                            onClick={() => {
                                if (!outcome) { setError('Scegli un esito.'); return; }
                                act(() => resolveContactRequest(row.id, outcome, note));
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-charcoal px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Check className="h-4 w-4" />Chiudi con esito
                        </button>
                    </>
                )}
                {row.outcome && (
                    <div className="text-sm text-ash-500">
                        Esito: <strong className="text-brand-charcoal">{CONTACT_OUTCOME_LABELS[row.outcome as ContactOutcome] ?? row.outcome}</strong>
                        {row.note ? ` — ${row.note}` : ''}
                    </div>
                )}
            </div>

            {error && <div className="mt-2 text-sm font-medium text-red-600">{error}</div>}
        </div>
    );
}

export default function ContactRequestsClient({ view }: { view: ContactRequestsView }) {
    const { pending, handled, gdos, canAssign } = view;
    const oldest = pending.length > 0 ? pending[0] : null;

    // Le Conferme non smistano: vedono solo i lead già appuntati, che da quel
    // momento sono roba loro. Chiamare "coda di smistamento" quella vista la
    // farebbe leggere come un lavoro di qualcun altro.
    const isConferme = view.lane === 'conferme';
    const title = isConferme ? 'Lead che ti hanno cercato' : 'Richieste di contatto';
    const subtitle = isConferme
        ? 'Lead con un appuntamento fissato che hanno scritto al bot chiedendo di parlare con una persona. Il bot smette di rispondere: finché non li richiami, restano fermi.'
        : 'I lead che in chat hanno chiesto di parlare con una persona. Il bot smette di rispondere: finché non li assegni a un GDO, restano fermi.';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">{title}</h1>
                <p className="mt-1 max-w-3xl text-sm text-ash-500">{subtitle}</p>
            </div>

            {pending.length === 0 ? (
                <div className="rounded-xl border border-ash-200/60 bg-white p-8 text-center shadow-soft">
                    <Check className="mx-auto h-8 w-8 text-emerald-500" />
                    <div className="mt-2 font-semibold text-brand-charcoal">Nessuna richiesta in attesa</div>
                    <div className="text-sm text-ash-500">Tutti i lead che hanno chiesto una persona sono stati presi in carico.</div>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-orange/30 bg-brand-orange/5 px-4 py-3">
                        <CalendarClock className="h-5 w-5 text-brand-orange" />
                        <span className="text-sm font-semibold text-brand-charcoal">
                            {pending.length} {pending.length === 1 ? 'lead aspetta' : 'lead aspettano'} di essere richiamati
                        </span>
                        {oldest && (
                            <span className="text-sm text-ash-600">· il più vecchio da {waitLabel(oldest.waitingHours)}</span>
                        )}
                    </div>

                    <div className="space-y-3">
                        {pending.map(row => <RequestCard key={row.id} row={row} gdos={gdos} canAssign={canAssign} />)}
                    </div>
                </>
            )}

            {handled.length > 0 && (
                <div>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ash-500">Gestite di recente</h2>
                    <div className="divide-y divide-ash-100 overflow-hidden rounded-xl border border-ash-200/60 bg-white shadow-soft">
                        {handled.map(row => (
                            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                                <div className="min-w-0">
                                    <span className="font-semibold text-brand-charcoal">{row.leadName}</span>
                                    <span className="text-ash-500"> · {contactCategoryLabel(row.category)}</span>
                                </div>
                                <div className="text-xs text-ash-500">
                                    {/* L'esito vince sullo stato: una richiesta chiusa con
                                        "Ha disdetto" non è "chiusa senza assegnazione". */}
                                    {row.outcome
                                        ? `${CONTACT_OUTCOME_LABELS[row.outcome as ContactOutcome] ?? row.outcome}${row.assignedToName ? ` · ${row.assignedToName}` : ''}`
                                        : row.status === 'assigned'
                                            ? `assegnata a ${row.assignedToName ?? '—'}`
                                            : 'chiusa senza assegnazione'}
                                    {' · '}
                                    {new Date(row.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
