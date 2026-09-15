"use client"

import { useState, useTransition } from "react"
import { Phone, PhoneMissed, Clock, Rocket } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { recordLancioCallNowNoAnswer, type LancioCallNowLead } from "@/app/actions/lancioActions"
import type { CallNowColumn } from "@/lib/lancio/callNow"

const COLONNE: Array<{ key: CallNowColumn; title: string }> = [
    { key: 'da_chiamare', title: 'Da chiamare' },
    { key: 'seconda', title: 'Seconda chiamata' },
    { key: 'terza', title: 'Terza chiamata' },
    { key: 'esitati', title: 'Esitati' },
]

/**
 * Scheda della serata di lancio: i lead che hanno chiesto di essere chiamati
 * subito, in quattro colonne per numero di tentativi a vuoto. Il telefono è
 * visibile senza check-in — è il lead ad aver chiesto la chiamata.
 */
export function LancioCallNowTab({ leads, onOpen, onChanged }: {
    leads: LancioCallNowLead[]
    /** Apre il drawer esiti (il chiamante fa il check-in se manca). */
    onOpen: (lead: LancioCallNowLead) => void
    onChanged: () => void
}) {
    const [busyId, setBusyId] = useState<string | null>(null)
    const [, start] = useTransition()

    const nonRisponde = (lead: LancioCallNowLead) => {
        setBusyId(lead.id)
        start(async () => {
            try {
                const res = await recordLancioCallNowNoAnswer(lead.id)
                if (!res.ok) alert(res.error)
                else if (res.handoff) alert('Terzo tentativo a vuoto: il lead passa alle Conferme.')
                onChanged()
            } catch {
                alert('Errore di rete: il tentativo non è stato registrato. Riprova.')
            } finally {
                setBusyId(null)
            }
        })
    }

    return (
        <div className="p-2 sm:p-6 bg-gradient-to-b from-amber-50/50 to-white">
            <div className="mb-4 flex items-start gap-2 text-sm text-ash-600">
                <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                    Lead della live che hanno chiesto di essere chiamati adesso. Chiama, poi &ldquo;Registra esito&rdquo; oppure
                    &ldquo;Non risponde&rdquo; (richiamo fra 30 minuti, al terzo passa alle Conferme).
                </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {COLONNE.map(col => {
                    const items = leads.filter(l => l.column === col.key)
                    return (
                        <div key={col.key} className="rounded-xl border border-ash-200/60 bg-white p-3 shadow-soft">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <h3 className="text-sm font-bold uppercase tracking-wide text-ash-700">{col.title}</h3>
                                <span className="rounded-full bg-ash-100 px-2 py-0.5 text-xs font-bold text-ash-600">{items.length}</span>
                            </div>
                            <div className="space-y-2">
                                {items.length === 0 && <div className="py-4 text-center text-xs text-ash-400">Nessun lead</div>}
                                {items.map(lead => {
                                    const nextAt = lead.lancioCallNowNextAt ? new Date(lead.lancioCallNowNextAt) : null
                                    const richiamaTra = nextAt ? Math.max(0, Math.round((nextAt.getTime() - Date.now()) / 60_000)) : null
                                    return (
                                        <div key={lead.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-ash-900">{lead.name}</div>
                                                    <div className="flex items-center gap-1 text-sm text-ash-700">
                                                        <Phone className="h-3.5 w-3.5 shrink-0 text-ash-400" />
                                                        <span className="truncate">{lead.phone}</span>
                                                    </div>
                                                </div>
                                                {lead.lancioSceltaAt && (
                                                    <div className="shrink-0 text-[11px] text-ash-500" title="Ora della richiesta">
                                                        {format(new Date(lead.lancioSceltaAt), 'HH:mm', { locale: it })}
                                                    </div>
                                                )}
                                            </div>
                                            {lead.lancioBotInfo?.risposte && lead.lancioBotInfo.risposte.length > 0 && (
                                                <ul className="mt-2 space-y-0.5 rounded-md bg-white/70 p-2 text-xs text-ash-700">
                                                    {lead.lancioBotInfo.risposte.map((r, i) => <li key={i}>&#128172; {r}</li>)}
                                                </ul>
                                            )}
                                            {lead.appointmentNote && <div className="mt-1 text-xs italic text-ash-500">{lead.appointmentNote}</div>}
                                            {richiamaTra !== null && col.key !== 'esitati' && (
                                                <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                                    <Clock className="h-3 w-3 shrink-0" />
                                                    {richiamaTra > 0 ? `richiama fra ${richiamaTra} min` : 'da richiamare ora'}
                                                </div>
                                            )}
                                            {col.key === 'esitati' ? (
                                                <div className="mt-2 text-xs font-bold text-emerald-700">{lead.salespersonOutcome}</div>
                                            ) : (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        onClick={() => onOpen(lead)}
                                                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
                                                    >
                                                        <Phone className="h-3.5 w-3.5" /> Registra esito
                                                    </button>
                                                    <button
                                                        onClick={() => nonRisponde(lead)}
                                                        disabled={busyId === lead.id}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-xs font-semibold text-ash-700 transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                                                    >
                                                        <PhoneMissed className="h-3.5 w-3.5" /> Non risponde
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
