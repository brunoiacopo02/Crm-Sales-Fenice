import { createClient } from "@/utils/supabase/server"
import { KpiGdoBoard } from "@/components/KpiGdoBoard"

export default async function KpiGdoPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    KPI GDO
                </h1>
            </div>

            <KpiGdoBoard />

        </div>
    )
}
