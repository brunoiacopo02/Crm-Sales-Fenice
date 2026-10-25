"use client"

// Home GDO "Diretta" (PO 25/10/2026, tavola B del canvas).
// A sinistra la colonna arancione (io, squadra, ora di punta, pause), al
// centro le code con le stesse card e gli stessi esiti di sempre, a destra la
// cronaca della squadra e la scheda personale. Niente overlay della vecchia
// gamification: il momento appuntamento è il contatore che avanza.

import { useCallback, useMemo, useState } from "react"
import { PipelineBoard, type PipelineTab } from "@/components/PipelineBoard"
import { DEFAULT_TARGETS } from "@/lib/diretta/config"
import { dayBoundsRome } from "@/lib/dateUtils"
import { ColonnaArancione } from "./ColonnaArancione"
import { Cronaca } from "./Cronaca"
import { InizioTurno } from "./InizioTurno"
import { SchedaPersonale } from "./SchedaPersonale"
import { useDirettaLive } from "./useDirettaLive"
import { useOrologio } from "./useOrologio"

type LeadList = any[] // eslint-disable-line @typescript-eslint/no-explicit-any

type Props = {
    userId: string
    nome: string
    firstCall: LeadList
    secondCall: LeadList
    thirdCall: LeadList
    fourthCall: LeadList
    isFourthCallActive: boolean
    recalls: LeadList
    pipelineError: string
}

export function DirettaHome({ userId, nome, firstCall, secondCall, thirdCall, fourthCall, isFourthCallActive, recalls, pipelineError }: Props) {
    const { live, fissatiOggi, squadra, punta, momento } = useDirettaLive()
    const obiettivi = live?.squadra.obiettivi ?? DEFAULT_TARGETS
    const adesso = useOrologio(30_000)
    const [richiesta, setRichiesta] = useState<{ tab: PipelineTab; n: number } | null>(null)

    // Richiami da fare oggi: quelli in scadenza entro stasera, compresi gli arretrati.
    const { richiamiOggi, primoRichiamo } = useMemo(() => {
        if (!adesso) return { richiamiOggi: 0, primoRichiamo: null as Date | null }
        const fine = dayBoundsRome(adesso).end.getTime()
        const date = recalls
            .map(r => (r.recallDate ? new Date(r.recallDate) : null))
            .filter((d): d is Date => !!d && d.getTime() < fine)
            .sort((a, b) => a.getTime() - b.getTime())
        return { richiamiOggi: date.length, primoRichiamo: date[0] ?? null }
    }, [recalls, adesso])

    const leadInCoda = firstCall.length + secondCall.length + thirdCall.length + (isFourthCallActive ? fourthCall.length : 0)
    const inizia = useCallback((coda: 'recalls' | 'first') => {
        setRichiesta(r => ({ tab: coda, n: (r?.n ?? 0) + 1 }))
    }, [])

    return (
        <div className="d-home flex min-h-full flex-col bg-[#171717] text-[#F2F2F2] xl:h-full">
            {pipelineError && (
                <div role="alert" className="mx-4 mt-4 rounded-lg bg-[#262626] px-4 py-3 text-[14px] text-[#F2F2F2] sm:mx-6">
                    Errore nel caricamento della pipeline: {pipelineError}. Ricarica la pagina.
                </div>
            )}

            <div className="flex flex-1 flex-col xl:min-h-0 xl:flex-row">
                <div className="bg-[#FF9330] xl:w-[320px] xl:shrink-0 xl:overflow-y-auto 2xl:w-[360px]">
                    <ColonnaArancione
                        nome={nome}
                        caricato={!!live}
                        fissatiOggi={fissatiOggi}
                        squadra={squadra}
                        punta={punta}
                        obiettivi={obiettivi}
                        puntaInizio={live?.squadra.puntaInizio ?? null}
                        puntaFine={live?.squadra.puntaFine ?? null}
                        momento={momento}
                    />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 xl:min-h-0 xl:flex-row xl:gap-7 xl:p-7">
                    <div className="flex h-[80vh] min-w-0 flex-1 flex-col xl:h-auto xl:min-h-0">
                        <PipelineBoard
                            variant="diretta"
                            richiestaTab={richiesta}
                            firstCall={firstCall}
                            secondCall={secondCall}
                            thirdCall={thirdCall}
                            fourthCall={fourthCall}
                            isFourthCallActive={isFourthCallActive}
                            recalls={recalls}
                        />
                    </div>

                    <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start xl:flex xl:w-[300px] xl:shrink-0 xl:flex-col xl:overflow-y-auto xl:pb-6">
                        <Cronaca voci={live?.squadra.cronaca ?? []} mioId={live?.io.id ?? userId} caricato={!!live} />
                        <SchedaPersonale mia={live?.mia ?? null} obiettivi={obiettivi} />
                    </div>
                </div>
            </div>

            <InizioTurno
                userId={userId}
                nome={nome}
                pronta={!!live}
                obiettivi={obiettivi}
                leadInCoda={leadInCoda}
                richiamiOggi={richiamiOggi}
                primoRichiamo={primoRichiamo}
                onInizia={inizia}
            />
        </div>
    )
}
