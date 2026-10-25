"use client"

// Scheda personale della home Diretta: la vede solo chi è collegato.
// Binario delle presenze della settimana (le prime caselle sono la base,
// dalla soglia in poi ogni presenza vale euro), salvadanaio, miglior
// settimana e saldo di Scintille e Piume.

import { useEffect, useRef, useState } from "react"
import type { GamificationTargets } from "@/lib/diretta/config"
import type { DirettaMia } from "@/lib/diretta/live"
import { binarioPresenze, chiaveSettimana, etichettaSettimana, euro } from "@/lib/diretta/home"
import { numeroIt } from "@/lib/diretta/formato"

export function SchedaPersonale({ mia, obiettivi }: { mia: DirettaMia | null; obiettivi: GamificationTargets }) {
    const presenze = mia?.presenzeSettimana ?? 0
    const caselle = binarioPresenze(presenze, obiettivi)
    const sogliaRaggiunta = presenze >= obiettivi.presenzeSogliaEuro

    return (
        <section aria-label="La tua settimana" className="rounded-2xl bg-[#262626] p-5 text-[#F2F2F2]">
            <h2 className="text-[16px] font-semibold">La tua settimana</h2>
            <div className="mt-0.5 text-[13px] text-[#BFBFBF]">La vedi solo tu.</div>

            <div className="mt-5 flex items-baseline justify-between gap-3 text-[14px]">
                <span>Presenze</span>
                <span className="tabular-nums"><span className="text-[20px] font-semibold">{presenze}</span> su {obiettivi.presenzeObiettivo}</span>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5" aria-label={`${presenze} presenze su ${obiettivi.presenzeObiettivo}`}>
                {caselle.map(c => (
                    <div
                        key={c.n}
                        className={`flex h-9 items-center justify-center rounded-lg text-[12px] font-medium tabular-nums ${c.piena
                            ? (c.euro ? 'bg-[#FF9330] text-[#171717]' : 'bg-[#8C8C8C] text-[#171717]')
                            : (c.euro ? 'border-2 border-[#3D3D3D] text-[#BFBFBF]' : 'border-2 border-[#3D3D3D]')}`}
                    >
                        {c.euro ? euro(obiettivi.euroPerPresenza) : ''}
                    </div>
                ))}
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
