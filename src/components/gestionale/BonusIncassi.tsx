// Bonus sugli incassi dello stesso mese (PO 12/11/2026): a che punto e' il
// venditore e quali contratti del mese restano da saldare. Solo lettura: la
// commissione mostrata nelle altre card non cambia.
// Regole: src/lib/gestionale/bonusIncassi.ts.

import { formatBonus, formatPct, fraseBonusIncassi, scaglionePreso, type BonusIncassi, type ContrattoDaSaldare } from "@/lib/gestionale/bonusIncassi"
import { formatEur, formatDate } from "./format"

const BADGE: Record<string, string> = {
    Avvocato: "bg-red-100 text-red-800",
    Recupero: "bg-orange-100 text-orange-800",
    Sollecito: "bg-amber-100 text-amber-800",
}

const contratti = (n: number) => (n === 1 ? "1 contratto" : `${n} contratti`)

export function DaSaldareTable({ rows }: { rows: ContrattoDaSaldare[] }) {
    if (rows.length === 0) return <div className="text-sm text-ash-500">Tutti i contratti firmati nel mese sono stati pagati per intero.</div>
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="border-b border-ash-200 text-left text-xs uppercase text-ash-500">
                        <th className="py-2 pr-4">Cliente</th>
                        <th className="py-2 pr-4">Firma</th>
                        <th className="py-2 pr-4 text-right">Importo</th>
                        <th className="py-2 pr-4 text-right">Incassato</th>
                        <th className="py-2 pr-4 text-right">Residuo</th>
                        <th className="py-2">Pagamento</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.id} className="border-b border-ash-100">
                            <td className="py-2 pr-4 text-ash-800">{r.cliente}</td>
                            <td className="whitespace-nowrap py-2 pr-4 text-ash-600">{formatDate(r.dataFirma)}</td>
                            <td className="whitespace-nowrap py-2 pr-4 text-right">{formatEur(r.importoCents)}</td>
                            <td className="whitespace-nowrap py-2 pr-4 text-right text-ash-600">{formatEur(r.incassatoCents)}</td>
                            <td className={`whitespace-nowrap py-2 pr-4 text-right font-medium ${r.residuoCents > 0 ? "text-red-700" : "text-ash-500"}`}>{formatEur(r.residuoCents)}</td>
                            <td className="py-2">
                                {r.saldatoIl ? (
                                    <div className="inline-block whitespace-nowrap rounded bg-ash-100 px-2 py-0.5 text-xs font-medium text-ash-700">
                                        Saldato il {formatDate(r.saldatoIl)}, dopo il mese
                                    </div>
                                ) : (
                                    <div className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${BADGE[r.statoPagamento ?? ""] ?? "bg-ash-100 text-ash-700"}`}>
                                        {r.statoPagamento ?? "—"}
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export function BonusIncassiCard({ b, meseChiuso }: { b: BonusIncassi; meseChiuso: boolean }) {
    const pct = b.pctEuro ?? 0
    const attivo = b.scaglioni.length > 0
    return (
        <div className="space-y-4 rounded-xl border border-ash-200 bg-white p-4">
            <h2 className="font-semibold text-ash-800">Bonus incassi del mese</h2>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="shrink-0 sm:w-56">
                    <div className={`text-4xl font-bold ${b.raggiunto ? "text-emerald-700" : "text-ash-800"}`}>{formatPct(b.pctEuro)}</div>
                    <div className="mt-1 text-sm text-ash-600">
                        {formatEur(b.incassatoMeseCents)} incassati nel mese su {formatEur(b.firmatoCents)} firmati
                    </div>
                    <div className="mt-0.5 text-xs text-ash-500">
                        {b.pagati === 1 ? "1 contratto saldato" : `${b.pagati} contratti saldati`} su {b.firmati === 1 ? "1 firmato" : `${b.firmati} firmati`}
                    </div>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                    <div
                        className="relative h-3 rounded-full bg-ash-100"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.floor(pct)}
                        aria-label="Incassato nel mese sul totale del firmato"
                    >
                        <div className={`h-3 rounded-full ${b.raggiunto ? "bg-emerald-500" : "bg-brand-orange"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        {b.scaglioni.map(s => (
                            <div key={s.minPct} className="absolute -top-1 h-5 w-0.5 bg-ash-500" style={{ left: `${s.minPct}%` }} />
                        ))}
                    </div>
                    {attivo && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {b.scaglioni.map(s => {
                                const preso = scaglionePreso(s, b.incassatoMeseCents, b.firmatoCents)
                                return (
                                    <div key={s.minPct} className={`rounded-md px-2 py-1 ${preso ? "bg-emerald-50 font-semibold text-emerald-700 ring-1 ring-emerald-300" : "bg-ash-50 text-ash-600"}`}>
                                        dall&apos;{s.minPct}% → {formatBonus(s.bonusPct)}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                    <div className="text-sm font-medium text-ash-800">{fraseBonusIncassi(b, meseChiuso)}</div>
                </div>
            </div>

            {b.firmati > 0 && (
                <div>
                    <h3 className="mb-2 text-sm font-semibold text-ash-700">
                        {b.daSaldare.length === 0 ? "Contratti del mese da saldare" : `Contratti del mese non ancora pagati per intero (${b.daSaldare.length})`}
                    </h3>
                    <DaSaldareTable rows={b.daSaldare} />
                </div>
            )}

            <div className="text-xs text-ash-500">
                La percentuale è sugli euro: quanto è stato incassato entro la fine del mese sui contratti che hai firmato nel mese, diviso l&apos;importo di tutti i contratti che hai firmato nel mese. Conta anche l&apos;acconto di un contratto non ancora saldato; un contratto finanziato e saldato conta per tutto il suo importo.
                {b.standBy > 0 && ` ${contratti(b.standBy)} in stand-by: ${b.standBy === 1 ? "non conta finché non viene convalidato" : "non contano finché non vengono convalidati"}.`}
            </div>
        </div>
    )
}
