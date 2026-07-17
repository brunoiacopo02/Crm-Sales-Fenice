import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { currentYearMonthRome, currentWeekStartRome } from "@/lib/workingDaysUtils"
import { listVenditori } from "@/app/actions/salesWeeklyFocusActions"
import { PerformanceVenditoriClient } from "./PerformanceVenditoriClient"

export const dynamic = 'force-dynamic'

export default async function PerformanceVenditoriPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const role = user.user_metadata?.role
    // Swap PO 2026-07-17: il TL Conferme non vede più questa pagina (ora ha Monitor Vendite).
    if (role !== 'ADMIN' && role !== 'MANAGER') redirect('/')

    const readOnly = false
    const venditori = await listVenditori()

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">Performance Venditori</h1>
                <p className="text-sm text-ash-500 mt-0.5">Analisi per venditore: motivi di non chiusura, follow-up, closing rate, trend. Assegna il focus settimanale.</p>
            </div>
            <PerformanceVenditoriClient
                venditori={venditori}
                initialYearMonth={currentYearMonthRome()}
                weekStart={currentWeekStartRome()}
                readOnly={readOnly}
            />
        </div>
    )
}
