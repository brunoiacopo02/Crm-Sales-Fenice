"use client"

// Card "Lead database punteggio alto" di /import (PO 30/10/2026), solo ADMIN:
// i lead della coda marketing rimasti senza nessuno. Quanti sono, da quando,
// da che funnel, con che segnale e quanto è vecchio il contatto; se l'admin
// vuole, N ai GDO che sceglie, pareggiando le prime chiamate. Niente parte da
// solo. I numeri si rileggono a ogni apertura, con "Aggiorna" e dopo ogni
// assegnazione.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
    getPunteggioAltoStato, assegnaPunteggioAlto,
    type PunteggioAltoStato, type PunteggioAltoEsito,
} from "@/app/actions/poolPunteggioAltoActions"
import { Sezione, Riga, Vuoto, NonDisponibile, bottone } from "@/components/diretta/admin/ui"
import { numeroIt, giornoMeseLungo } from "@/lib/diretta/formato"
import { pianificaPareggio, quantiATesta } from "@/lib/marketingQueue/poolPunteggioAlto"

const TITOLO = "Lead database punteggio alto"

export function PunteggioAltoPoolCard() {
    const router = useRouter()
    // undefined = in lettura, null = non ADMIN (card nascosta), 'errore' = lettura fallita.
    const [stato, setStato] = useState<PunteggioAltoStato | null | undefined | 'errore'>(undefined)
    const [quanti, setQuanti] = useState("")
    const [scelti, setScelti] = useState<Set<string>>(new Set())
    const [daConfermare, setDaConfermare] = useState(false)
    const [lavoro, setLavoro] = useState(false)
    const [esito, setEsito] = useState<PunteggioAltoEsito | null>(null)

    const leggi = useCallback(async () => {
        try {
            setStato(await getPunteggioAltoStato())
        } catch {
            setStato('errore')
        }
    }, [])

    useEffect(() => { leggi() }, [leggi])

    const pronto = stato && stato !== 'errore' ? stato : null
    const n = parseInt(quanti, 10)
    const quantiOk = Number.isFinite(n) && n > 0
    const massimo = pronto ? Math.min(pronto.totale, pronto.maxPerVolta) : 0
    const daDare = quantiOk ? Math.min(n, massimo) : 0

    // Anteprima del pareggio con i carichi letti adesso: il server la rifà sotto lock.
    const anteprima = useMemo(() => {
        if (!pronto || daDare === 0 || scelti.size === 0) return []
        const gdo = pronto.gdo.filter(g => scelti.has(g.id))
        const piano = pianificaPareggio(Array.from({ length: daDare }, (_, i) => String(i)), gdo.map(g => ({ id: g.id, carico: g.primaChiamata })))
        const aTesta = quantiATesta(piano)
        return gdo.map(g => ({ nome: g.nome, n: aTesta.get(g.id) ?? 0, dopo: g.primaChiamata + (aTesta.get(g.id) ?? 0) }))
    }, [pronto, daDare, scelti])

    if (stato === null) return null
    if (stato === undefined) {
        return <Sezione titolo={TITOLO} className="mt-8"><Vuoto>Sto leggendo il pool…</Vuoto></Sezione>
    }
    if (stato === 'errore') {
        return <Sezione titolo={TITOLO} className="mt-8"><NonDisponibile /></Sezione>
    }

    const puoi = !lavoro && daDare > 0 && scelti.size > 0

    const cambia = (id: string) => {
        setDaConfermare(false)
        setScelti(prima => {
            const dopo = new Set(prima)
            if (dopo.has(id)) dopo.delete(id)
            else dopo.add(id)
            return dopo
        })
    }

    const assegna = async () => {
        if (!puoi) return
        setLavoro(true)
        setEsito(null)
        try {
            const res = await assegnaPunteggioAlto({ quanti: daDare, gdoIds: Array.from(scelti) })
            setEsito(res)
            if (res.ok) setQuanti("")
        } catch {
            setEsito({ ok: false, errore: "Assegnazione non riuscita. Riprova.", assegnati: 0 })
        } finally {
            setDaConfermare(false)
            await leggi()
            router.refresh()
            setLavoro(false)
        }
    }

    const campo = "h-10 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] focus:border-[#BFBFBF] focus:outline-none disabled:opacity-50"

    return (
        <Sezione titolo={TITOLO} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-[32px] font-semibold leading-none text-[#FF9330]">{numeroIt(stato.totale)}</div>
                    <div className="mt-1 text-[14px] text-[#BFBFBF]">
                        Contatti del database segnalati dal marketing, senza nessun GDO. Li dai tu a chi vuoi.
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => { setEsito(null); setDaConfermare(false); setStato(undefined); leggi() }}
                    disabled={lavoro}
                    className={bottone('linea', 'piccola')}
                >
                    Aggiorna
                </button>
            </div>

            <div className="mt-5 grid gap-6 md:grid-cols-3">
                <div>
                    <Riga etichetta="Arrivati oggi" valore={numeroIt(stato.nuoviOggi)} />
                    <Riga etichetta="Con un segnale recente" valore={numeroIt(stato.conSegnale)} nota="Un click, una visita al sito o un'email aperta" />
                </div>
                <div>
                    <h3 className="mb-2 text-[13px] font-medium text-[#BFBFBF]">Funnel di origine</h3>
                    {stato.perFunnel.length === 0
                        ? <Vuoto>—</Vuoto>
                        : stato.perFunnel.map(f => <Riga key={f.etichetta} etichetta={f.etichetta} valore={numeroIt(f.n)} />)}
                </div>
                <div>
                    <h3 className="mb-2 text-[13px] font-medium text-[#BFBFBF]">Età del contatto</h3>
                    {stato.perEta.length === 0
                        ? <Vuoto>—</Vuoto>
                        : stato.perEta.map(f => <Riga key={f.etichetta} etichetta={f.etichetta} valore={numeroIt(f.n)} />)}
                </div>
            </div>

            {stato.totale === 0 ? (
                <div className="mt-5"><Vuoto>Adesso non ci sono lead in questo pool.</Vuoto></div>
            ) : (
                <>
                    <h3 className="mt-6 text-[15px] font-semibold">In ordine di assegnazione</h3>
                    <p className="mt-1 text-[13px] text-[#BFBFBF]">
                        Prima gli ultimi arrivati, nell&apos;ordine del marketing.
                        {stato.totale > stato.elenco.length && ` Qui i primi ${numeroIt(stato.elenco.length)} di ${numeroIt(stato.totale)}.`}
                    </p>
                    <div className="mt-3 max-h-[28rem] overflow-auto">
                        <table className="w-full min-w-[44rem] text-left text-[14px]">
                            <thead className="sticky top-0 bg-[#262626]">
                                <tr className="text-[13px] text-[#BFBFBF]">
                                    <th className="pb-2 pr-3 font-medium">Lead</th>
                                    <th className="pb-2 pr-3 font-medium">Funnel</th>
                                    <th className="pb-2 pr-3 font-medium">In coda dal</th>
                                    <th className="pb-2 pr-3 font-medium">Contatto da</th>
                                    <th className="pb-2 font-medium">Segnale</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stato.elenco.map(r => (
                                    <tr key={r.id} className="border-t-2 border-[#2E2E2E]">
                                        <td className="max-w-[12rem] truncate py-2 pr-3">{r.nome}</td>
                                        <td className="whitespace-nowrap py-2 pr-3">{r.funnel}</td>
                                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{r.inCodaDal ? giornoMeseLungo(r.inCodaDal) : "—"}</td>
                                        <td className="whitespace-nowrap py-2 pr-3">{r.eta}</td>
                                        <td className="max-w-[18rem] truncate py-2 text-[#BFBFBF]" title={r.segnale ?? undefined}>{r.segnale ?? "Nessuno"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <h3 className="mt-6 text-[15px] font-semibold">Dai ai GDO</h3>
                    <p className="mt-1 text-[13px] text-[#BFBFBF]">
                        Ogni lead va a chi in quel momento ha meno lead in prima chiamata. Tra parentesi quanti ne ha adesso.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
                        <div>
                            <label htmlFor="punteggio-alto-quanti" className="mb-1 block text-[13px] text-[#BFBFBF]">Quanti</label>
                            <input
                                id="punteggio-alto-quanti"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={massimo}
                                value={quanti}
                                disabled={lavoro}
                                onChange={e => { setQuanti(e.target.value); setDaConfermare(false) }}
                                placeholder={`fino a ${numeroIt(massimo)}`}
                                className={campo}
                            />
                        </div>
                        <fieldset disabled={lavoro || stato.gdo.length === 0} aria-labelledby="punteggio-alto-chi">
                            <div className="mb-1 flex items-center justify-between gap-3">
                                <div id="punteggio-alto-chi" className="text-[13px] text-[#BFBFBF]">A chi ({numeroIt(scelti.size)} su {numeroIt(stato.gdo.length)})</div>
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => { setDaConfermare(false); setScelti(new Set(stato.gdo.map(g => g.id))) }} className={bottone('testo', 'piccola')}>Tutti</button>
                                    <button type="button" onClick={() => { setDaConfermare(false); setScelti(new Set()) }} className={bottone('testo', 'piccola')}>Nessuno</button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {stato.gdo.map(g => (
                                    <label
                                        key={g.id}
                                        className={`flex cursor-pointer items-center gap-2 rounded-[8px] border-2 px-3 py-2 text-[14px] ${scelti.has(g.id) ? "border-[#F2F2F2]" : "border-[#3D3D3D] hover:border-[#BFBFBF]"}`}
                                    >
                                        <input type="checkbox" checked={scelti.has(g.id)} onChange={() => cambia(g.id)} className="h-4 w-4 accent-[#FF9330]" />
                                        <div className="min-w-0 truncate">{g.nome} <span className="text-[#BFBFBF]">({numeroIt(g.primaChiamata)})</span></div>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </div>

                    {quantiOk && n > massimo && (
                        <div className="mt-2 text-[13px] text-[#BFBFBF]">Ne assegno {numeroIt(massimo)}: è il massimo per volta, poi puoi ripetere.</div>
                    )}
                    {stato.gdo.length === 0 && (
                        <div className="mt-2 text-[13px] text-[#BFBFBF]">Nessun GDO della squadra attivo a cui darli.</div>
                    )}

                    {anteprima.length > 0 && (
                        <div className="mt-4 rounded-[8px] border-2 border-[#3D3D3D] p-3 text-[14px]">
                            <div className="text-[13px] text-[#BFBFBF]">Come li divido adesso</div>
                            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                                {anteprima.map(a => (
                                    <div key={a.nome}>{a.nome}: <strong className="text-[#FF9330]">{numeroIt(a.n)}</strong> <span className="text-[#BFBFBF]">(in prima chiamata {numeroIt(a.dopo)})</span></div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        {!daConfermare ? (
                            <button type="button" onClick={() => setDaConfermare(true)} disabled={!puoi} className={bottone('primario')}>
                                Assegna
                            </button>
                        ) : (
                            <>
                                <div className="text-[14px]">
                                    Assegnare {numeroIt(daDare)} lead a {numeroIt(scelti.size)} GDO?
                                </div>
                                <button type="button" onClick={assegna} disabled={!puoi} className={bottone('primario')}>
                                    {lavoro ? "Assegno…" : "Sì, assegna"}
                                </button>
                                <button type="button" onClick={() => setDaConfermare(false)} disabled={lavoro} className={bottone('linea')}>
                                    Annulla
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {esito && (
                <div role="status" className={`mt-4 text-[14px] ${esito.ok ? "text-[#F2F2F2]" : "text-[#FF9330]"}`}>
                    {esito.ok
                        ? `Fatto: ${numeroIt(esito.assegnati)} lead assegnati (${(esito.perGdo ?? []).map(g => `${g.nome} ${numeroIt(g.n)}`).join(", ")}).`
                        : esito.errore}
                </div>
            )}
        </Sezione>
    )
}
