import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ConfermeKpiBoard } from "@/components/ConfermeKpiBoard"

export default async function ConfermeKpiPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect("/")
    }

    const { role } = user.user_metadata || {}

    if (role !== "MANAGER" && role !== "ADMIN" && role !== "CONFERME") {
        redirect("/accesso-negato")
    }

    return (
        <main className="min-h-screen bg-gray-50 flex flex-col p-4 md:p-8 overflow-y-auto">
            <ConfermeKpiBoard currentUser={{ id: user.id, role, name: user.user_metadata?.name }} />
        </main>
    )
}
