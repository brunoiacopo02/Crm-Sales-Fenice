import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getDirettaAdmin } from "@/app/actions/direttaActions"
import { DirettaAdminClient } from "./DirettaAdminClient"

export const dynamic = "force-dynamic"

// Pagina admin della Diretta (PO 25/10/2026): interruttori per ruolo e
// obiettivi della nuova gamification. Solo ADMIN.
export default async function DirettaAdminPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")

    const stato = await getDirettaAdmin()
    if (!stato) redirect("/unauthorized")

    return (
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
            <div>
                <h1 className="text-2xl font-semibold text-brand-charcoal">Diretta</h1>
                <p className="mt-1 text-sm text-ash-500">
                    Interruttori della nuova grafica e obiettivi della gamification. Le modifiche arrivano a tutti entro un minuto.
                </p>
            </div>
            <DirettaAdminClient flags={stato.flags} obiettivi={stato.obiettivi} />
        </div>
    )
}
