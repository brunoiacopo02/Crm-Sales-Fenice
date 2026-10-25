import { createClient } from "@/utils/supabase/server"
import { requireRole } from "@/lib/authz"
import { getQuoteCalendar } from "@/app/actions/quoteActions"
import { CitazioniAdminClient } from "./CitazioniAdminClient"

// Calendario della citazione del giorno e del consiglio di vendita (PO 25/10/2026):
// l'admin controlla le fonti, approva, modifica o riscrive riflessioni e consigli
// e, se serve, cambia la citazione di un giorno.
export default async function CitazioniAdminPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await requireRole(user ? { user: { role: user.user_metadata?.role } } : null, ["ADMIN"])

    const data = await getQuoteCalendar(14)

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Citazioni del giorno</h1>
                <p className="mt-1 max-w-3xl text-sm text-gray-600">
                    I prossimi 14 giorni lavorativi. Riflessioni e consigli si vedono solo dopo l&apos;approvazione:
                    si approvano così come sono, si modificano o si riscrivono da zero, al massimo 10 righe.
                </p>
            </div>
            {data.ok ? (
                <CitazioniAdminClient days={data.days} closedDays={data.closedDays} />
            ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{data.error}</div>
            )}
        </div>
    )
}
