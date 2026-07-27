import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getConfermeTlOverview } from "@/app/actions/confermeKpiActions"
import { isConfermeTl } from "@/lib/confermeTl"
import { toRomeDateStr } from "@/lib/dateUtils"
import { PanoramicaTlClient } from "./PanoramicaTlClient"

export const dynamic = "force-dynamic"

export default async function PanoramicaTlConfermePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    const authorized = !!user && (
        ["ADMIN", "MANAGER"].includes(role || "")
        || (role === "CONFERME" && isConfermeTl(user.email))
    )
    if (!authorized) redirect("/")

    const currentYearMonth = toRomeDateStr(new Date()).slice(0, 7)
    const data = await getConfermeTlOverview(currentYearMonth)

    return (
        <div className="mx-auto max-w-7xl">
            <PanoramicaTlClient initialData={data} currentYearMonth={currentYearMonth} />
        </div>
    )
}
