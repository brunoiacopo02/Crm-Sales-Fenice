// Salvadanaio del mese nella scheda personale del GDO (PO 09/11/2026): i bonus
// in euro delle settimane chiuse del mese (presenze + classifica) e la
// settimana in corso, provvisoria. Solo visualizzazione: i conti sono in
// src/lib/economy/premiMese.ts, letti sul server al caricamento della pagina.

import type { Salvadanaio, SettimanaSalvadanaio } from "@/lib/economy/premiMese"
import { dateSettimana, nomeMese } from "@/lib/economy/premiMese"
import { euroIt } from "@/lib/diretta/formato"

const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function dettaglio(s: SettimanaSalvadanaio): string {
    const presenze = `${s.presenze} ${s.presenze === 1 ? 'presenza' : 'presenze'}: ${euroIt(s.euroPresenze)}`
    const classifica = s.posizione !== null ? `${s.posizione}° posto: ${euroIt(s.euroClassifica)}` : 'fuori dal podio'
    return `${presenze} · ${classifica}`
}

/**
 * `euroPresenzeOra`: il bonus presenze della settimana appena letto dalla
 * Diretta (aggiornato ogni 25 s), così non si vedono due numeri diversi.
 */
export function SalvadanaioMese({ s, euroPresenzeOra }: { s: Salvadanaio; euroPresenzeOra: number | null }) {
    const mese = nomeMese(s.mese)
    const c = s.inCorso
    const presenzeOra = c ? (euroPresenzeOra ?? c.euroPresenze) : 0

    return (
        <div className="mt-4 rounded-lg bg-[#2E2E2E] px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-[14px] font-semibold">{maiuscola(mese)}, finora</div>
                <div className="text-[22px] font-semibold leading-none tabular-nums">{euroIt(s.euroMese)}</div>
            </div>
            <div className="mt-0.5 text-[12px] text-[#BFBFBF]">Bonus delle settimane chiuse: presenze e classifica.</div>

            {s.settimane.length === 0 ? (
                <div className="mt-2 text-[13px] text-[#BFBFBF]">
                    {c ? `La prima settimana di ${mese} si chiude sabato.` : `Le settimane di ${mese} non sono ancora iniziate.`}
                </div>
            ) : (
                <ul className="mt-2">
                    {s.settimane.map(w => (
                        <li key={w.lunedi} className="border-t-2 border-[#3D3D3D] py-1.5 first:border-t-0">
                            <div className="flex items-baseline justify-between gap-3 text-[13px]">
                                <span>{dateSettimana(w.lunedi, w.sabato)}</span>
                                <span className="font-semibold tabular-nums">{euroIt(w.euro)}</span>
                            </div>
                            <div className="text-[12px] text-[#BFBFBF]">{dettaglio(w)}</div>
                        </li>
                    ))}
                </ul>
            )}

            {c && (
                <div className="mt-2 border-t-2 border-[#3D3D3D] pt-2">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span>Questa settimana, in maturazione</span>
                        <span className="font-semibold tabular-nums">{euroIt(presenzeOra)}</span>
                    </div>
                    <div className="text-[12px] text-[#BFBFBF]">
                        {c.posizione !== null
                            ? `Classifica provvisoria: ora sei ${c.posizione}°, sabato varrebbe ${euroIt(c.euroClassifica)} in più.`
                            : 'Classifica provvisoria: si decide sabato sera.'}
                    </div>
                </div>
            )}
        </div>
    )
}
