import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { KpiTeamDashboard } from "@/components/KpiTeamDashboard"
import { ManagerOperativaBoard } from "@/components/ManagerOperativaBoard"

export default async function KpiTeamPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Sicurezza di navigazione Manager/Admin
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        const { redirect } = await import("next/navigation");
        redirect("/marketing-analytics");
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <p className="text-sm text-gray-500 mt-1">
                        Panoramica aggregata delle performance, grafici dei flussi chiamate/appuntamenti e ranking Operatori.
                    </p>
                </div >
            </div >

            <div className="max-w-7xl mx-auto">
                <KpiTeamDashboard />
            </div>

            <div className="max-w-7xl mx-auto">
                <ManagerOperativaBoard />
            </div>
        </div >
    )
}
