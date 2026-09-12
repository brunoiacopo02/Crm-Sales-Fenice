import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getCalendarSupervision } from "@/app/actions/salesCalendarAdminActions"
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

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <CalendariVenditoriClient initial={initial} role={role} />
        </div>
    )
}
