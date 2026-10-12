import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { FIRST_MONTH, monthsFrom, pickMonth } from "@/lib/gestionale/metrics"
import { loadAdminMonth, loadLastRun, loadLastOkAt } from "@/lib/gestionale/queries"
import { gestionaleConfigured } from "@/lib/gestionale/client"
import IncassiAdminClient from "./IncassiAdminClient"

export const dynamic = "force-dynamic"
// "Aggiorna adesso" esegue il sync dentro questa pagina: il default Vercel può ucciderlo.
export const maxDuration = 120
// Il cron gira ogni ora: oltre 2 ore senza un giro riuscito qualcosa si è fermato.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

function staleSinceIso(lastOkAt: Date | null): string | null {
    return lastOkAt && Date.now() - lastOkAt.getTime() > STALE_AFTER_MS ? lastOkAt.toISOString() : null
}

export default async function IncassiPage({ searchParams }: { searchParams: Promise<{ mese?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")

    const current = currentYearMonthRome()
    const mese = pickMonth((await searchParams).mese, current)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    const [data, lastRun, lastOkAt] = await Promise.all([loadAdminMonth(mese, today), loadLastRun(), loadLastOkAt()])
    // Senza chiavi il sync esce "skipped" senza scrivere nel registro: l'unico segnale è qui.
    const configured = gestionaleConfigured() && process.env.GESTIONALE_SYNC !== "off"
    const staleSince = staleSinceIso(lastOkAt)

    return (
        <IncassiAdminClient
            mese={mese}
            months={monthsFrom(FIRST_MONTH, current)}
            data={data}
            hasSynced={lastOkAt !== null}
            configured={configured}
            staleSince={staleSince}
            lastRun={lastRun ? { ...lastRun, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null}
        />
    )
}
