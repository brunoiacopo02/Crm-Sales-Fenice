import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { LeadLancioClient } from "./LeadLancioClient"

export default async function LeadLancioPage({
    searchParams,
}: { searchParams: Promise<{ venditore?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["VENDITORE", "ADMIN", "MANAGER"].includes(role)) redirect("/")

    // Staff: ?venditore=<id> per guardare la sezione di un venditore.
    const sp = await searchParams
    const sellerId = role === "VENDITORE" ? user.id : (sp.venditore || user.id)

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <LeadLancioClient sellerId={sellerId} />
        </div>
    )
}
