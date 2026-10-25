import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getRewardRequests } from "@/app/actions/negozioActions"
import { getLeaderboardMode } from "@/app/actions/squadraActions"
import { PremiAdminClient } from "./PremiAdminClient"

// Premi del negozio nuovo (Diretta): richieste da consegnare o annullare,
// catalogo attivo e forma della pagina Squadra. Solo ADMIN, letto dalla
// tabella users; le action lo ricontrollano allo stesso modo.
export default async function PremiAdminPage() {
    if (!(await conRuoloDb(['ADMIN']))) redirect('/')

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
