"use client"

// Scheda personale della home Diretta: la vede solo chi è collegato.
// Conferme della settimana (possibili presenze), binario delle presenze della settimana (le prime caselle sono la base,
// dalla soglia in poi ogni presenza vale euro), salvadanaio, miglior
// settimana e saldo di Scintille e Piume.

import { useEffect, useRef, useState } from "react"
import type { GamificationTargets } from "@/lib/diretta/config"
import type { DirettaMia } from "@/lib/diretta/live"
import { binarioPresenze, chiaveSettimana, etichettaSettimana, euro } from "@/lib/diretta/home"
import { numeroIt } from "@/lib/diretta/formato"
import { testoSerie, type SerieDaMostrare } from "@/lib/diretta/serieTesto"
import { Flame, Shield } from "lucide-react"

export function SchedaPersonale({ mia, obiettivi }: { mia: DirettaMia | null; obiettivi: GamificationTargets }) {
    const presenze = mia?.presenzeSettimana ?? 0
    const caselle = binarioPresenze(presenze, obiettivi)
    const sogliaRaggiunta = presenze >= obiettivi.presenzeSogliaEuro

    return (
        <section aria-label="La tua settimana" className="rounded-2xl bg-[#262626] p-5 text-[#F2F2F2]">
            <h2 className="text-[16px] font-semibold">La tua settimana</h2>
            <div className="mt-0.5 text-[13px] text-[#BFBFBF]">La vedi solo tu.</div>

            {/* Conferme prima delle presenze (PO 26/10/2026): ogni conferma è una possibile presenza. */}
            <div className="mt-5 flex items-baseline justify-between gap-3 text-[14px]">
                <span>Conferme</span>
                <span className="text-[20px] font-semibold tabular-nums">{mia?.confermeSettimana ?? 0}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-[#BFBFBF]">
                {(mia?.confermeInAttesa ?? 0) === 0
                    ? 'Appuntamenti confermati dalle Conferme questa settimana.'
                    : (mia?.confermeInAttesa ?? 0) === 1
                        ? '1 confermato deve ancora presentarsi: può diventare una presenza.'
                        : `${mia?.confermeInAttesa} confermati devono ancora presentarsi: possono diventare presenze.`}
            </div>

            <div className="mt-5 flex items-baseline justify-between gap-3 text-[14px]">
                <span>Presenze</span>
                <span className="tabular-nums">
                    <span className="text-[20px] font-semibold">{presenze}</span>
                    <span className="text-[#BFBFBF]">, obiettivo {obiettivi.presenzeObiettivo}</span>
                </span>
            </div>
            {/* L'obiettivo non è un tetto: la casella col + è sempre la prossima presenza. */}
            <div className="mt-2 grid grid-cols-8 gap-1.5" aria-label={`${presenze} presenze, obiettivo ${obiettivi.presenzeObiettivo}, si può andare oltre`}>
                {caselle.map(c => (
                    <div
                        key={c.n}
                        title={c.obiettivo ? 'Obiettivo' : undefined}
                        className={`relative flex h-9 items-center justify-center rounded-lg text-[12px] font-medium tabular-nums ${c.aperta
                            ? 'border-2 border-dashed border-[#8C8C8C] text-[#F2F2F2]'
                            : c.piena
                                ? (c.euro ? 'bg-[#FF9330] text-[#171717]' : 'bg-[#8C8C8C] text-[#171717]')
                                : (c.euro ? 'border-2 border-[#3D3D3D] text-[#BFBFBF]' : 'border-2 border-[#3D3D3D]')}`}
                    >
                        {c.aperta ? '+' : c.euro ? '€' : ''}
                        {c.obiettivo && <span aria-hidden="true" className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#F2F2F2]" />}
                    </div>
                ))}
            </div>
            <div className="mt-3 text-[12px] text-[#BFBFBF]">
                {presenze >= obiettivi.presenzeObiettivo
                    ? `Obiettivo raggiunto. Si continua: ogni presenza in più vale ${euro(obiettivi.euroPerPresenza)}.`
                    : `Il punto segna l'obiettivo, non il massimo: si può andare oltre.`}
            </div>

            <div className="mt-5 flex items-end justify-between gap-3">
                <div className="text-[14px] leading-snug">
                    Nel salvadanaio
                    <div className="mt-0.5 text-[13px] text-[#BFBFBF]">
                        {sogliaRaggiunta
                            ? `Ogni presenza in più vale ${euro(obiettivi.euroPerPresenza)}.`
                            : `Dalla ${obiettivi.presenzeSogliaEuro + 1}ª presenza, ${euro(obiettivi.euroPerPresenza)} l'una.`}
                    </div>
                </div>
                <div className="text-[32px] font-semibold leading-none tabular-nums">{euro(mia?.euroSettimana ?? 0)}</div>
            </div>

            {mia?.serie && <Serie serie={mia.serie} />}

            <div className="mt-5 flex flex-col gap-1.5">
                <Riga etichetta="Miglior settimana, presenze" valore={mia?.migliorePresenze.valore ?? 0} settimana={mia?.migliorePresenze.settimana ?? null} />
                <Riga etichetta="Miglior settimana, fissati" valore={mia?.miglioreFissati.valore ?? 0} settimana={mia?.miglioreFissati.settimana ?? null} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-1.5">
                <Saldo etichetta="Scintille" valore={mia?.scintille ?? null} />
                <Saldo etichetta="Piume" valore={mia?.piume ?? null} />
            </div>
        </section>
    )
}

/** Serie dei giorni al primo scalino: giorni di fila, oggi, prossima tappa e scudo. */
function Serie({ serie }: { serie: SerieDaMostrare }) {
    const t = testoSerie(serie)
    return (
        <div className="mt-5 rounded-lg bg-[#2E2E2E] px-3 py-3" aria-label={t.titolo}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
                    <Flame
                        className={`h-4 w-4 shrink-0 ${serie.giorni > 0 ? 'text-[#FF9330]' : 'text-[#8C8C8C]'}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />
                    <div className="min-w-0">{t.titolo}</div>
                </div>
                {serie.scudiInTasca > 0 && (
                    <div className="flex shrink-0 items-center gap-1 text-[12px] text-[#BFBFBF]" title={t.scudo ?? undefined}>
                        <Shield className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        Scudo
                    </div>
                )}
            </div>
            <div className={`mt-1 text-[13px] ${serie.oggiFatto ? 'text-[#F2F2F2]' : 'text-[#BFBFBF]'}`}>{t.oggi}</div>
            {t.prossima && <div className="mt-0.5 text-[12px] text-[#BFBFBF]">{t.prossima}</div>}
            {t.scudo && <div className="mt-0.5 text-[12px] text-[#BFBFBF]">{t.scudo}</div>}
        </div>
    )
}

function Riga({ etichetta, valore, settimana }: { etichetta: string; valore: number; settimana: string | null }) {
    const questa = settimana !== null && settimana === chiaveSettimana(new Date())
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#2E2E2E] px-3 py-2.5 text-[14px]">
            <div className="min-w-0">
                <div>{etichetta}</div>
                {settimana && (
                    <div className="text-[12px] text-[#BFBFBF]">{questa ? 'è questa settimana' : etichettaSettimana(settimana)}</div>
                )}
            </div>
            <div className="text-[18px] font-semibold tabular-nums">{valore}</div>
        </div>
    )
}

/** Saldo con "+N" che sale e sparisce quando arrivano Scintille o Piume. */
function Saldo({ etichetta, valore }: { etichetta: string; valore: number | null }) {
    const prima = useRef<number | null>(null)
    const [guadagno, setGuadagno] = useState<{ n: number; chiave: number } | null>(null)

    useEffect(() => {
        if (valore === null) return
        if (prima.current !== null && valore > prima.current) {
            setGuadagno({ n: valore - prima.current, chiave: Date.now() })
        }
        prima.current = valore
    }, [valore])

    useEffect(() => {
        if (!guadagno) return
        const id = setTimeout(() => setGuadagno(null), 1800)
        return () => clearTimeout(id)
    }, [guadagno])

    return (
        <div className="relative rounded-lg bg-[#2E2E2E] px-3 py-2.5">
            <div className="text-[13px] text-[#BFBFBF]">{etichetta}</div>
            <div className="text-[20px] font-semibold tabular-nums">{valore === null ? '' : numeroIt(valore)}</div>
            {guadagno && (
                <div key={guadagno.chiave} aria-hidden="true" className="d-svanisce absolute right-3 top-2 text-[14px] font-semibold text-[#FF9330]">
                    +{numeroIt(guadagno.n)}
                </div>
            )}
        </div>
    )
}
