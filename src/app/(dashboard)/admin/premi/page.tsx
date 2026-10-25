import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getRewardRequests } from "@/app/actions/negozioActions"
import { getLeaderboardMode } from "@/app/actions/squadraActions"
import { PremiAdminClient } from "./PremiAdminClient"

// Premi del negozio nuovo (Diretta): richieste da consegnare o annullare,
// catalogo attivo e forma della pagina Squadra. Solo ADMIN; le action
// ricontrollano il ruolo sulla tabella users.
export default async function PremiAdminPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')
    if (user.user_metadata?.role !== 'ADMIN') redirect('/')

    let dati: Awaited<ReturnType<typeof getRewardRequests>> | null = null
    let modalita: Awaited<ReturnType<typeof getLeaderboardMode>> = 'top3'
    try {
        ;[dati, modalita] = await Promise.all([getRewardRequests(), getLeaderboardMode()])
    } catch (e) {
        console.error('[admin/premi]', e)
    }
    if (!dati) redirect('/')

    return <PremiAdminClient richieste={dati} modalita={modalita} />
}
