import { format } from "date-fns"
import { Rocket } from "lucide-react"
import { isCallNowHandoff, isLeadLancio, lancioBotRisposte, lancioSceltaLabel, type LancioConfermeFields } from "@/lib/lancio/conferme"

type LancioCardLead = LancioConfermeFields & {
    lancioBotInfo?: unknown
    lancioSceltaAt?: Date | string | null
    salespersonAssigned?: string | null
}

/**
 * Dal bot - lancio (spec 2026-09-14 par. 4.5): la scelta fatta in chat e le
 * risposte di riscaldamento. Condivisa da ConfermeDrawer e VenditoreDrawer.
 */
export function LancioBotInfoCard({ lead }: { lead: LancioCardLead }) {
    if (!isLeadLancio(lead)) return null
    const risposte = lancioBotRisposte(lead.lancioBotInfo)
    const handoff = isCallNowHandoff(lead)
    return (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
            <div className="flex justify-between items-start mb-2 gap-2">
                <div className="text-xs font-bold text-amber-900 bg-amber-100 px-2 py-1 rounded-md flex items-center gap-1.5">
                    <Rocket className="w-3.5 h-3.5" /> Dal bot – lancio
                </div>
                {lead.lancioSceltaAt && (
                    <div className="text-[11px] font-medium text-amber-600 uppercase tracking-wider shrink-0">
                        {format(new Date(lead.lancioSceltaAt), "dd/MM/yy HH:mm")}
                    </div>
                )}
            </div>
            <p className="text-sm font-semibold text-amber-950">{lancioSceltaLabel(lead.lancioScelta, handoff)}</p>
            {lead.lancioScelta === 'app_mattina' && lead.salespersonAssigned && (
                <p className="text-xs text-amber-800 mt-1">Venditore: {lead.salespersonAssigned}</p>
            )}
            {risposte.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                    {risposte.map((r, i) => (
                        <li key={i} className="text-sm text-amber-950 bg-white/70 rounded-md px-2.5 py-1.5 border border-amber-100">💬 {r}</li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-xs italic text-amber-700">Nessuna risposta di riscaldamento registrata dal bot.</p>
            )}
        </div>
    )
}
