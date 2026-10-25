"use client"

// Card "Lead accantonati" di /import (PO 25/10/2026), solo ADMIN: quanti sono
// adesso, i ridati più di recente in cima, e N da dare a un GDO della squadra.
// I numeri si rileggono a ogni apertura, con "Aggiorna" e dopo ogni
// assegnazione: il pool può cambiare mentre la pagina è aperta.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getAccantonatiStato, assegnaAccantonati, type AccantonatiStato, type AccantonatiEsito } from "@/app/actions/accantonatiActions"
import { Sezione, Riga, Vuoto, NonDisponibile, bottone, giornoOraDi } from "@/components/diretta/admin/ui"
import { numeroIt } from "@/lib/diretta/formato"

export function AccantonatiPoolCard() {
    const router = useRouter()
    // undefined = in lettura, null = non ADMIN (card nascosta), 'errore' = lettura fallita.
    const [stato, setStato] = useState<AccantonatiStato | null | undefined | 'errore'>(undefined)
    const [quanti, setQuanti] = useState("")
    const [gdoId, setGdoId] = useState("")
    const [lavoro, setLavoro] = useState(false)
    const [esito, setEsito] = useState<AccantonatiEsito | null>(null)

    const leggi = useCallback(async () => {
        try {
            setStato(await getAccantonatiStato())
        } catch {
            setStato('errore')
        }
    }, [])

    useEffect(() => { leggi() }, [leggi])

    if (stato === null) return null

    const titolo = "Lead accantonati"
    if (stato === undefined) {
        return <Sezione titolo={titolo} className="mt-8"><Vuoto>Sto leggendo il pool…</Vuoto></Sezione>
    }
    if (stato === 'errore') {
        return <Sezione titolo={titolo} className="mt-8"><NonDisponibile /></Sezione>
    }

    const n = parseInt(quanti, 10)
    const quantiOk = Number.isFinite(n) && n > 0
    const massimo = Math.min(stato.totale, stato.maxPerVolta)
    const puoi = !lavoro && quantiOk && !!gdoId && stato.totale > 0

    const assegna = async () => {
        if (!puoi) return
        const nome = stato.gdo.find(g => g.id === gdoId)?.nome ?? ""
        const daDare = Math.min(n, massimo)
        if (!confirm(`Assegnare ${daDare} lead accantonati a ${nome}?`)) return
        setLavoro(true)
        setEsito(null)
        try {
            const res = await assegnaAccantonati({ quanti: daDare, gdoId })
            setEsito(res)
            if (res.ok) setQuanti("")
        } catch {
            setEsito({ ok: false, errore: "Assegnazione non riuscita. Riprova.", assegnati: 0 })
        } finally {
            await leggi()
            router.refresh()
            setLavoro(false)
        }
    }

    const campo = "h-10 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] focus:border-[#BFBFBF] focus:outline-none disabled:opacity-50"

    return (
        <Sezione titolo={titolo} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-[32px] font-semibold leading-none text-[#FF9330]">{numeroIt(stato.totale)}</div>
                    <div className="mt-1 text-[14px] text-[#BFBFBF]">
                        Lead tornati indietro e messi da parte, senza nessun GDO. Li dai tu a chi vuoi.
                    </div>
                </div>
                <button type="button" onClick={() => { setEsito(null); setStato(undefined); leggi() }} disabled={lavoro} className={bottone('linea', 'piccola')}>
                    Aggiorna
                </button>
            </div>

            {stato.perMotivo.length > 0 && (
                <div className="mt-5">
                    {stato.perMotivo.map(m => <Riga key={m.etichetta} etichetta={m.etichetta} valore={numeroIt(m.n)} />)}
                </div>
            )}

            {stato.totale === 0 ? (
                <div className="mt-5"><Vuoto>Adesso non ci sono lead accantonati.</Vuoto></div>
            ) : (
                <>
                    <h3 className="mt-6 text-[15px] font-semibold">I più recenti</h3>
                    <p className="mt-1 text-[13px] text-[#BFBFBF]">Si assegnano in quest&apos;ordine: prima quelli tornati indietro più di recente.</p>
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[32rem] text-left text-[14px]">
                            <thead>
                                <tr className="text-[13px] text-[#BFBFBF]">
                                    <th className="pb-2 pr-3 font-medium">Lead</th>
                                    <th className="pb-2 pr-3 font-medium">Tornato il</th>
                                    <th className="pb-2 pr-3 font-medium">Chiamate</th>
                                    <th className="pb-2 font-medium">Perché</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stato.recenti.map(r => (
                                    <tr key={r.id} className="border-t-2 border-[#2E2E2E]">
                                        <td className="max-w-[14rem] truncate py-2 pr-3">{r.nome}</td>
                                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{r.ridatoIl ? giornoOraDi(r.ridatoIl) : "—"}</td>
                                        <td className="py-2 pr-3 tabular-nums">{r.tentativi}</td>
                                        <td className="py-2 text-[#BFBFBF]">{r.motivo}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
                        <div>
                            <label htmlFor="accantonati-quanti" className="mb-1 block text-[13px] text-[#BFBFBF]">Quanti</label>
                            <input
                                id="accantonati-quanti"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={massimo}
                                value={quanti}
                                disabled={lavoro}
                                onChange={e => setQuanti(e.target.value)}
                                placeholder={`fino a ${numeroIt(massimo)}`}
                                className={campo}
                            />
                        </div>
                        <div>
                            <label htmlFor="accantonati-gdo" className="mb-1 block text-[13px] text-[#BFBFBF]">A chi</label>
                            <select
                                id="accantonati-gdo"
                                value={gdoId}
                                disabled={lavoro || stato.gdo.length === 0}
                                onChange={e => setGdoId(e.target.value)}
                                className={campo}
                            >
                                <option value="">Scegli un GDO</option>
                                {stato.gdo.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                            </select>
                        </div>
                        <button type="button" onClick={assegna} disabled={!puoi} className={bottone('primario')}>
                            {lavoro ? "Assegno…" : "Assegna"}
                        </button>
                    </div>
                    {quantiOk && n > massimo && (
                        <p className="mt-2 text-[13px] text-[#BFBFBF]">Ne assegno {numeroIt(massimo)}: è il massimo per volta, poi puoi ripetere.</p>
                    )}
                    {stato.gdo.length === 0 && (
                        <p className="mt-2 text-[13px] text-[#BFBFBF]">Nessun GDO della squadra attivo a cui darli.</p>
                    )}
                </>
            )}

            {esito && (
                <p role="status" className={`mt-4 text-[14px] ${esito.ok ? "text-[#F2F2F2]" : "text-[#FF9330]"}`}>
                    {esito.ok ? `Fatto: ${numeroIt(esito.assegnati)} lead assegnati a ${esito.nomeGdo}.` : esito.errore}
                </p>
            )}
        </Sezione>
    )
}
