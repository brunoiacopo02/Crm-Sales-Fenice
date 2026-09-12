import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getCalendarWeek } from "@/app/actions/salesCalendarActions"
import { MioCalendarioClient } from "./MioCalendarioClient"

export default async function MioCalendarioPage({
    searchParams,
}: { searchParams: Promise<{ venditore?: string; settimana?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["VENDITORE", "ADMIN", "MANAGER", "CONFERME"].includes(role)) redirect("/")

    const sp = await searchParams
    const initial = await getCalendarWeek({ weekStartIso: sp.settimana, salesUserId: sp.venditore })

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <MioCalendarioClient initial={initial} role={role} />
        </div>
    )
}
