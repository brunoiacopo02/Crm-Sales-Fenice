import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getLancioAdminView } from "@/app/actions/lancioActions"
import { LancioClient } from "./LancioClient"

// Monitor e copertura sono contatori vivi: nessuna cache fra un'apertura e l'altra.
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Guard server-side come /import: ADMIN, MANAGER e TL. La scrittura dei turni
 * resta ad ADMIN/MANAGER e la rifà l'action (`canEdit` qui serve solo alla UI).
 */
export default async function LancioPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["ADMIN", "MANAGER", "TL"].includes(role)) redirect("/")

    let initial
    try {
        initial = await getLancioAdminView()
    } catch {
        // Azienda diversa da Fenice (o non autorizzato): la pagina non ha senso qui.
        redirect("/")
    }
    return (
        <div className="min-h-screen p-4 sm:p-6">
            <LancioClient initial={initial} />
        </div>
    )
}
