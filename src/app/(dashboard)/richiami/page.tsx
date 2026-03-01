import { createClient } from "@/utils/supabase/server"
import { getRecallLeads } from "@/app/actions/recallActions"
import { RecallBoard } from "@/components/RecallBoard"

export default async function RecallPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Fetch recall leads
    const { expired, upcoming } = await getRecallLeads()

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Agenda Richiami
                </h1>
                <div className="text-sm text-gray-500">
                    <span className="font-semibold text-brand-orange">{expired.length}</span> urgenze in rosso
                </div>
            </div>

            <RecallBoard
                expired={expired}
                upcoming={upcoming}
            />
        </div>
    )
}
