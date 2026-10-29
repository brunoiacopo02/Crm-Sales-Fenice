// Guadagno del mese di UN venditore (PO 29/10/2026), vicino agli incassi.
// Firmato e Incassato restano due numeri distinti: l'obiettivo si misura sul
// firmato, la percentuale si applica all'incassato senza IVA.

import type { GuadagnoVenditore } from "@/lib/venditore/obiettiviDb"
import { formatEur } from "./format"

const euro = (eur: number) => formatEur(Math.round(eur * 100))

function Scenario({ titolo, s, preso, attivo }: { titolo: string; s: { cents: number; mancaEur: number } | null; preso: boolean; attivo: boolean }) {
    return (
        <div className={`rounded-lg p-2 ${attivo ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}>
            <div className="text-xs uppercase text-ash-500">{titolo}</div>
            {s ? (
                <>
                    <div className={`mt-1 text-lg font-bold ${attivo ? 'text-emerald-700' : 'text-ash-500'}`}>{formatEur(s.cents)}</div>
                    <div className="text-xs text-ash-500">{preso ? 'raggiunto' : `ti mancano ${euro(s.mancaEur)} di firmato`}</div>
                </>
            ) : (
                <div className="mt-1 text-sm text-ash-400">nessun obiettivo</div>
            )}
        </div>
    )
}

export function GuadagnoVenditoreCard({ g }: { g: GuadagnoVenditore }) {
    const { guadagno: gu } = g
    return (
        <div className="space-y-3 rounded-xl border border-ash-200 bg-white p-4">
            <h2 className="font-semibold text-ash-800">Il tuo guadagno del mese</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div className="p-2">
                    <div className="text-xs uppercase text-ash-500">Firmato</div>
                    <div className="mt-1 text-lg font-bold text-ash-800">{euro(g.firmatoEur)}</div>
                    <div className="text-xs text-ash-500">contratti firmati nel mese</div>
                </div>
                <div className="p-2">
                    <div className="text-xs uppercase text-ash-500">Incassato</div>
                    <div className="mt-1 text-lg font-bold text-ash-800">{formatEur(g.incassatoCents)}</div>
                    <div className="text-xs text-ash-500">{g.incassoProvvisorio ? "provvisorio, in attesa dell'amministrazione" : `${formatEur(gu.senzaIvaCents)} senza IVA`}</div>
                </div>
                <div className={`rounded-lg p-2 ${gu.raggiunto === 0 ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}>
                    <div className="text-xs uppercase text-ash-500">Commissione attuale ({gu.pct}%)</div>
                    <div className="mt-1 text-lg font-bold text-ash-900">{formatEur(gu.attualeCents)}</div>
                </div>
                <Scenario titolo="Se raggiungi il 1° obiettivo (11%)" s={gu.se1} preso={gu.raggiunto >= 1} attivo={gu.raggiunto === 1} />
                <Scenario titolo="Se raggiungi il 2° obiettivo (12%)" s={gu.se2} preso={gu.raggiunto >= 2} attivo={gu.raggiunto === 2} />
            </div>
            <div className="text-xs text-ash-500">
                Gli obiettivi si misurano sul firmato del mese. La commissione è l&apos;incassato del mese senza IVA (÷ 1,22) × 10%: 11% con il 1° obiettivo, 12% con il 2°, su tutto l&apos;incassato. Le multe sono a parte.
            </div>
        </div>
    )
}
