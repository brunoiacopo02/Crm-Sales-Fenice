"use client"

// Schermata d'inizio turno della Diretta: compare al primo accesso del giorno
// dopo l'inizio del turno (13:30 nei feriali, 10:00 il sabato), una volta al
// giorno. Il "già vista" sta in localStorage; se il browser non lo permette,
// vale in memoria per la sessione.

import { useCallback, useEffect, useRef, useState } from "react"
import { getInizioTurno } from "@/app/actions/direttaActions"
import type { GamificationTargets } from "@/lib/diretta/config"
import { peakWindow } from "@/lib/diretta/config"
import { toRomeDateStr } from "@/lib/dateUtils"
import { mostraInizioTurno, oraBreve, oraParlata } from "@/lib/diretta/home"
import { DailyQuoteSlot } from "./DailyQuoteSlot"
import { useOrologio } from "./useOrologio"

type Props = {
    userId: string
    nome: string
    pronta: boolean
    obiettivi: GamificationTargets
    leadInCoda: number
    richiamiOggi: number
    primoRichiamo: Date | null
    onInizia: (coda: 'recalls' | 'first') => void
}

export function InizioTurno({ userId, nome, pronta, obiettivi, leadInCoda, richiamiOggi, primoRichiamo, onInizia }: Props) {
    const adesso = useOrologio(30_000)
    const [aperta, setAperta] = useState(false)
    const [ieri, setIeri] = useState<{ etichetta: string; fissati: number; confermati: number } | null>(null)
    const chiusaOggi = useRef<string | null>(null)
    const chiave = `diretta-inizio-turno:${userId}`

    useEffect(() => {
        if (!pronta || !adesso || aperta) return
        let vista: string | null = null
        try { vista = localStorage.getItem(chiave) } catch { /* storage non disponibile */ }
        const oggi = toRomeDateStr(adesso)
        if (chiusaOggi.current === oggi) return
        if (!mostraInizioTurno(adesso, obiettivi, vista)) return
        setAperta(true)
        getInizioTurno().then(setIeri).catch(() => { /* la riga resta vuota */ })
    }, [pronta, adesso, aperta, chiave, obiettivi])

    const chiudi = useCallback((coda?: 'recalls' | 'first') => {
        const oggi = toRomeDateStr(new Date())
        chiusaOggi.current = oggi
        try { localStorage.setItem(chiave, oggi) } catch { /* resta in memoria */ }
        setAperta(false)
        if (coda) onInizia(coda)
    }, [chiave, onInizia])

    useEffect(() => {
        if (!aperta) return
        const suTasto = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
        document.addEventListener('keydown', suTasto)
        return () => document.removeEventListener('keydown', suTasto)
    }, [aperta, chiudi])

    if (!aperta || !adesso) return null

    const punta = peakWindow(adesso, obiettivi)
    const dalRichiamo = richiamiOggi > 0
    const primoScaduto = primoRichiamo && primoRichiamo.getTime() <= adesso.getTime()

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inizio-turno-titolo"
            className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white lg:flex-row"
        >
            <section className="flex min-w-0 flex-1 flex-col justify-center gap-10 px-6 py-12 text-[#171717] sm:px-12 lg:px-20 lg:py-24">
                <h1 id="inizio-turno-titolo" className="max-w-[760px] text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[56px]">
                    Ciao{nome ? ` ${nome}` : ''}, oggi l&apos;obiettivo è <span className="text-[#E07400]">{obiettivi.personale[0]} appuntamenti</span>
                </h1>

                <div className="flex max-w-[640px] flex-col text-[19px]">
                    <RigaInizio etichetta="Lead in coda per te" valore={String(leadInCoda)} />
                    <RigaInizio etichetta="Richiami da fare oggi" valore={String(richiamiOggi)} />
                    <RigaInizio
                        etichetta={`Appuntamenti di ${ieri?.etichetta ?? 'ieri'} già confermati`}
                        valore={ieri ? (ieri.fissati === 0 ? 'nessuno fissato' : `${ieri.confermati} su ${ieri.fissati}`) : ''}
                    />
                    <RigaInizio
                        etichetta="Ora di punta di squadra"
                        valore={punta ? `dalle ${oraParlata(punta.start)} alle ${oraParlata(punta.end)}` : ''}
                        ultima
                    />
                </div>

                <div className="flex flex-wrap items-center gap-5">
                    <button
                        type="button"
                        autoFocus
                        onClick={() => chiudi(dalRichiamo ? 'recalls' : 'first')}
                        className="h-16 rounded-lg bg-[#FF9330] px-9 text-[19px] font-semibold text-[#171717] transition-colors hover:bg-[#FFA552]"
                    >
                        {dalRichiamo ? 'Inizia dai richiami' : 'Inizia dalla prima chiamata'}
                    </button>
                    {dalRichiamo && primoRichiamo && (
                        <div className="text-[15px] text-[#3D3D3D]">
                            {primoScaduto ? 'Il primo è già scaduto: parti da lì.' : `Il primo è alle ${oraBreve(primoRichiamo)}.`}
                        </div>
                    )}
                </div>
            </section>

            <aside className="flex flex-col justify-center gap-9 bg-[#171717] px-6 py-12 text-[#F2F2F2] sm:px-14 lg:w-[480px] lg:shrink-0 lg:py-24">
                <DailyQuoteSlot />
                <div>
                    <div className="text-[16px] text-[#BFBFBF]">La squadra oggi punta a</div>
                    <div className="mt-2 text-[96px] font-semibold leading-none text-[#FF9330] tabular-nums">{obiettivi.squadra[0]}</div>
                    <div className="mt-3 text-[17px] leading-relaxed">
                        appuntamenti, poi {obiettivi.squadra[1]}. Nell&apos;ora di punta {obiettivi.punta[0]}, poi {obiettivi.punta[1]}.
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => chiudi()}
                    className="self-start text-[15px] text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                >
                    Chiudi
                </button>
            </aside>
        </div>
    )
}

function RigaInizio({ etichetta, valore, ultima = false }: { etichetta: string; valore: string; ultima?: boolean }) {
    return (
        <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-[18px] ${ultima ? '' : 'border-b-2 border-[#F2F2F2]'}`}>
            <div>{etichetta}</div>
            <div className="font-semibold tabular-nums">{valore}</div>
        </div>
    )
}
