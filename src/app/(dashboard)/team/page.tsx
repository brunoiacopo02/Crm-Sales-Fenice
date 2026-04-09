import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { TeamManagementClient } from "@/components/TeamManagementClient"
import { ManagerSprintCard } from "@/components/ManagerSprintCard"
import { TeamGoalAdminClient } from "@/components/TeamGoalAdminClient"
import { SafeWrapper } from "@/components/SafeWrapper"
import dynamic from "next/dynamic"
import { getGdoUsersForTrading } from "@/app/actions/tradingActions"

const DuelCreateModal = dynamic(() => import("@/components/DuelCreateModal").then(m => ({ default: m.DuelCreateModal })))

export default async function TeamPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Solo Admin e Manager vedono questa sezione
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        redirect("/marketing-analytics")
    }

    const gdoUsers = await getGdoUsersForTrading(session.user.id);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">
                        Gestione Team GDO
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Amministrazione account operatori, generazione credenziali e modifica profili (Display Name, Avatar, Status).
                    </p>
                </div>
                <SafeWrapper>
                    <DuelCreateModal gdoUsers={gdoUsers} creatorRole={session.user.role} />
                </SafeWrapper>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Dashboard Marketing Analytics</h2>
                    <p className="text-gray-500 text-sm">Visualizza il ROAS e l'andamento del funnel di acquisizione.</p>
                </div>
                <a href="/marketing-analytics" className="px-4 py-2 bg-brand-orange text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors">
                    Apri Analytics
                </a>
            </div>

            <ManagerSprintCard managerId={session.user.id} />

            <TeamGoalAdminClient />

            <TeamManagementClient />
        </div>
    )
}
