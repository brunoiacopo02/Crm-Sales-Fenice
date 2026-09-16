"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Rocket, Save, AlertTriangle, CheckCircle2, Lock } from "lucide-react"
import { saveLaunchShifts, type LancioAdminView } from "@/app/actions/lancioActions"

type Kind = 'SERA' | 'GIORNO_DOPO'

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
    return (
        <div className="rounded-xl border border-amber-200 bg-white p-3 shadow-soft" title={hint}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-ash-500">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-ash-900">{value}</div>
        </div>
    )
}

function ShiftPicker({ kind, title, subtitle, venditori, selected, canEdit, onSaved }: {
    kind: Kind; title: string; subtitle: string
    venditori: LancioAdminView['venditori']; selected: string[]; canEdit: boolean; onSaved: () => void
}) {
    const [chosen, setChosen] = useState<Set<string>>(new Set(selected))
    // Baseline locale: il confronto per il tasto "Salva" non aspetta il refresh
    // del server component, che arriva dopo.
    const [baseline, setBaseline] = useState<string[]>(selected)
    const [pending, start] = useTransition()
    const [msg, setMsg] = useState<string | null>(null)
    const [msgIsError, setMsgIsError] = useState(false)
    const dirty = chosen.size !== baseline.length || baseline.some(id => !chosen.has(id))

    const toggle = (id: string) => {
        // La spunta cambia: il "Turno salvato." di prima non descrive più quello
        // che si sta guardando, e lasciarlo lì fa credere di aver già salvato.
        setMsg(null)
        setMsgIsError(false)
        setChosen(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    const save = () => start(async () => {
        setMsg(null)
        setMsgIsError(false)
        const ids = [...chosen]
        try {
            const res = await saveLaunchShifts(kind, ids)
            setMsg(res.ok ? 'Turno salvato.' : res.error)
            setMsgIsError(!res.ok)
            if (res.ok) {
                setBaseline(ids)
                onSaved()
            }
        } catch {
            // Guardia che lancia (ruolo/azienda) o rete caduta: senza catch la
            // Server Action rompeva la pagina e il turno restava mezzo salvato
            // agli occhi di chi guardava.
            setMsg('Non è stato possibile salvare')
            setMsgIsError(true)
        }
    })

    return (
        <div className="rounded-xl border border-ash-200/80 bg-white p-4 shadow-soft">
            <div className="mb-3">
                <h3 className="font-bold text-ash-900">{title}</h3>
                <p className="text-xs text-ash-500">{subtitle}</p>
            </div>
            {venditori.length === 0 ? (
                <div className="py-4 text-center text-sm text-ash-400">Nessun venditore attivo.</div>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                    {venditori.map(v => (
                        <label key={v.id} className={`flex items-center gap-2 rounded-lg border border-ash-200/60 px-3 py-2 text-sm ${canEdit ? 'cursor-pointer hover:border-brand-orange/40' : 'cursor-default opacity-80'}`}>
                            <input
                                type="checkbox"
                                checked={chosen.has(v.id)}
                                disabled={!canEdit || pending}
                                onChange={() => toggle(v.id)}
                                className="h-4 w-4 accent-brand-orange"
                            />
                            <span className="font-medium text-ash-800">{v.name}</span>
                            {v.calendarExempt && <span className="ml-auto rounded bg-ash-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ash-500">esente calendario</span>}
                        </label>
                    ))}
                </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
                {canEdit ? (
                    <button
                        onClick={save}
                        disabled={pending || !dirty}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
                    >
                        <Save className="h-4 w-4" /> {pending ? 'Salvataggio…' : 'Salva turno'}
                    </button>
                ) : (
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-ash-500">
                        <Lock className="h-3.5 w-3.5" /> Sola lettura
                    </div>
                )}
                {msg && <div className={`text-xs font-semibold ${msgIsError ? 'text-red-600' : 'text-ash-600'}`}>{msg}</div>}
            </div>
        </div>
    )
}

export function LancioClient({ initial }: { initial: LancioAdminView }) {
    const router = useRouter()
    const { config, venditori, shifts, copertura, monitor, canEdit } = initial
    const refresh = () => router.refresh()
    const nonCompilati = copertura.filter(c => !c.compilato)
    const primaOra = config.oreVenditori[0] ?? 9
    const ultimaOra = (config.oreVenditori[config.oreVenditori.length - 1] ?? 14) + 1

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white"><Rocket className="h-5 w-5" /></div>
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Lancio Web Dev AI</h1>
                    <div className="text-sm text-ash-500">
                        Webinar {new Date(config.webinarAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' })} · funnel {config.funnel} · bucket {config.bucket}
                    </div>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <ShiftPicker
                    kind="SERA"
                    title="Turno SERA (chiamate subito)"
                    subtitle="La sera del webinar: chi preme il pulsante e vuole essere chiamato adesso va a questi venditori, a rotazione."
                    venditori={venditori} selected={shifts.SERA} canEdit={canEdit} onSaved={refresh}
                />
                <ShiftPicker
                    kind="GIORNO_DOPO"
                    title={`Turno GIORNO DOPO (${config.giornoDopo}, ore ${primaOra}-${ultimaOra})`}
                    subtitle="Appuntamenti già confermati sulle ore dichiarate nel calendario. Senza ore dichiarate il venditore non riceve nulla."
                    venditori={venditori} selected={shifts.GIORNO_DOPO} canEdit={canEdit} onSaved={refresh}
                />
            </div>

            <div className="rounded-xl border border-ash-200/80 bg-white p-4 shadow-soft">
                <h3 className="font-bold text-ash-900">Copertura {primaOra}-{ultimaOra} del {config.giornoDopo}</h3>
                <p className="mb-3 text-xs text-ash-500">Dal calendario disponibilità dei venditori del turno GIORNO DOPO. Verde = ora libera, grigio = dichiarata ma occupata/bloccata, tratteggio = non dichiarata.</p>
                {nonCompilati.length > 0 && (
                    <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>Calendario della settimana non compilato: {nonCompilati.map(c => c.name).join(', ')}. Senza ore dichiarate la mattina risulta piena e tutto va alle Conferme.</span>
                    </div>
                )}
                {copertura.length === 0 ? (
                    <div className="py-6 text-center text-sm text-ash-400">Nessun venditore nel turno GIORNO DOPO.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ash-500">
                                    <th className="py-1 pr-3">Venditore</th>
                                    {config.oreVenditori.map(h => <th key={h} className="px-1 py-1 text-center">{String(h).padStart(2, '0')}:00</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {copertura.map(c => (
                                    <tr key={c.salesUserId} className="border-t border-ash-100">
                                        <td className="py-1.5 pr-3 font-medium text-ash-800">
                                            <div className="flex items-center gap-2 whitespace-nowrap">
                                                {c.name}
                                                {!c.compilato && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">non compilato</span>}
                                            </div>
                                        </td>
                                        {config.oreVenditori.map(h => {
                                            const libera = c.oreLibere.includes(h)
                                            const dichiarata = c.oreDichiarate.includes(h)
                                            return (
                                                <td key={h} className="px-1 py-1.5 text-center">
                                                    <div
                                                        className={`mx-auto h-6 w-10 rounded-md ${libera ? 'bg-emerald-400' : dichiarata ? 'bg-ash-300' : 'border border-dashed border-ash-200'}`}
                                                        title={libera ? 'Libera' : dichiarata ? 'Occupata o bloccata' : 'Non dichiarata'}
                                                    />
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-4 shadow-soft">
                <h3 className="mb-3 font-bold text-ash-900">Monitor lancio</h3>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Tile label="In lista (bucket)" value={monitor.inLista} />
                    <Tile label="Spinti al bot" value={monitor.spintiAlBot} hint="BOT_PUSHED consegnati" />
                    <Tile label="Pulsante premuto" value={monitor.pulsantePremuto} hint="Entrati dal pulsante o con una scelta fatta" />
                    <Tile label="Chiamate subito" value={`${monitor.chiamateSubito.assegnate} / ${monitor.chiamateSubito.esitate} / ${monitor.chiamateSubito.chiuse}`} hint="assegnate / esitate / chiuse" />
                    <Tile label="€ chiamate subito" value={`${Math.round(monitor.chiamateSubito.euro)} €`} />
                    <Tile label="Passate alle Conferme (3 NR)" value={monitor.chiamateSubito.passateAlleConferme} />
                    <Tile label="Prenotati mattina" value={monitor.prenotati.mattina} />
                    <Tile label="Prenotati pomeriggio" value={monitor.prenotati.pomeriggio} />
                    <Tile label="Prenotati dopodomani" value={monitor.prenotati.dopodomani} />
                    <Tile label="Follow-up → flusso standard" value={monitor.followupRisposti} hint="lancioScelta = followup (dal B5)" />
                    <Tile label="Restituiti al pool" value={monitor.restituitiAlPool} hint="Eventi LANCIO_RETURNED_TO_POOL (dal B5)" />
                    <Tile label="Distribuiti ai GDO" value={monitor.distribuitiAiGdo} />
                    {monitor.soloBot.map(l => <Tile key={l} label={l} value="—" hint="Dato che vive nel database del bot: si legge dai suoi pannelli" />)}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-ash-500">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> I contatori si aggiornano a ogni apertura della pagina.
                </div>
            </div>
        </div>
    )
}
