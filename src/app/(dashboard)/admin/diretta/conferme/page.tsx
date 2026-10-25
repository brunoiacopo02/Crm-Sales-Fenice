import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getConfermeBonusSettings } from "@/app/actions/confermeDirettaActions"
import { ConfermeBonusForm } from "./ConfermeBonusForm"

export const dynamic = "force-dynamic"

/**
 * Configurazione del bonus Conferme e degli obiettivi individuali (PO 25/10/2026),
 * mostrati nella colonna arancione della pagina Conferme in Diretta. Solo ADMIN.
 * Sezione della pagina /admin/diretta del ramo "home": se quella pagina c'è,
 * va collegata da lì.
 */
export default async function ConfermeDirettaAdminPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")

    const settings = await getConfermeBonusSettings()

    return (
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
            <div>
                <h1 className="text-2xl font-bold text-brand-charcoal">Conferme in Diretta</h1>
                <p className="mt-1 text-sm text-ash-500">
                    Bonus di squadra e obiettivi individuali che le Conferme vedono nella colonna arancione della loro pagina.
                </p>
            </div>
            <ConfermeBonusForm initial={settings} />
        </div>
    )
}
