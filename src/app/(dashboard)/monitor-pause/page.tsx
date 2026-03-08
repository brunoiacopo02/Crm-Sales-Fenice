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

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        const { redirect } = await import("next/navigation");
        redirect("/marketing-analytics");
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <p className="text-sm text-gray-500 mt-1">
                        Supervisione in tempo reale dei break giornalieri dei GDO, reportistica sforamenti ed uso dei permessi.
                    </p>
                </div >
            </div >

            <ManagerPauseView />
        </div >
    )
}
