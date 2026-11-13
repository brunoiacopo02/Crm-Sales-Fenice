"use client"

// Performance venditori → "Incassi e commissioni" (PO 12/11/2026), solo
// ADMIN/MANAGER: a che punto e' ogni venditore col bonus sugli incassi dello
// stesso mese. Stessa lettura della card in "I miei incassi"
// (src/lib/gestionale/bonusIncassi.ts). Solo lettura: le commissioni della
// tabella sopra non cambiano.

import { Fragment, useEffect, useState } from "react"
import { getBonusIncassiVenditori } from "@/app/actions/obiettiviVenditoriActions"
import type { BonusIncassiVenditore } from "@/lib/gestionale/bonusIncassiDb"
import { formatBonus, formatPct, scaglioniBonusIncassi } from "@/lib/gestionale/bonusIncassi"
import { DaSaldareTable } from "@/components/gestionale/BonusIncassi"
import { formatEur } from "@/components/gestionale/format"
import { ChevronDown, ChevronRight } from "lucide-react"

export function BonusIncassiVenditoriTable({ ym }: { ym: string }) {
    // Il risultato porta con se' il mese: cambiando mese si torna a "Caricamento…" senza azzerare lo stato nell'effetto.
    const [esito, setEsito] = useState<{ ym: string; righe: BonusIncassiVenditore[] | null; errore: string | null } | null>(null)
    const [aperti, setAperti] = useState<Set<string>>(new Set())

    useEffect(() => {
        let vivo = true
        getBonusIncassiVenditori(ym)
            .then(r => { if (vivo) setEsito({ ym, righe: r, errore: null }) })
            .catch(e => { console.error(e); if (vivo) setEsito({ ym, righe: null, errore: "Impossibile caricare il bonus incassi." }) })
        return () => { vivo = false }
    }, [ym])

    const righe = esito?.ym === ym ? esito.righe : null
    const errore = esito?.ym === ym ? esito.errore : null

    const apri = (id: string) => setAperti(p => {
        const n = new Set(p)
        if (n.has(id)) n.delete(id); else n.add(id)
        return n
    })

    const scaglioni = scaglioniBonusIncassi(ym)

    return (
        <div className="space-y-3">
            <div>
                <h2 className="font-semibold text-ash-800">Bonus incassi del mese</h2>
                <div className="max-w-3xl text-xs text-ash-500">
                    Importo dei contratti <b>firmati</b> nel mese (dal gestionale, stand-by esclusi) e quanta parte viene da contratti <b>pagati per intero</b> entro la fine dello stesso mese. La percentuale è sugli euro, non sul numero dei contratti.{" "}
                    {scaglioni.length === 0
                        ? "In questo mese il bonus non c'era ancora (parte da ottobre 2026)."
                        : `Soglie: ${scaglioni.map(s => `dall'${s.minPct}% ${formatBonus(s.bonusPct)}`).join(", ")}.`}
                    {" "}È solo una lettura: le commissioni qui sopra non lo comprendono.
                </div>
            </div>

            {errore && <div className="text-sm text-ember-600">{errore}</div>}
            {!righe && !errore && <div className="py-8 text-center text-gray-400">Caricamento…</div>}

            {righe && (
                <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white">
                    <table className="min-w-full divide-y divide-ash-200/60 text-left text-sm">
                        <thead className="bg-ash-50 text-xs font-medium uppercase tracking-wider text-ash-500">
                            <tr>
                                <th className="px-3 py-2">Venditore</th>
                                <th className="px-3 py-2 text-right">Firmato</th>
                                <th className="px-3 py-2 text-right">Pagato nel mese</th>
                                <th className="px-3 py-2 text-right">Percentuale</th>
                                <th className="px-3 py-2 text-right">Contratti</th>
                                <th className="px-3 py-2">Scaglione</th>
                                <th className="px-3 py-2">Allo scaglione dopo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100/60">
                            {righe.map(r => {
                                const b = r.bonus
                                const aperto = aperti.has(r.salesUserId)
                                return (
                                    <Fragment key={r.salesUserId}>
                                        <tr className="align-top">
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <button type="button" onClick={() => apri(r.salesUserId)} className="flex items-start gap-1 text-left">
                                                    {aperto ? <ChevronDown className="mt-0.5 h-4 w-4 text-ash-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-ash-400" />}
                                                    <div>
                                                        <div className="font-medium text-ash-800">{r.nome}</div>
                                                        <div className="text-[10px] text-ash-400">
                                                            {r.codice} · {b.daSaldare.length} da saldare{b.standBy > 0 ? ` · ${b.standBy} in stand-by` : ""}
                                                        </div>
                                                    </div>
                                                </button>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">{formatEur(b.firmatoCents)}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">{formatEur(b.pagatoCents)}</td>
                                            <td className={`whitespace-nowrap px-3 py-2 text-right font-bold ${b.raggiunto ? "text-emerald-700" : "text-ash-900"}`}>{formatPct(b.pctEuro)}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-ash-500">{b.firmati > 0 ? `${b.pagati} su ${b.firmati}` : "—"}</td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                {b.raggiunto
                                                    ? <div className="inline-block rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-300">{formatBonus(b.raggiunto.bonusPct)}</div>
                                                    : <div className="text-ash-500">{b.firmati === 0 || scaglioni.length === 0 ? "—" : "nessuno"}</div>}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-ash-700">
                                                {b.prossimo
                                                    ? `mancano ${formatEur(b.prossimo.mancanoCents)} pagati per il ${formatBonus(b.prossimo.scaglione.bonusPct)}`
                                                    : b.raggiunto ? "massimo raggiunto" : "—"}
                                            </td>
                                        </tr>
                                        {aperto && (
                                            <tr className="bg-ash-50/60">
                                                <td colSpan={7} className="px-6 py-3">
                                                    {b.firmati === 0
                                                        ? <div className="text-sm text-ash-500">Nessun contratto firmato nel mese.</div>
                                                        : <DaSaldareTable rows={b.daSaldare} />}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
