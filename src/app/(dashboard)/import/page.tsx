import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ImportClient } from "./ImportClient"

/**
 * Guard server-side: /import è riservata ad ADMIN e MANAGER. Prima la pagina
 * era un client component senza alcun check di ruolo: qualsiasi utente loggato
 * (GDO, TL, Conferme...) poteva aprirla via URL. Trovato dal QA e2e 2026-06-11.
 */
export default async function ImportPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role

    if (!user || (role !== 'ADMIN' && role !== 'MANAGER')) {
        redirect("/")
    }

    return <ImportClient />
}
