"use client"

// Card "Scorta prime chiamate" di /import (PO 29/10/2026), solo ADMIN: per
// ogni GDO della squadra quanti lead vede in prima chiamata, quanti aspettano
// nella sua scorta, quanto consuma al giorno, quanti vergini riceve, quanti
// sblocchi e fra quanti giorni la scorta finisce.
//
// Comandi admin (PO 30/10/2026): per ogni GDO "Accendi scorta", "Spegni
// scorta" e "Sblocca 30 ora". Accendere e spegnere chiedono conferma nel
// bottone stesso ("Sicuro?"), senza finestre del browser. Il ruolo si verifica
// lato server (comandoScorta).

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { comandoScorta, getScortaMonitor, type ComandoScorta, type EsitoComandoScorta, type ScortaMonitor } from "@/app/actions/scortaActions"
import { Sezione, Vuoto, NonDisponibile, bottone, oraDi } from "@/components/diretta/admin/ui"
import { numeroIt } from "@/lib/diretta/formato"

const giornoCorto = (iso: string) => {
    const [, m, g] = iso.split("-")
    return `${Number(g)}/${Number(m)}`
}

export function ScortaMonitorCard() {
    const router = useRouter()
    // undefined = in lettura, null = non ADMIN (card nascosta), 'errore' = lettura fallita.
    const [stato, setStato] = useState<ScortaMonitor | null | undefined | 'errore'>(undefined)
    // Bottone in attesa di conferma ("Sicuro?"): un GDO e un comando alla volta.
    const [conferma, setConferma] = useState<{ gdoId: string; comando: ComandoScorta } | null>(null)
    const [lavoro, setLavoro] = useState(false)
    const [esito, setEsito] = useState<EsitoComandoScorta | null>(null)

    const leggi = useCallback(async () => {
        try {
            setStato(await getScortaMonitor())
        } catch {
            setStato('errore')
        }
    }, [])

    useEffect(() => { leggi() }, [leggi])

    if (stato === null) return null

    const titolo = "Scorta prime chiamate"
    if (stato === undefined) {
        return <Sezione titolo={titolo} className="mt-8"><Vuoto>Sto leggendo le scorte…</Vuoto></Sezione>
    }
    if (stato === 'errore') {
        return <Sezione titolo={titolo} className="mt-8"><NonDisponibile /></Sezione>
    }

    const accesi = stato.gdo.filter(g => g.accesa)
    const spenti = stato.gdo.filter(g => !g.accesa)

    const esegui = async (gdoId: string, comando: ComandoScorta) => {
        setConferma(null)
        setLavoro(true)
        setEsito(null)
        try {
            setEsito(await comandoScorta(gdoId, comando))
        } catch {
            setEsito({ ok: false, errore: "Comando non riuscito. Riprova." })
        } finally {
            await leggi()
            router.refresh()
            setLavoro(false)
        }
    }

    // Accendi e spegni: il primo clic chiede conferma, il secondo esegue.
    const conConferma = (gdoId: string, comando: 'accendi' | 'spegni', etichetta: string) => {
        const inAttesa = conferma?.gdoId === gdoId && conferma.comando === comando
        if (!inAttesa) {
            return (
                <button type="button" disabled={lavoro} onClick={() => { setEsito(null); setConferma({ gdoId, comando }) }} className={bottone(comando === 'accendi' ? 'primario' : 'linea', 'piccola')}>
                    {etichetta}
                </button>
            )
        }
        return (
            <div className="inline-flex items-center gap-1.5">
                <button type="button" disabled={lavoro} onClick={() => esegui(gdoId, comando)} className={bottone('primario', 'piccola')}>
                    Sicuro? Conferma
                </button>
                <button type="button" disabled={lavoro} onClick={() => setConferma(null)} className={bottone('testo', 'piccola')}>
                    Annulla
                </button>
            </div>
        )
    }

    return (
        <Sezione titolo={titolo} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="max-w-[40rem] text-[14px] text-[#BFBFBF]">
                    In prima chiamata ogni GDO vede i nuovi, i caldi e una parte del resto; gli altri lead restano suoi
                    nella scorta e si sbloccano 30 alla volta quando ha finito. Letto alle {oraDi(stato.lettoAlle)}.
                </p>
                <button type="button" disabled={lavoro} onClick={() => { setEsito(null); setConferma(null); setStato(undefined); leggi() }} className={bottone('linea', 'piccola')}>
                    Aggiorna
                </button>
            </div>

            {esito && (
                <p role="status" className={`mt-4 text-[14px] ${esito.ok ? "text-[#F2F2F2]" : "text-[#FF9330]"}`}>
                    {esito.ok ? esito.messaggio : esito.errore}
                </p>
            )}

            {accesi.length === 0 ? (
                <div className="mt-5"><Vuoto>La scorta non è accesa per nessun GDO.</Vuoto></div>
            ) : (
                <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[68rem] text-left text-[14px]">
                        <thead>
                            <tr className="text-[13px] text-[#BFBFBF]">
                                <th className="pb-2 pr-3 font-medium">GDO</th>
                                <th className="pb-2 pr-3 text-right font-medium">Visibili</th>
                                <th className="pb-2 pr-3 text-right font-medium">Scorta</th>
                                <th className="pb-2 pr-3 text-right font-medium">Esitati oggi</th>
                                <th className="pb-2 pr-3 font-medium">Ultimi 7 giorni</th>
                                <th className="pb-2 pr-3 text-right font-medium">Media</th>
                                <th className="pb-2 pr-3 text-right font-medium">Nuovi oggi</th>
                                <th className="pb-2 pr-3 text-right font-medium">Sblocchi</th>
                                <th className="pb-2 pr-3 text-right font-medium">Giorni stimati</th>
                                <th className="pb-2 text-right font-medium">Comandi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accesi.map(g => (
                                <tr key={g.id} className="border-t-2 border-[#2E2E2E]">
                                    <td className="max-w-[12rem] truncate py-2 pr-3 font-medium">{g.nome}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{numeroIt(g.visibili)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums text-[#FF9330]">{numeroIt(g.scorta)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{numeroIt(g.consumoOggi)}</td>
                                    <td
                                        className="whitespace-nowrap py-2 pr-3 tabular-nums text-[#BFBFBF]"
                                        title={stato.giorni.map((d, i) => `${giornoCorto(d)}: ${g.consumoGiorni[i]}`).join(" · ")}
                                    >
                                        {g.consumoGiorni.join(" · ")}
                                    </td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{g.consumoMedio === null ? "—" : numeroIt(g.consumoMedio, 1)}</td>
                                    <td className="py-2 pr-3 text-right tabular-nums">{numeroIt(g.verginiOggi)}</td>
                                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                                        {numeroIt(g.sblocchiOggi)} oggi · {numeroIt(g.sblocchiSettimana)} in 7 gg
                                    </td>
                                    <td className="py-2 pr-3 text-right tabular-nums">
                                        {g.giorniStimati === null ? "non si esaurisce" : g.giorniStimati === 0 ? "finita" : numeroIt(g.giorniStimati)}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                                            <button type="button" disabled={lavoro || g.scorta === 0} onClick={() => esegui(g.id, 'sblocca')} className={bottone('linea', 'piccola')}>
                                                Sblocca 30 ora
                                            </button>
                                            {conConferma(g.id, 'spegni', "Spegni scorta")}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-3 text-[13px] text-[#BFBFBF]">
                        Esitati = prime chiamate esitate. Giorni stimati = scorta divisa per quanto cala in media al giorno
                        (esitati meno lead arrivati), sui giorni lavorati degli ultimi 7.
                    </p>
                </div>
            )}

            {spenti.length > 0 && (
                <div className="mt-6">
                    <div className="text-[13px] text-[#BFBFBF]">
                        Scorta spenta: vedono tutta la prima chiamata. Accendendo restano visibili i nuovi, i caldi e i 40
                        migliori, il resto va nella scorta.
                    </div>
                    <ul className="mt-2">
                        {spenti.map(g => (
                            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[#2E2E2E] py-2 text-[14px]">
                                <div className="min-w-0">
                                    <span className="font-medium">{g.nome}</span>
                                    <span className="ml-2 tabular-nums text-[#BFBFBF]">{numeroIt(g.visibili)} in prima chiamata</span>
                                </div>
                                {conConferma(g.id, 'accendi', "Accendi scorta")}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Sezione>
    )
}
