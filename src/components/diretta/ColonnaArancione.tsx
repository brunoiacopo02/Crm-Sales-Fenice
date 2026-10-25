"use client"

// Colonna arancione della home Diretta: i miei fissati di oggi, la squadra a
// blocchi, l'ora di punta e la prossima pausa. Sull'arancione il testo è nero.
// Orari e conti alla rovescia solo lato client (useOrologio).

import type { GamificationTargets } from "@/lib/diretta/config"
import {
    durataTesto, fraseRitmo, fraseSquadra, oraBreve, oraParlata, statoFinestra, statoPausa, traguardo,
} from "@/lib/diretta/home"
import type { Momento } from "./useDirettaLive"
import { useOrologio } from "./useOrologio"

type Props = {
    nome: string
    caricato: boolean
    fissatiOggi: number
    squadra: number
    punta: number
    obiettivi: GamificationTargets
    puntaInizio: string | null
    puntaFine: string | null
    momento: Momento | null
}

const FRASE_MOMENTO: Record<Momento['tipo'], (n: number) => string | null> = {
    semplice: () => null,
    scalino: (n) => (n === 1 ? 'Il primo di oggi.' : 'Primo obiettivo preso.'),
    pieno: () => 'Obiettivo pieno.',
}

export function ColonnaArancione({ nome, caricato, fissatiOggi, squadra, punta, obiettivi, puntaInizio, puntaFine, momento }: Props) {
    const adesso = useOrologio(15_000)
    const meta = traguardo(fissatiOggi, obiettivi.personale)
    const metaSquadra = traguardo(squadra, obiettivi.squadra)
    const celle = Math.max(1, obiettivi.squadra[1])
    const fraseMomento = momento ? FRASE_MOMENTO[momento.tipo](momento.n) : null

    const finestraPunta = puntaInizio && puntaFine ? { start: new Date(puntaInizio), end: new Date(puntaFine) } : null
    const statoPunta = adesso ? statoFinestra(adesso, finestraPunta) : null
    const pausa = adesso ? statoPausa(adesso, obiettivi) : null

    return (
        <aside aria-label="La tua giornata e la squadra" className="d-colonna flex flex-col gap-7 bg-[#FF9330] px-6 py-7 text-[#171717] sm:px-8 sm:py-8">
            <section aria-live="polite">
                <div className="text-[16px] font-medium">{nome ? `${nome}, oggi hai fissato` : 'Oggi hai fissato'}</div>
                <div className="relative mt-2 inline-block">
                    <div
                        key={momento?.chiave ?? 'fermo'}
                        className={`d-numero text-[112px] font-semibold leading-[0.9] tracking-[-0.04em] tabular-nums 2xl:text-[150px] ${momento ? (momento.tipo === 'semplice' ? 'd-pop' : 'd-pop-forte') : ''} ${momento?.tipo === 'pieno' ? 'd-inverti' : ''}`}
                    >
                        {caricato ? fissatiOggi : <span className="invisible">0</span>}
                    </div>
                    {momento && momento.tipo !== 'semplice' && (
                        <div key={`traccia-${momento.chiave}`} aria-hidden="true" className="d-traccia mt-2 h-1.5 w-full origin-left rounded-[2px] bg-[#171717]" />
                    )}
                </div>
                <div className={`mt-3 text-[18px] leading-snug ${caricato ? '' : 'invisible'}`}>
                    {fissatiOggi === 1 ? 'appuntamento' : 'appuntamenti'}{fissatiOggi < obiettivi.personale[1] ? ` su ${meta}` : ''}.{' '}
                    <span className="font-semibold">{fraseRitmo(fissatiOggi, obiettivi.personale)}</span>
                </div>
                {fraseMomento && (
                    <div key={`frase-${momento?.chiave}`} className="d-svanisce mt-2 text-[16px] font-semibold">{fraseMomento}</div>
                )}
            </section>

            <div className="h-0.5 bg-[#171717]/20" />

            <section className={caricato ? '' : 'invisible'}>
                <div className="text-[16px] font-medium">La squadra oggi</div>
                <div className="mt-1 text-[44px] font-semibold leading-none tabular-nums">
                    {squadra}{squadra < obiettivi.squadra[1] && <span className="text-[22px] font-normal"> su {metaSquadra}</span>}
                </div>
                <div aria-hidden="true" className="mt-3 flex flex-wrap gap-1">
                    {Array.from({ length: celle }, (_, i) => {
                        const piena = i < squadra
                        const oltrePrimo = i >= obiettivi.squadra[0]
                        return (
                            <div
                                key={i}
                                className={`h-3 w-3 rounded-[3px] ${piena
                                    ? 'bg-[#171717]'
                                    : oltrePrimo ? 'border-2 border-[#171717]/35' : 'border-2 border-[#171717]'}`}
                            />
                        )
                    })}
                </div>
                <div className="mt-3 text-[15px] leading-snug">
                    {fraseSquadra(squadra, obiettivi.squadra)}
                </div>
            </section>

            {finestraPunta && (
                <section className={`rounded-2xl bg-[#171717] px-5 py-4 text-[#F2F2F2] ${momento?.inPunta ? 'd-punta-pop' : ''}`} key={momento?.inPunta ? `punta-${momento.chiave}` : 'punta'}>
                    <div className="text-[15px] font-semibold">
                        Ora di punta, dalle {oraParlata(finestraPunta.start)} alle {oraParlata(finestraPunta.end)}
                    </div>
                    {statoPunta?.fase === 'durante' ? (
                        <>
                            <div className="mt-3 flex items-baseline gap-2 tabular-nums">
                                <span className="text-[36px] font-semibold leading-none">{punta}</span>
                                <span className="text-[15px] text-[#BFBFBF]">su {traguardo(punta, obiettivi.punta)}</span>
                            </div>
                            <BarraPunta valore={punta} scalini={obiettivi.punta} />
                            <div className="mt-2 text-[14px] text-[#BFBFBF]">Restano {durataTesto(statoPunta.minuti)}.</div>
                        </>
                    ) : statoPunta?.fase === 'dopo' ? (
                        <div className="mt-1.5 text-[14px] leading-relaxed text-[#BFBFBF]">
                            Chiusa con <span className="font-semibold text-[#F2F2F2]">{punta}</span> {punta === 1 ? 'appuntamento' : 'appuntamenti'} di squadra.
                            {' '}{punta >= obiettivi.punta[1] ? 'Obiettivo pieno.' : punta >= obiettivi.punta[0] ? 'Primo obiettivo preso.' : `L'obiettivo era ${obiettivi.punta[0]}.`}
                        </div>
                    ) : (
                        <div className="mt-1.5 text-[14px] leading-relaxed text-[#BFBFBF]">
                            {statoPunta
                                ? <>Alle {oraParlata(finestraPunta.start)} parte l&apos;ora di punta, tra <span className="text-[#F2F2F2]">{durataTesto(statoPunta.minuti)}</span>. </>
                                : null}
                            Obiettivo di squadra {obiettivi.punta[0]}, poi {obiettivi.punta[1]}.
                        </div>
                    )}
                </section>
            )}

            {pausa && (
                <section className="text-[15px] leading-snug">
                    {pausa.fase === 'durante'
                        ? <>Pausa di squadra fino alle <span className="font-semibold">{oraBreve(pausa.end)}</span>.</>
                        : <>Prossima pausa alle <span className="font-semibold">{oraBreve(pausa.start)}</span>, per {durataTesto((pausa.end.getTime() - pausa.start.getTime()) / 60000)}.</>}
                </section>
            )}
        </aside>
    )
}

function BarraPunta({ valore, scalini }: { valore: number; scalini: [number, number] }) {
    const fondo = Math.max(1, scalini[1])
    const pieno = Math.min(1, valore / fondo)
    const primo = Math.min(1, scalini[0] / fondo)
    return (
        <div className="mt-3">
            <div className="relative h-2.5 overflow-hidden rounded-[3px] bg-[#3D3D3D]">
                <div className="h-full bg-[#FF9330] transition-[width] duration-500" style={{ width: `${pieno * 100}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-[#F2F2F2]" style={{ left: `calc(${primo * 100}% - 1px)` }} />
            </div>
            <div className="relative mt-1 h-4 text-[12px] tabular-nums text-[#BFBFBF]">
                <span className="absolute -translate-x-1/2" style={{ left: `${primo * 100}%` }}>{scalini[0]}</span>
                <span className="absolute right-0">{scalini[1]}</span>
            </div>
        </div>
    )
}
