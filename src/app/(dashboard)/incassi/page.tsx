import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { FIRST_MONTH, monthsFrom, pickMonth } from "@/lib/gestionale/metrics"
import { loadAdminMonth, loadLastRun, loadLastOkAt } from "@/lib/gestionale/queries"
import IncassiAdminClient from "./IncassiAdminClient"

export const dynamic = "force-dynamic"
// "Aggiorna adesso" esegue il sync dentro questa pagina: il default Vercel può ucciderlo.
export const maxDuration = 120

export default async function IncassiPage({ searchParams }: { searchParams: Promise<{ mese?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")

    const current = currentYearMonthRome()
    const mese = pickMonth((await searchParams).mese, current)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    const [data, lastRun, lastOkAt] = await Promise.all([loadAdminMonth(mese, today), loadLastRun(), loadLastOkAt()])

    return (
        <IncassiAdminClient
            mese={mese}
            months={monthsFrom(FIRST_MONTH, current)}
            data={data}
            hasSynced={lastOkAt !== null}
            lastRun={lastRun ? { ...lastRun, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null}
        />
    )
}
