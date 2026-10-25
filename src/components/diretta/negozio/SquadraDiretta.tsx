"use client"

// Pagina Squadra della Diretta (/classifica con l'interruttore acceso).
// Niente XP, streak o chiamate grezze: la squadra di oggi, l'ora di punta e la
// settimana per presenze, nella forma decisa da appSettings 'leaderboard_mode'.
// I dati arrivano già filtrati dal server (buildSquadraView); qui si
// aggiornano al massimo ogni 30 s e mai con la scheda nascosta.

import { useEffect, useRef, useState } from "react"
import { getSquadraView } from "@/app/actions/squadraActions"
import { blocchiSquadra, fasePunta, fraseScalini, type PuntaSnapshot, type SquadraView } from "@/lib/diretta/squadra"
import { AvatarDiretta, TitoloDiretta } from "./ui"

const AGGIORNA_MS = 30_000
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })

function Blocchi({ valore, scalini, tono }: { valore: number; scalini: [number, number]; tono: 'su-arancione' | 'su-scuro' }) {
    const { blocchi, primoScalinoIndex } = blocchiSquadra(valore, scalini)
    const colore = tono === 'su-arancione' ? 'var(--d-orange-ink)' : 'var(--d-text)'
    const colonne = { gridTemplateColumns: `repeat(${blocchi.length}, minmax(0, 1fr))` }
    return (
        <div className="mt-5" aria-hidden="true">
            <div className="grid gap-1" style={colonne}>
                {blocchi.map((f, i) => (
                    <div key={i} className="relative h-5 overflow-hidden rounded-[4px]" style={{ border: `2px solid ${colore}` }}>
                        {f > 0 && <div className="absolute inset-y-0 left-0" style={{ width: `${f * 100}%`, background: colore }} />}
                    </div>
                ))}
            </div>
            <div className="mt-2 grid gap-1 text-sm font-medium tabular-nums" style={colonne}>
                {primoScalinoIndex < blocchi.length - 1 && (
                    <div className="text-right" style={{ gridColumn: `${primoScalinoIndex + 1} / span 1` }}>{scalini[0]}</div>
                )}
                <div className="text-right" style={{ gridColumn: `${blocchi.length} / span 1` }}>{scalini[1]}</div>
            </div>
        </div>
    )
}

function testoPunta(punta: PuntaSnapshot, now: Date | null): string {
    const [primo, secondo] = punta.scalini
    if (!now) return `Obiettivo di squadra ${primo}, poi ${secondo}.`
    const start = new Date(punta.start)
    const end = new Date(punta.end)
    const fase = fasePunta(now, start, end)
    if (fase === 'prima') return `Inizia alle ${ORA.format(start)}. Obiettivo di squadra ${primo}, poi ${secondo}.`
    if (fase === 'durante') {
        const m = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 60_000))
        return `Ancora ${m} ${m === 1 ? 'minuto' : 'minuti'}. ${fraseScalini(punta.count, punta.scalini)}`
    }
    if (punta.count >= secondo) return `Chiusa con ${punta.count}. Secondo scalino raggiunto.`
    if (punta.count >= primo) return `Chiusa con ${punta.count}. Primo scalino raggiunto.`
    return `Chiusa con ${punta.count}.`
}

export function SquadraDiretta({ iniziale }: { iniziale: SquadraView }) {
    const [view, setView] = useState(iniziale)
    const [now, setNow] = useState<Date | null>(null)
    const ultimo = useRef(0)
    const inVolo = useRef(false)

    // Un router.refresh (realtime) porta dati nuovi dal server: valgono come aggiornamento.
    useEffect(() => {
        setView(iniziale)
        ultimo.current = Date.now()
    }, [iniziale])

    // Orologio solo nel browser: fase e minuti dell'ora di punta.
    useEffect(() => {
        setNow(new Date())
        const t = setInterval(() => setNow(new Date()), 15_000)
        return () => clearInterval(t)
    }, [])

    // Dati: al massimo ogni 30 s, in pausa con la scheda nascosta.
    useEffect(() => {
        let vivo = true
        const aggiorna = async () => {
            if (inVolo.current || document.visibilityState !== 'visible') return
            if (Date.now() - ultimo.current < AGGIORNA_MS - 1_000) return
            inVolo.current = true
            try {
                const v = await getSquadraView()
                if (vivo) {
                    setView(v)
                    ultimo.current = Date.now()
                }
            } catch {
                // si riprova al giro dopo
            } finally {
                inVolo.current = false
            }
        }
        const t = setInterval(aggiorna, AGGIORNA_MS)
        const onVisibile = () => { if (document.visibilityState === 'visible') aggiorna() }
        document.addEventListener('visibilitychange', onVisibile)
        return () => {
            vivo = false
            clearInterval(t)
            document.removeEventListener('visibilitychange', onVisibile)
        }
    }, [])

    const punta = view.punta
    const n = view.mancaPerSalire

    return (
        <div className="flex flex-col gap-8">
            <TitoloDiretta prima="La" accento="squadra" />

            <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
                <div className="flex flex-col gap-6">
                    <section aria-label="La squadra oggi" className="rounded-[16px] bg-[var(--d-orange)] p-6 text-[var(--d-orange-ink)] sm:p-8">
                        <div className="text-base font-medium">La squadra oggi</div>
                        <div className="mt-2 text-[96px] font-semibold leading-[0.9] tracking-[-0.03em] tabular-nums">{view.squadraOggi}</div>
                        <div className="mt-3 text-lg leading-snug">
                            {view.squadraOggi === 1 ? 'appuntamento fissato.' : 'appuntamenti fissati.'}{' '}
                            <span className="font-semibold">{fraseScalini(view.squadraOggi, view.scaliniSquadra)}</span>
                        </div>
                        <Blocchi valore={view.squadraOggi} scalini={view.scaliniSquadra} tono="su-arancione" />
                    </section>

                    {/* In 'nessuna' restano solo la barra di squadra e i Fenici della settimana. */}
                    {punta && view.mode !== 'nessuna' && (
                        <section aria-label="Ora di punta" className="rounded-[16px] bg-[var(--d-surface)] p-6">
                            <div className="text-[15px] font-semibold">
                                Ora di punta, dalle {ORA.format(new Date(punta.start))} alle {ORA.format(new Date(punta.end))}
                            </div>
                            <div className="mt-3 flex items-baseline gap-2">
                                <span className="text-[44px] font-semibold leading-none tabular-nums">{punta.count}</span>
                                <span className="text-[15px] text-[var(--d-muted)]">fissati dalla squadra</span>
                            </div>
                            <Blocchi valore={punta.count} scalini={punta.scalini} tono="su-scuro" />
                            <div className="mt-3 text-sm leading-relaxed text-[var(--d-muted)]">{testoPunta(punta, now)}</div>
                        </section>
                    )}
                </div>

                <div className="flex flex-col gap-10">
                    {view.mode === 'top3' && (
                        <section aria-label="I primi tre della settimana">
                            <h2 className="text-lg font-semibold">I primi tre della settimana</h2>
                            <div className="mt-1 text-sm text-[var(--d-muted)]">Per presenze, da lunedì a oggi.</div>
                            {view.primiTre.length === 0 ? (
                                <div className="mt-4 text-[15px] text-[var(--d-muted)]">Ancora nessuna presenza questa settimana.</div>
                            ) : (
                                <ol className="mt-3 divide-y-2 divide-[var(--d-surface)]">
                                    {view.primiTre.map(r => (
                                        <li key={r.id} className="flex items-center gap-4 py-4">
                                            <div className="w-7 shrink-0 text-lg font-semibold tabular-nums text-[var(--d-muted)]">{String(r.posizione).padStart(2, '0')}</div>
                                            <AvatarDiretta nome={r.nome} immagine={r.immagine} cornice={r.cornice} size={48} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-lg font-medium">
                                                    {r.nome}{r.tu && <span className="ml-2 text-sm font-normal text-[var(--d-muted)]">tu</span>}
                                                </div>
                                                {r.titolo && <div className="truncate text-sm text-[var(--d-muted)]">{r.titolo}</div>}
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <span className="text-xl font-semibold tabular-nums">{r.presenze}</span>{' '}
                                                <span className="text-sm text-[var(--d-muted)]">{r.presenze === 1 ? 'presenza' : 'presenze'}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            )}
                            {n !== null && (
                                <div className="mt-4 text-[15px] leading-relaxed">
                                    Ti {n === 1 ? 'manca' : 'mancano'}{' '}
                                    <span className="font-semibold text-[var(--d-orange)]">{n} {n === 1 ? 'presenza' : 'presenze'}</span>{' '}
                                    per salire di una posizione.
                                </div>
                            )}
                        </section>
                    )}

                    {view.mode === 'completa' && (
                        <section aria-label="La settimana">
                            <h2 className="text-lg font-semibold">La settimana</h2>
                            <div className="mt-1 text-sm text-[var(--d-muted)]">Per presenze; a pari presenze conta chi ha fissato di più.</div>
                            <div className="mt-3 overflow-x-auto">
                                <table className="w-full min-w-[420px] text-[15px]">
                                    <thead>
                                        <tr className="text-left text-sm text-[var(--d-muted)]">
                                            <th className="w-10 py-2 pr-2 font-medium">#</th>
                                            <th className="py-2 pr-2 font-medium">Persona</th>
                                            <th className="py-2 pr-2 text-right font-medium">Presenze</th>
                                            <th className="py-2 text-right font-medium">Fissati</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {view.classifica.map(r => (
                                            <tr key={r.id} className={`border-t-2 border-[var(--d-surface)] ${r.tu ? 'bg-[var(--d-surface)]' : ''}`}>
                                                <td className="py-3 pl-1 pr-2 tabular-nums text-[var(--d-muted)]">{String(r.posizione).padStart(2, '0')}</td>
                                                <td className="py-3 pr-2">
                                                    <div className="flex items-center gap-3">
                                                        <AvatarDiretta nome={r.nome} immagine={r.immagine} cornice={r.cornice} size={32} />
                                                        <div className="min-w-0">
                                                            <div className="truncate font-medium">{r.nome}{r.tu && <span className="ml-2 text-sm font-normal text-[var(--d-muted)]">tu</span>}</div>
                                                            {r.titolo && <div className="truncate text-xs text-[var(--d-muted)]">{r.titolo}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-2 text-right font-semibold tabular-nums">{r.presenze}</td>
                                                <td className="py-3 pr-1 text-right tabular-nums">{r.fissati}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    <section aria-label="Fenici della settimana">
                        <h2 className="text-lg font-semibold">Fenici della settimana</h2>
                        <div className="mt-1 text-sm text-[var(--d-muted)]">Chi ha superato la {view.sogliaFenici}ª presenza, in ordine alfabetico.</div>
                        {view.fenici.length === 0 ? (
                            <div className="mt-4 text-[15px] text-[var(--d-muted)]">Ancora nessuno: si entra dalla {view.sogliaFenici + 1}ª presenza.</div>
                        ) : (
                            <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                                {view.fenici.map(f => (
                                    <li key={f.id} className="flex items-center gap-3 border-t-2 border-[var(--d-surface)] py-3">
                                        <AvatarDiretta nome={f.nome} immagine={f.immagine} cornice={f.cornice} size={40} />
                                        <div className="min-w-0">
                                            <div className="truncate font-medium">{f.nome}{f.tu && <span className="ml-2 text-sm font-normal text-[var(--d-muted)]">tu</span>}</div>
                                            {f.titolo && <div className="truncate text-sm text-[var(--d-muted)]">{f.titolo}</div>}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <div className="text-xs text-[var(--d-faint)]">I numeri si aggiornano da soli ogni 30 secondi.</div>
                </div>
            </div>
        </div>
    )
}
