import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { VenditoreDashboardClient } from "@/components/VenditoreDashboardClient"
import { getVenditoreAppointments } from "@/app/actions/venditoreActions"
import { OVERDUE_GRACE_HOURS } from "@/lib/venditore/constants"
import { OutcomeGate } from "@/components/venditore/OutcomeGate"

export default async function VenditorePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== 'VENDITORE' && session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        redirect("/")
    }

    // Compute overdue appointments server-side so the gate is accurate on first render
    const graceMs = OVERDUE_GRACE_HOURS * 3600 * 1000
    const now = Date.now()

    let overdue: { id: string; name: string | null; phone: string | null; appointmentDate: string | null; negotiationStartedAt: string | null }[] = []
    try {
        const appointments = await getVenditoreAppointments(session.user.id)
        overdue = appointments
            .filter(a =>
                a.appointmentDate &&
                !a.salespersonOutcome &&
                (now - new Date(a.appointmentDate).getTime()) > graceMs
            )
            .map(a => ({
                id: a.id,
                name: a.name,
                phone: a.phone,
                appointmentDate: a.appointmentDate ? new Date(a.appointmentDate).toISOString() : null,
                negotiationStartedAt: a.negotiationStartedAt ? new Date(a.negotiationStartedAt).toISOString() : null,
            }))
    } catch {
        // Non-fatal: if the fetch fails, the gate stays empty and the user can proceed
    }

    return (
        <div className="space-y-6">
            {/* OutcomeGate: fixed z-[100] overlay — covers the dashboard while overdue.length > 0 */}
            <OutcomeGate overdue={overdue} />

            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                        Dashboard Vendite
                    </h1>
                    <div className="text-sm text-ash-500 mt-1">
                        Gestisci i tuoi appuntamenti, registra gli esiti e tieni traccia delle performance.
                    </div>
                </div>
            </div>

            <VenditoreDashboardClient sellerId={session.user.id} />
        </div>
    )
}
