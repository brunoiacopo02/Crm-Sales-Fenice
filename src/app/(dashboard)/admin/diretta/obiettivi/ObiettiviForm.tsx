"use client"

// Obiettivi della Diretta (scalini, ora di punta, turni, pause, presenze):
// tutti modificabili dall'admin (PO 25/10/2026). Il salvataggio li controlla
// per intero (validaObiettivi) e rinnova subito la cache della squadra.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveDirettaObiettivi } from "@/app/actions/direttaActions"
import type { Fascia, GamificationTargets } from "@/lib/diretta/config"
import { DEFAULT_TARGETS } from "@/lib/diretta/config"
import { bottone } from "@/components/diretta/admin/ui"

const sezione = "rounded-[16px] bg-[#262626] p-5 sm:p-6"
const campo = "h-10 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] tabular-nums text-[#F2F2F2] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"
const etichetta = "mb-1.5 block text-[14px] text-[#F2F2F2]"

export function ObiettiviForm({ obiettivi }: { obiettivi: GamificationTargets }) {
    const router = useRouter()
    const [o, setO] = useState<GamificationTargets>(obiettivi)
    const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)
    const [salvando, avvia] = useTransition()

    const salva = () => {
        setMessaggio(null)
        avvia(async () => {
            try {
                const r = await saveDirettaObiettivi(o)
                setMessaggio(r.success ? { ok: true, testo: 'Obiettivi salvati. GDO e Conferme li vedono entro un minuto.' } : { ok: false, testo: r.error || 'Non salvato.' })
                if (r.success) router.refresh()
            } catch {
                setMessaggio({ ok: false, testo: 'Connessione assente. Riprova tra poco.' })
            }
        })
    }

    const scalino = (k: 'personale' | 'squadra' | 'punta', i: 0 | 1, v: string) => {
        setO(prev => {
            const coppia = [...prev[k]] as [number, number]
            coppia[i] = Number(v)
            return { ...prev, [k]: coppia }
        })
    }
    const fascia = (k: 'puntaFeriale' | 'puntaSabato' | 'turnoFeriale' | 'turnoSabato', chiave: keyof Fascia, v: string) => {
        setO(prev => ({ ...prev, [k]: { ...prev[k], [chiave]: v } }))
    }
    const pausa = (k: 'pauseFeriali' | 'pauseSabato', i: number, chiave: keyof Fascia, v: string) => {
        setO(prev => ({ ...prev, [k]: prev[k].map((p, j) => (j === i ? { ...p, [chiave]: v } : p)) }))
    }

    return (
        <div className="flex flex-col gap-4">
            <section aria-label="Scalini" className={sezione}>
                <h2 className="text-[17px] font-semibold">Scalini</h2>
                <div className="mt-1 text-[14px] text-[#BFBFBF]">Due per ogni obiettivo: il primo e quello pieno.</div>
                <div className="mt-5 grid gap-5 sm:grid-cols-3">
                    {([
                        ['personale', 'Fissati al giorno, a testa'],
                        ['squadra', 'Fissati di squadra al giorno'],
                        ['punta', "Fissati di squadra nell'ora di punta"],
                    ] as const).map(([k, testo]) => (
                        <div key={k}>
                            <div className={etichetta}>{testo}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <input aria-label={`${testo}, primo scalino`} type="number" min={1} className={campo} value={o[k][0]} onChange={e => scalino(k, 0, e.target.value)} />
                                <input aria-label={`${testo}, secondo scalino`} type="number" min={1} className={campo} value={o[k][1]} onChange={e => scalino(k, 1, e.target.value)} />
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section aria-label="Orari" className={sezione}>
                <h2 className="text-[17px] font-semibold">Orari</h2>
                <div className="mt-1 text-[14px] text-[#BFBFBF]">Ora di Roma. La domenica non c&apos;è turno.</div>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    {([
                        ['turnoFeriale', 'Turno, da lunedì a venerdì'],
                        ['turnoSabato', 'Turno, sabato'],
                        ['puntaFeriale', 'Ora di punta, da lunedì a venerdì'],
                        ['puntaSabato', 'Ora di punta, sabato'],
                    ] as const).map(([k, testo]) => (
                        <div key={k}>
                            <div className={etichetta}>{testo}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <input aria-label={`${testo}, inizio`} type="time" className={campo} value={o[k].start} onChange={e => fascia(k, 'start', e.target.value)} />
                                <input aria-label={`${testo}, fine`} type="time" className={campo} value={o[k].end} onChange={e => fascia(k, 'end', e.target.value)} />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    {([
                        ['pauseFeriali', 'Pause, da lunedì a venerdì'],
                        ['pauseSabato', 'Pause, sabato'],
                    ] as const).map(([k, testo]) => (
                        <div key={k}>
                            <div className={etichetta}>{testo}</div>
                            <div className="flex flex-col gap-2">
                                {o[k].length === 0 && <div className="text-[14px] text-[#BFBFBF]">Nessuna pausa.</div>}
                                {o[k].map((p, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                        <input aria-label={`${testo} ${i + 1}, inizio`} type="time" className={campo} value={p.start} onChange={e => pausa(k, i, 'start', e.target.value)} />
                                        <input aria-label={`${testo} ${i + 1}, fine`} type="time" className={campo} value={p.end} onChange={e => pausa(k, i, 'end', e.target.value)} />
                                        <button
                                            type="button"
                                            onClick={() => setO(prev => ({ ...prev, [k]: prev[k].filter((_, j) => j !== i) }))}
                                            className={bottone('linea')}
                                        >
                                            Togli
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setO(prev => ({ ...prev, [k]: [...prev[k], { start: '15:30', end: '15:45' }] }))}
                                    className={`${bottone('linea', 'piccola')} self-start`}
                                >
                                    Aggiungi una pausa
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section aria-label="Presenze" className={sezione}>
                <h2 className="text-[17px] font-semibold">Presenze</h2>
                <div className="mt-5 grid gap-5 sm:grid-cols-3">
                    <label className="block">
                        <span className={etichetta}>Obiettivo a settimana</span>
                        <input type="number" min={1} className={campo} value={o.presenzeObiettivo} onChange={e => setO(p => ({ ...p, presenzeObiettivo: Number(e.target.value) }))} />
                    </label>
                    <label className="block">
                        <span className={etichetta}>Presenze base, senza euro</span>
                        <input type="number" min={0} className={campo} value={o.presenzeSogliaEuro} onChange={e => setO(p => ({ ...p, presenzeSogliaEuro: Number(e.target.value) }))} />
                    </label>
                    <label className="block">
                        <span className={etichetta}>Euro per presenza oltre la base</span>
                        <input type="number" min={0} className={campo} value={o.euroPerPresenza} onChange={e => setO(p => ({ ...p, euroPerPresenza: Number(e.target.value) }))} />
                    </label>
                </div>
                <div className="mt-3 text-[14px] text-[#BFBFBF]">
                    Con base {o.presenzeSogliaEuro}, ogni presenza dalla {o.presenzeSogliaEuro + 1}ª vale {o.euroPerPresenza} €.
                </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={salva} disabled={salvando} className={bottone('primario')}>
                    {salvando ? 'Salvataggio' : 'Salva gli obiettivi'}
                </button>
                <button type="button" onClick={() => setO(DEFAULT_TARGETS)} disabled={salvando} className={bottone('linea')}>
                    Torna ai valori decisi il 25/10
                </button>
                {messaggio && (
                    <div role="status" className={`text-[14px] ${messaggio.ok ? 'text-[#BFBFBF]' : 'font-semibold text-[#FF9330]'}`}>
                        {messaggio.testo}
                    </div>
                )}
            </div>
        </div>
    )
}
