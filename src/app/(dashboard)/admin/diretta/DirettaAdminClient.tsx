"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveDirettaObiettivi, setDirettaFlag } from "@/app/actions/direttaActions"
import type { Fascia, GamificationTargets } from "@/lib/diretta/config"
import { DEFAULT_TARGETS } from "@/lib/diretta/config"

type Flags = { GDO: boolean; CONFERME: boolean }

const card = "rounded-2xl border border-ash-200 bg-white p-5"
const input = "h-10 w-full rounded-lg border border-ash-300 bg-white px-3 text-sm tabular-nums text-brand-charcoal focus:border-brand-orange focus:outline-none"

export function DirettaAdminClient({ flags, obiettivi }: { flags: Flags; obiettivi: GamificationTargets }) {
    const router = useRouter()
    const [stato, setStato] = useState<Flags>(flags)
    const [o, setO] = useState<GamificationTargets>(obiettivi)
    const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)
    const [salvando, avvia] = useTransition()

    const cambiaFlag = (ruolo: keyof Flags) => {
        const acceso = !stato[ruolo]
        const chi = ruolo === 'GDO' ? 'i GDO' : 'le Conferme'
        if (!window.confirm(`${acceso ? 'Accendere' : 'Spegnere'} la Diretta per ${chi}? Vale dalla prossima pagina che aprono.`)) return
        avvia(async () => {
            const r = await setDirettaFlag(ruolo, acceso)
            if (r.success) {
                setStato(s => ({ ...s, [ruolo]: acceso }))
                setMessaggio({ ok: true, testo: `Diretta ${acceso ? 'accesa' : 'spenta'} per ${chi}.` })
                router.refresh()
            } else {
                setMessaggio({ ok: false, testo: r.error || 'Non salvato.' })
            }
        })
    }

    const salva = () => {
        avvia(async () => {
            const r = await saveDirettaObiettivi(o)
            setMessaggio(r.success ? { ok: true, testo: 'Obiettivi salvati.' } : { ok: false, testo: r.error || 'Non salvato.' })
            if (r.success) router.refresh()
        })
    }

    const scalino = (k: 'personale' | 'squadra' | 'punta', i: 0 | 1, v: string) => {
        setO(prev => {
            const coppia = [...prev[k]] as [number, number]
            coppia[i] = Number(v)
            return { ...prev, [k]: coppia }
        })
    }
    const fascia = (k: 'puntaFeriale' | 'puntaSabato' | 'turnoFeriale' | 'turnoSabato', campo: keyof Fascia, v: string) => {
        setO(prev => ({ ...prev, [k]: { ...prev[k], [campo]: v } }))
    }
    const pausa = (k: 'pauseFeriali' | 'pauseSabato', i: number, campo: keyof Fascia, v: string) => {
        setO(prev => ({ ...prev, [k]: prev[k].map((p, j) => (j === i ? { ...p, [campo]: v } : p)) }))
    }

    return (
        <div className="space-y-6">
            <section className={card}>
                <h2 className="text-base font-semibold text-brand-charcoal">Interruttori</h2>
                <p className="mt-1 text-sm text-ash-500">Spenta, ognuno vede il CRM di prima. Si accende e si spegne senza deploy.</p>
                <div className="mt-4 flex flex-col gap-2">
                    {(['GDO', 'CONFERME'] as const).map(ruolo => (
                        <div key={ruolo} className="flex items-center justify-between gap-4 rounded-xl bg-ash-50 px-4 py-3">
                            <div className="text-sm text-brand-charcoal">
                                Diretta per {ruolo === 'GDO' ? 'i GDO' : 'le Conferme'}
                                <span className={`ml-2 font-semibold ${stato[ruolo] ? 'text-brand-charcoal' : 'text-ash-500'}`}>{stato[ruolo] ? 'accesa' : 'spenta'}</span>
                            </div>
                            <button
                                type="button"
                                disabled={salvando}
                                onClick={() => cambiaFlag(ruolo)}
                                className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${stato[ruolo] ? 'border border-ash-300 bg-white text-brand-charcoal hover:border-ash-500' : 'bg-[#FF9330] text-[#171717] hover:bg-[#FFA552]'}`}
                            >
                                {stato[ruolo] ? 'Spegni' : 'Accendi'}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section className={card}>
                <h2 className="text-base font-semibold text-brand-charcoal">Obiettivi</h2>
                <p className="mt-1 text-sm text-ash-500">Due scalini per ogni obiettivo: il primo e quello pieno.</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    {([
                        ['personale', 'Personale, fissati al giorno'],
                        ['squadra', 'Squadra, fissati al giorno'],
                        ['punta', "Squadra, nell'ora di punta"],
                    ] as const).map(([k, etichetta]) => (
                        <div key={k}>
                            <div className="mb-1.5 text-sm text-brand-charcoal">{etichetta}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <input aria-label={`${etichetta}, primo scalino`} type="number" min={1} className={input} value={o[k][0]} onChange={e => scalino(k, 0, e.target.value)} />
                                <input aria-label={`${etichetta}, secondo scalino`} type="number" min={1} className={input} value={o[k][1]} onChange={e => scalino(k, 1, e.target.value)} />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {([
                        ['turnoFeriale', 'Turno, da lunedì a venerdì'],
                        ['turnoSabato', 'Turno, sabato'],
                        ['puntaFeriale', 'Ora di punta, da lunedì a venerdì'],
                        ['puntaSabato', 'Ora di punta, sabato'],
                    ] as const).map(([k, etichetta]) => (
                        <div key={k}>
                            <div className="mb-1.5 text-sm text-brand-charcoal">{etichetta}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <input aria-label={`${etichetta}, inizio`} type="time" className={input} value={o[k].start} onChange={e => fascia(k, 'start', e.target.value)} />
                                <input aria-label={`${etichetta}, fine`} type="time" className={input} value={o[k].end} onChange={e => fascia(k, 'end', e.target.value)} />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {([
                        ['pauseFeriali', 'Pause, da lunedì a venerdì'],
                        ['pauseSabato', 'Pause, sabato'],
                    ] as const).map(([k, etichetta]) => (
                        <div key={k}>
                            <div className="mb-1.5 text-sm text-brand-charcoal">{etichetta}</div>
                            <div className="flex flex-col gap-2">
                                {o[k].length === 0 && <div className="text-sm text-ash-500">Nessuna pausa.</div>}
                                {o[k].map((p, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                        <input aria-label={`${etichetta} ${i + 1}, inizio`} type="time" className={input} value={p.start} onChange={e => pausa(k, i, 'start', e.target.value)} />
                                        <input aria-label={`${etichetta} ${i + 1}, fine`} type="time" className={input} value={p.end} onChange={e => pausa(k, i, 'end', e.target.value)} />
                                        <button
                                            type="button"
                                            onClick={() => setO(prev => ({ ...prev, [k]: prev[k].filter((_, j) => j !== i) }))}
                                            className="h-10 rounded-lg border border-ash-300 px-3 text-sm text-ash-600 hover:border-ash-500"
                                        >
                                            Togli
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setO(prev => ({ ...prev, [k]: [...prev[k], { start: '15:30', end: '15:45' }] }))}
                                    className="h-9 self-start rounded-lg border border-ash-300 px-3 text-sm text-brand-charcoal hover:border-ash-500"
                                >
                                    Aggiungi una pausa
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-brand-charcoal">Presenze a settimana, obiettivo</span>
                        <input type="number" min={1} className={input} value={o.presenzeObiettivo} onChange={e => setO(p => ({ ...p, presenzeObiettivo: Number(e.target.value) }))} />
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-brand-charcoal">Presenze base, senza euro</span>
                        <input type="number" min={0} className={input} value={o.presenzeSogliaEuro} onChange={e => setO(p => ({ ...p, presenzeSogliaEuro: Number(e.target.value) }))} />
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-sm text-brand-charcoal">Euro per presenza oltre la base</span>
                        <input type="number" min={0} className={input} value={o.euroPerPresenza} onChange={e => setO(p => ({ ...p, euroPerPresenza: Number(e.target.value) }))} />
                    </label>
                </div>
                <p className="mt-2 text-sm text-ash-500">
                    Con base {o.presenzeSogliaEuro}, ogni presenza dalla {o.presenzeSogliaEuro + 1}ª vale {o.euroPerPresenza} €.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={salva}
                        disabled={salvando}
                        className="h-10 rounded-lg bg-[#FF9330] px-5 text-sm font-semibold text-[#171717] transition-colors hover:bg-[#FFA552] disabled:opacity-50"
                    >
                        {salvando ? 'Salvataggio' : 'Salva gli obiettivi'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setO(DEFAULT_TARGETS)}
                        className="h-10 rounded-lg border border-ash-300 px-4 text-sm text-brand-charcoal hover:border-ash-500"
                    >
                        Torna ai valori decisi il 25/10
                    </button>
                </div>
            </section>

            {messaggio && (
                <div role="status" className={`rounded-xl px-4 py-3 text-sm ${messaggio.ok ? 'bg-ash-50 text-brand-charcoal' : 'bg-[#FFF1E3] text-brand-charcoal'}`}>
                    {messaggio.testo}
                </div>
            )}
        </div>
    )
}
