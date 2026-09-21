"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setSalesSelfAppointment } from "@/app/actions/salesPipelineActions"
import { updateLeadOutcome } from "@/app/actions/pipelineActions"
import { GDO_DISCARD_REASONS } from "@/lib/surveys/questions"

type Lead = any
type Tab = 'first' | 'second' | 'third' | 'recalls'

export default function MiaPipelineClient({ firstCall, secondCall, thirdCall, recalls }: {
    firstCall: Lead[]; secondCall: Lead[]; thirdCall: Lead[]; recalls: Lead[]
}) {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('first')
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const lists: Record<Tab, Lead[]> = { first: firstCall, second: secondCall, third: thirdCall, recalls }
    const tabs: { key: Tab; label: string }[] = [
        { key: 'first', label: '1ª chiamata' },
        { key: 'second', label: '2ª chiamata' },
        { key: 'third', label: '3ª chiamata' },
        { key: 'recalls', label: 'Richiami' },
    ]

    /** Un solo punto di uscita per tutte le azioni: un lead alla volta, errore visibile, refresh. */
    async function run(leadId: string, fn: () => Promise<{ success: boolean; error?: string }>) {
        if (busyId) return              // niente doppio invio mentre una parte
        setBusyId(leadId); setError(null)
        try {
            const res = await fn()
            // I messaggi del muro del fissaggio dicono gia' cosa fare: si mostrano
            // come arrivano, senza riscriverli.
            if (!res.success) setError(res.error || 'Operazione non riuscita.')
            else router.refresh()
        } finally {
            setBusyId(null)
        }
    }

    const fissa = (lead: Lead, whenLocal: string, note: string) =>
        run(lead.id, () => setSalesSelfAppointment({
            leadId: lead.id,
            currentVersion: lead.version,
            // `datetime-local` non porta il fuso: la Date nasce nell'ora locale
            // del browser, ed e' il server a ragionare in Europe/Rome.
            at: new Date(whenLocal),
            note,
        }))

    const richiamo = (lead: Lead, whenLocal: string, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'RICHIAMO', note, new Date(whenLocal), undefined, undefined, lead.version))

    const nonRisposto = (lead: Lead, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'NON_RISPOSTO', note, undefined, undefined, undefined, lead.version))

    const scarta = (lead: Lead, motivo: string, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'DA_SCARTARE', note, undefined, undefined, motivo, lead.version))

    return (
        <div className="max-w-7xl mx-auto space-y-4">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    La mia pipeline
                </h1>
                <div className="mt-1 text-sm text-ash-500">
                    I lead da chiamare a freddo, un tentativo alla volta.
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={tab === t.key ? 'rounded-lg bg-brand-orange px-3 py-1.5 text-sm font-bold text-white' : 'rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-sm font-medium text-ash-600'}>
                        {t.label} ({lists[t.key].length})
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            )}

            {lists[tab].length === 0 ? (
                <div className="rounded-2xl border border-ash-200 bg-white p-8 text-center text-sm text-ash-500">
                    Niente da chiamare qui.
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {lists[tab].map(lead => (
                        <SalesLeadCard
                            key={lead.id}
                            lead={lead}
                            busy={busyId === lead.id}
                            onFissa={fissa}
                            onRichiamo={richiamo}
                            onNonRisposto={nonRisposto}
                            onScarta={scarta}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function SalesLeadCard({ lead, busy, onFissa, onRichiamo, onNonRisposto, onScarta }: {
    lead: Lead; busy: boolean
    onFissa: (l: Lead, when: string, note: string) => void
    onRichiamo: (l: Lead, when: string, note: string) => void
    onNonRisposto: (l: Lead, note: string) => void
    onScarta: (l: Lead, motivo: string, note: string) => void
}) {
    const [azione, setAzione] = useState<null | 'app' | 'rich' | 'scarto'>(null)
    const [when, setWhen] = useState('')
    const [note, setNote] = useState('')
    const [motivo, setMotivo] = useState<string>(GDO_DISCARD_REASONS[0])

    return (
        <div className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-bold text-ash-900">{lead.name}</div>
            {/* Il telefono si vede subito: qui si chiama a freddo. In /venditore
                e' nascosto fino al check-in di trattativa, ma questa e' un'altra
                superficie e un altro momento. */}
            <a href={`tel:${lead.phone}`} className="text-lg font-bold text-brand-orange">{lead.phone}</a>
            <div className="mt-1 text-xs text-ash-500">
                {lead.funnel || 'Senza funnel'} · tentativi: {lead.callCount}
                {lead.email ? ` · ${lead.email}` : ''}
            </div>
            {lead.lastCallNote && (
                <div className="mt-2 rounded-lg bg-ash-50 px-2 py-1 text-xs text-ash-600">{lead.lastCallNote}</div>
            )}

            {/* Contenitori <div>, mai <span>/<p>: bottoni dentro tag testuali
                mandano l'app in schermata bianca su Vercel. */}
            <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => setAzione('app')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Appuntamento</button>
                <button disabled={busy} onClick={() => setAzione('rich')} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Richiamo</button>
                <button disabled={busy} onClick={() => onNonRisposto(lead, note)} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-medium text-ash-700 disabled:opacity-50">Non risposto</button>
                <button disabled={busy} onClick={() => setAzione('scarto')} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:opacity-50">Da scartare</button>
            </div>

            {azione && (
                <div className="mt-3 space-y-2 border-t border-ash-100 pt-3">
                    {(azione === 'app' || azione === 'rich') && (
                        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm" />
                    )}
                    {azione === 'scarto' && (
                        <select value={motivo} onChange={e => setMotivo(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm">
                            {GDO_DISCARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    )}
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Nota"
                        className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm" />
                    <div className="flex gap-2">
                        <button
                            disabled={busy || ((azione === 'app' || azione === 'rich') && !when)}
                            onClick={() => {
                                if (azione === 'app') onFissa(lead, when, note)
                                else if (azione === 'rich') onRichiamo(lead, when, note)
                                else onScarta(lead, motivo, note)
                                setAzione(null)
                            }}
                            className="rounded-lg bg-ash-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                            {busy ? 'Salvo…' : 'Conferma'}
                        </button>
                        <button disabled={busy} onClick={() => setAzione(null)}
                            className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-medium text-ash-600">Annulla</button>
                    </div>
                </div>
            )}
        </div>
    )
}
