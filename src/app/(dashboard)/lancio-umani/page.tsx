import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getLancioUmani } from "@/app/actions/lancioUmaniActions"
import { LancioUmaniClient } from "./LancioUmaniClient"

export default async function LancioUmaniPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["GDO", "ADMIN", "MANAGER"].includes(role)) redirect("/")

    // Il GDO riceve solo i suoi lead (lo forza l'azione), lo staff tutti.
    const dati = await getLancioUmani()
    return (
        <div className="min-h-screen p-4 sm:p-6">
            <LancioUmaniClient dati={dati} isStaff={role !== "GDO"} />
        </div>
    )
}
