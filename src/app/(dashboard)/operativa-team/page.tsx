import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const ManagerOperativaBoard = dynamic(() => import("@/components/ManagerOperativaBoard").then(mod => mod.ManagerOperativaBoard), { loading: () => <div className="flex items-center justify-center min-h-[200px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div> })

export default async function OperativaTeamPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        redirect("/marketing-analytics");
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Operativa Team</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Tabella mensile/trimestrale: ore lavorate, chiamate, lead gestiti per ogni operatore.
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto">
                <ManagerOperativaBoard />
            </div>
        </div>
    )
}
