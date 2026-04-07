import { createClient } from "@/utils/supabase/server"
import { ConfermeBoard } from "@/components/ConfermeBoard"
import { TeamRadarWidget } from "@/components/TeamRadarWidget"
import { ConfermeDailyObjectives } from "@/components/ConfermeDailyObjectives"
import { redirect } from "next/navigation"

export default async function ConfermePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        redirect("/")
    }

    return (
        <div className="space-y-6 h-full flex flex-col pt-0">
            <div className="-mx-8 -mt-8 mb-6 relative z-50">
                <TeamRadarWidget currentUser={session.user} />
            </div>

            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-brand-blue-dark">
                    Dashboard Conferme
                </h1>
                <p className="text-sm text-gray-500">
                    Gestione appuntamenti centralizzata
                </p>
            </div>

            {session.user.role === 'CONFERME' && (
                <ConfermeDailyObjectives confermeUserId={session.user.id} />
            )}

            <ConfermeBoard currentUser={session.user} />
        </div>
    )
}
