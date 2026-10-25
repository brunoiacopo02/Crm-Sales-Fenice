import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ConfermeKpiBoard } from "@/components/ConfermeKpiBoard"
import { isDirettaOn } from "@/lib/diretta/settings"
import { VesteAllineata } from "@/components/diretta/VesteAllineata"

export default async function ConfermeKpiPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect("/")
    }

    const { role } = user.user_metadata || {}

    if (role !== "MANAGER" && role !== "ADMIN" && role !== "CONFERME") {
        redirect("/unauthorized")
    }

    // Con la Diretta accesa le Conferme hanno il bonus nuovo nella colonna della
    // loro pagina (PO 25/10/2026): il vecchio a scaglioni (30/38 chiusure,
    // 145/290 euro) qui lo direbbe diverso. Manager e admin continuano a vederlo.
    const hideOldBonus = role === "CONFERME" && await isDirettaOn("CONFERME")

    return (
        <main className="min-h-screen bg-ash-50 flex flex-col p-4 md:p-8 overflow-y-auto">
            {/* Stessa lettura dell'interruttore della cornice: se cambia a sessione aperta si riallinea. */}
            <VesteAllineata diretta={hideOldBonus} />
            <ConfermeKpiBoard currentUser={{ id: user.id, role, name: user.user_metadata?.name }} hideOldBonus={hideOldBonus} />
        </main>
    )
}
