import type { AtRiskRow } from "@/lib/gestionale/metrics"
import { formatEur, formatDate } from "./format"

const BADGE: Record<string, string> = {
    Avvocato: "bg-red-100 text-red-800",
    Recupero: "bg-orange-100 text-orange-800",
    Sollecito: "bg-amber-100 text-amber-800",
    "Stand-by": "bg-ash-100 text-ash-700",
}

export function AtRiskTable({ rows, showSeller }: { rows: AtRiskRow[]; showSeller: boolean }) {
    if (rows.length === 0) return <div className="text-sm text-ash-500">Nessun contratto a rischio.</div>
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="border-b border-ash-200 text-left text-xs uppercase text-ash-500">
                        <th className="py-2 pr-4">Cliente</th>
                        <th className="py-2 pr-4">Telefono</th>
                        {showSeller && <th className="py-2 pr-4">Venditore</th>}
                        <th className="py-2 pr-4">Stato</th>
                        <th className="py-2 pr-4">Firma</th>
                        <th className="py-2 pr-4 text-right">Rate scadute</th>
                        <th className="py-2 pr-4 text-right">Scaduto</th>
                        <th className="py-2 text-right">Residuo</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.id} className="border-b border-ash-100">
                            <td className="py-2 pr-4 text-ash-800">{[r.clienteNome, r.clienteCognome].filter(Boolean).join(" ") || "—"}</td>
                            <td className="py-2 pr-4 text-ash-600">{r.clienteTelefono ?? "—"}</td>
                            {showSeller && <td className="py-2 pr-4 text-ash-600">{r.venditoreCode ?? "—"}</td>}
                            <td className="py-2 pr-4">
                                <div className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${BADGE[r.statoPagamento ?? ""] ?? "bg-ash-100 text-ash-700"}`}>
                                    {r.statoPagamento ?? "—"}
                                </div>
                            </td>
                            <td className="py-2 pr-4 text-ash-600">{formatDate(r.dataFirma)}</td>
                            <td className="py-2 pr-4 text-right">
                                {r.rateScadute}{r.giorniDallaPiuVecchia !== null ? ` (da ${r.giorniDallaPiuVecchia} gg)` : ""}
                            </td>
                            <td className="py-2 pr-4 text-right font-medium text-red-700">{formatEur(r.scadutoCents)}</td>
                            <td className="py-2 text-right">{formatEur(r.residuoCents)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
