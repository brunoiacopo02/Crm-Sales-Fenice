import { createClient } from "@/utils/supabase/server"
import dynamic from "next/dynamic"

const KpiGdoBoard = dynamic(() => import("@/components/KpiGdoBoard").then(mod => mod.KpiGdoBoard), { loading: () => <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div> })

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
