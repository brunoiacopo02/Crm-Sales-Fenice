import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { isConfermeTl } from "@/lib/confermeTl"
import { getVenditoriMonitor } from "@/app/actions/venditoriMonitorActions"
import { MonitorVenditeClient } from "./MonitorVenditeClient"

export default async function MonitorVenditePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    // Il TL del team Conferme (Alberto, gating per email) può consultare il monitor
    // (swap PO 2026-07-17: sostituisce il suo accesso a Performance Venditori).
    const isTlConfermeViewer = role === "CONFERME" && isConfermeTl(user?.email)
    if (!user || (!["ADMIN", "MANAGER"].includes(role) && !isTlConfermeViewer)) {
        redirect("/")
    }

    // Default: finestra da oggi a +30 giorni (appuntamenti + follow-up
    // prossimi). I follow-up scaduti li includiamo sempre a prescindere.
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 30)
    end.setHours(23, 59, 59, 999)

    const initial = await getVenditoriMonitor({
        startDate: start,
        endDate: end,
        venditoreIds: [],
    })

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <MonitorVenditeClient
                initialData={initial}
                initialStart={start.toISOString()}
                initialEnd={end.toISOString()}
            />
        </div>
    )
}
