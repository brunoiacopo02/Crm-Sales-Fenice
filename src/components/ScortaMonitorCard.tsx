"use client"

// Card "Scorta prime chiamate" di /import (PO 29/10/2026), solo ADMIN: per
// ogni GDO della squadra quanti lead vede in prima chiamata, quanti aspettano
// nella sua scorta, quanto consuma al giorno, quanti vergini riceve, quanti
// sblocchi e fra quanti giorni la scorta finisce. Sola lettura.

import { useCallback, useEffect, useState } from "react"
import { getScortaMonitor, type ScortaMonitor } from "@/app/actions/scortaActions"
import { Sezione, Vuoto, NonDisponibile, bottone, oraDi } from "@/components/diretta/admin/ui"
import { numeroIt } from "@/lib/diretta/formato"

const giornoCorto = (iso: string) => {
    const [, m, g] = iso.split("-")
    return `${Number(g)}/${Number(m)}`
}

export function ScortaMonitorCard() {
    // undefined = in lettura, null = non ADMIN (card nascosta), 'errore' = lettura fallita.
    const [stato, setStato] = useState<ScortaMonitor | null | undefined | 'errore'>(undefined)

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

    return (
        <Sezione titolo={titolo} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="max-w-[40rem] text-[14px] text-[#BFBFBF]">
                    In prima chiamata ogni GDO vede i nuovi, i caldi e una parte del resto; gli altri lead restano suoi
                    nella scorta e si sbloccano 30 alla volta quando ha finito. Letto alle {oraDi(stato.lettoAlle)}.
                </p>
                <button type="button" onClick={() => { setStato(undefined); leggi() }} className={bottone('linea', 'piccola')}>
                    Aggiorna
                </button>
            </div>

            {accesi.length === 0 ? (
                <div className="mt-5"><Vuoto>La scorta non è accesa per nessun GDO.</Vuoto></div>
            ) : (
                <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[52rem] text-left text-[14px]">
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
                                <th className="pb-2 text-right font-medium">Giorni stimati</th>
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
                                    <td className="py-2 text-right tabular-nums">
                                        {g.giorniStimati === null ? "non si esaurisce" : g.giorniStimati === 0 ? "finita" : numeroIt(g.giorniStimati)}
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
                <p className="mt-4 text-[13px] text-[#BFBFBF]">
                    Scorta spenta (vedono tutta la prima chiamata): {spenti.map(g => `${g.nome} (${numeroIt(g.visibili)})`).join(", ")}.
                </p>
            )}
        </Sezione>
    )
}
