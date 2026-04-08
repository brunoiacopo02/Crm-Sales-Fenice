import { createClient } from "@/utils/supabase/server"
import { ConfermeBoard } from "@/components/ConfermeBoard"
import { TeamRadarWidget } from "@/components/TeamRadarWidget"
import { ConfermeDailyObjectives } from "@/components/ConfermeDailyObjectives"
import { StreakCounter } from "@/components/StreakCounter"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const QuestPanel = dynamic(() => import("@/components/QuestPanel").then(m => ({ default: m.QuestPanel })))
const StreakAnxietyBanner = dynamic(() => import("@/components/StreakAnxietyBanner").then(m => ({ default: m.StreakAnxietyBanner })))
const SocialComparisonBadge = dynamic(() => import("@/components/SocialComparisonBadge").then(m => ({ default: m.SocialComparisonBadge })))

export default async function ConfermePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        redirect("/")
    }

    return (
        <div className="space-y-6 flex flex-col pt-0">
            <div className="-mx-8 -mt-8 mb-6 relative z-50">
                <TeamRadarWidget currentUser={session.user} />
            </div>

            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    Dashboard Conferme
                </h1>
                <div className="text-sm text-ash-500 font-medium">
                    Gestione appuntamenti centralizzata
                </div>
            </div>

            {session.user.role === 'CONFERME' && (
                <>
                    <div className="flex flex-wrap items-start gap-3">
                        <div className="flex-1 min-w-[250px]">
                            <ConfermeDailyObjectives confermeUserId={session.user.id} />
                        </div>
                        <div className="flex-1 min-w-[250px]">
                            <StreakCounter userId={session.user.id} />
                        </div>
                        <SocialComparisonBadge userId={session.user.id} role="CONFERME" />
                    </div>
                    <StreakAnxietyBanner userId={session.user.id} />
                </>
            )}

            <ConfermeBoard currentUser={session.user} />

            {session.user.role === 'CONFERME' && (
                <QuestPanel userId={session.user.id} />
            )}
        </div>
    )
}
