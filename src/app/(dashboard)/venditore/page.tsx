import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { VenditoreDashboardClient } from "@/components/VenditoreDashboardClient"

export default async function VenditorePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== 'VENDITORE' && session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        redirect("/")
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">
                        Dashboard Vendite
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Gestisci i tuoi appuntamenti, registra gli esiti e tieni traccia delle performance.
                    </p>
                </div>
            </div>

            <VenditoreDashboardClient sellerId={session.user.id} />
        </div>
    )
}
