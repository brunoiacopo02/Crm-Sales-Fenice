import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ImportClient } from "./ImportClient"

/**
 * Guard server-side: /import è riservata ad ADMIN, MANAGER e TL (GDO). Prima la
 * pagina era un client component senza alcun check di ruolo: qualsiasi utente
 * loggato (GDO, TL, Conferme...) poteva aprirla via URL. Trovato dal QA e2e
 * 2026-06-11. Il TL GDO è stato riammesso il 2026-07-05 per decisione PO.
 */
export default async function ImportPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role

    if (!user || (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TL')) {
        redirect("/")
    }

    return <ImportClient />
}
