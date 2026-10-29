// Guadagno del mese di UN venditore (PO 29/10/2026), vicino agli incassi.
// Firmato e Incassato restano due numeri distinti: l'obiettivo si misura sul
// firmato, la percentuale si applica all'incassato senza IVA.

import type { GuadagnoVenditore } from "@/lib/venditore/obiettiviDb"
import { PCT_BASE } from "@/lib/venditore/obiettivi"
import { formatEur } from "./format"

const euro = (eur: number) => formatEur(Math.round(eur * 100))

export function GuadagnoVenditoreCard({ g }: { g: GuadagnoVenditore }) {
    const { guadagno: gu, obiettivi: o } = g
    return (
        <div className="space-y-3 rounded-xl border border-ash-200 bg-white p-4">
            <h2 className="font-semibold text-ash-800">Il tuo guadagno del mese</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div>
                    <div className="text-xs uppercase text-ash-500">Firmato</div>
                    <div className="mt-1 text-lg font-bold text-ash-800">{euro(g.firmatoEur)}</div>
                    <div className="text-xs text-ash-500">contratti firmati nel mese</div>
                </div>
                <div>
                    <div className="text-xs uppercase text-ash-500">Incassato</div>
                    <div className="mt-1 text-lg font-bold text-ash-800">{formatEur(g.incassatoCents)}</div>
                    <div className="text-xs text-ash-500">{g.incassoProvvisorio ? "provvisorio, in attesa dell'amministrazione" : "soldi entrati nel mese"}</div>
                </div>
                <div>
                    <div className="text-xs uppercase text-ash-500">Senza bonus ({PCT_BASE}%)</div>
                    <div className="mt-1 text-lg font-bold text-ash-800">{formatEur(gu.baseCents)}</div>
                </div>
                <div>
                    <div className="text-xs uppercase text-ash-500">Con il bonus raggiunto ({gu.pct}%)</div>
                    <div className="mt-1 text-lg font-bold text-emerald-700">{formatEur(gu.attualeCents)}</div>
                    {gu.bonusCents > 0 && <div className="text-xs text-emerald-700">+{formatEur(gu.bonusCents)} di bonus</div>}
                </div>
            </div>
            <div className="space-y-1 text-sm text-ash-600">
                {o.target1Eur != null ? (
                    <div>
                        Obiettivi sul firmato: 1° {euro(o.target1Eur)} (11%)
                        {o.target2Eur != null && <> · 2° {euro(o.target2Eur)} (12%)</>}
                    </div>
                ) : (
                    <div>Nessun obiettivo impostato per questo mese.</div>
                )}
                {gu.prossimo && (
                    <div className="font-medium text-ash-800">
                        Ti mancano {euro(Math.max(0, gu.prossimo.mancaEur))} di firmato per il {gu.prossimo.numero}° obiettivo:
                        con questo incassato guadagneresti {formatEur(gu.prossimo.guadagnoCents)} ({gu.prossimo.pct}%).
                    </div>
                )}
                {!gu.prossimo && o.target2Eur != null && gu.pct === 12 && (
                    <div className="font-medium text-emerald-700">Hai preso il 2° obiettivo: 12% su tutto l&apos;incassato del mese.</div>
                )}
            </div>
            <div className="text-xs text-ash-500">
                Guadagno = incassato del mese senza IVA (÷ 1,22) × percentuale. La percentuale è 10%, 11% con il 1° obiettivo, 12% con il 2°, su tutto l&apos;incassato del mese. Le multe sono a parte.
            </div>
        </div>
    )
}
