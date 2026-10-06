import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getIaVocaleLeads } from "@/app/actions/iaVocaleActions"
import { IaVocaleClient } from "./IaVocaleClient"

export default async function IaVocalePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["ADMIN", "MANAGER"].includes(role)) redirect("/")

    const righe = await getIaVocaleLeads()
    return (
        <div className="min-h-screen p-4 sm:p-6">
            <IaVocaleClient righe={righe} />
        </div>
    )
}
