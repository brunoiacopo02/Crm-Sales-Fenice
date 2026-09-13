import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getCalendarSupervision } from "@/app/actions/salesCalendarAdminActions"
import { calendarRuleState } from "@/lib/venditore/calendarRules"
import { CalendariVenditoriClient } from "./CalendariVenditoriClient"

export default async function CalendariVenditoriPage({
    searchParams,
}: { searchParams: Promise<{ settimana?: string; mese?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["ADMIN", "MANAGER", "CONFERME"].includes(role)) redirect("/")

    const sp = await searchParams
    const initial = await getCalendarSupervision(sp.settimana, sp.mese)

    // Le env stanno solo sul server: lo stato della regola si legge qui e
    // viaggia come prop. Una scheda Multe vuota perché nessuno è stato multato
    // e una vuota perché la regola non è mai stata accesa si assomigliano
    // troppo, e la seconda sembra un guasto (stessa cura del Monitor Vendite).
    const ruleState = calendarRuleState()

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <CalendariVenditoriClient initial={initial} role={role} ruleState={ruleState} />
        </div>
    )
}
