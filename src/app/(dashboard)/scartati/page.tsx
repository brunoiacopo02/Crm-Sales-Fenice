import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getDiscardedLeadsForMarketing } from "@/app/actions/discardedActions"
import { DiscardedBoard } from "@/components/DiscardedBoard"

export default async function ScartatiPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Authorization Check
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        const { redirect } = await import("next/navigation");
        redirect("/marketing-analytics");
    }

    const data = await getDiscardedLeadsForMarketing()

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 border-l-4 border-red-500 pl-3">
                        Lead Scartati (Marketing)
                    </h1>
                    <p className="text-sm text-gray-500 mt-1 pl-3">
                        Visualizza ed esporta i contatti persi provvisti di Email per campagne di re-marketing.
                    </p>
                </div>
            </div>

            <DiscardedBoard initialData={data} />

        </div >
    )
}
