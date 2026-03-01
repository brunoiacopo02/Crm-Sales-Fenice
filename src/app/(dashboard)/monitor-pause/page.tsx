import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ManagerPauseView } from "@/components/ManagerPauseView"

export default async function MonitorPausePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Solo Admin e Manager vedono questa sezione
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">
                        Controllo Pause Team
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Supervisione in tempo reale dei break giornalieri dei GDO, reportistica sforamenti ed uso dei permessi.
                    </p>
                </div>
            </div>

            <ManagerPauseView />
        </div>
    )
}
