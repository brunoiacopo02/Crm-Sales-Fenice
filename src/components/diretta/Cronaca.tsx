"use client"

// Cronaca "In diretta": gli ultimi appuntamenti fissati oggi dalla squadra,
// con l'ora, il nome vero e il giorno dell'appuntamento. Niente dati del lead.
// L'ultimo è in arancione solo se è di pochi minuti fa (orologio lato client).

import type { CronacaVoce } from "@/lib/diretta/live"
import { fraseCronaca, oraBreve } from "@/lib/diretta/home"
import { useOrologio } from "./useOrologio"

const RECENTE_MS = 10 * 60_000

export function Cronaca({ voci, mioId, caricato }: { voci: CronacaVoce[]; mioId: string | null; caricato: boolean }) {
    const adesso = useOrologio(30_000)

    return (
        <section aria-label="In diretta dalla squadra" className="flex flex-col">
            <h2 className="mb-3 text-[16px] font-semibold text-[#F2F2F2]">In diretta</h2>
            {!caricato ? (
                <div className="h-16" />
            ) : voci.length === 0 ? (
                <div className="text-[14px] leading-relaxed text-[#BFBFBF]">Il primo appuntamento di oggi apre la cronaca.</div>
            ) : (
                <ol className="flex flex-col">
                    {voci.map((v, i) => {
                        const at = new Date(v.at)
                        const accesa = i === 0 && !!adesso && adesso.getTime() - at.getTime() < RECENTE_MS
                        return (
                            <li
                                key={v.id}
                                className={accesa
                                    ? 'rounded-lg bg-[#FF9330] px-4 py-3.5 text-[#171717]'
                                    : `px-4 py-3.5 ${i < voci.length - 1 ? 'border-b-2 border-[#262626]' : ''}`}
                            >
                                <div className={`text-[13px] tabular-nums ${accesa ? '' : 'text-[#A6A6A6]'}`}>{oraBreve(at)}</div>
                                <div className={`mt-0.5 text-[15px] ${accesa ? 'font-semibold' : 'text-[#F2F2F2]'}`}>
                                    {fraseCronaca(v.nome, v.userId === mioId, v.giorno)}
                                </div>
                            </li>
                        )
                    })}
                </ol>
            )}
        </section>
    )
}
