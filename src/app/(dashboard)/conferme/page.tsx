import { createClient } from "@/utils/supabase/server"
import { TeamRadarWidget } from "@/components/TeamRadarWidget"
import { ConfermeDailyObjectives } from "@/components/ConfermeDailyObjectives"
import { StreakCounter } from "@/components/StreakCounter"
import { SafeWrapper } from "@/components/SafeWrapper"
import { VenditoriAgendaButton } from "@/components/VenditoriAgendaButton"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const ConfermeBoard = dynamic(() => import("@/components/ConfermeBoard").then(m => ({ default: m.ConfermeBoard })), { loading: () => <div className="animate-pulse space-y-3"><div className="h-10 bg-ash-200 rounded-lg w-1/3" /><div className="h-64 bg-ash-100 rounded-xl" /><div className="h-64 bg-ash-100 rounded-xl" /></div> })

const QuestPanel = dynamic(() => import("@/components/QuestPanel").then(m => ({ default: m.QuestPanel })))
const StreakAnxietyBanner = dynamic(() => import("@/components/StreakAnxietyBanner").then(m => ({ default: m.StreakAnxietyBanner })))
const LevelNudge = dynamic(() => import("@/components/LevelNudge").then(m => ({ default: m.LevelNudge })))
const HotStreak = dynamic(() => import("@/components/HotStreak").then(m => ({ default: m.HotStreak })))

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

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    Dashboard Conferme
                </h1>
                <div className="flex items-center gap-3">
                    <SafeWrapper><VenditoriAgendaButton /></SafeWrapper>
                    <div className="text-sm text-ash-500 font-medium hidden sm:block">
                        Gestione appuntamenti centralizzata
                    </div>
                </div>
            </div>

            {session.user.role === 'CONFERME' && (
                <>
                    <ConfermeDailyObjectives confermeUserId={session.user.id} />
                    <SafeWrapper><StreakCounter userId={session.user.id} /></SafeWrapper>
                    <SafeWrapper><LevelNudge userId={session.user.id} /></SafeWrapper>
                    <SafeWrapper><StreakAnxietyBanner userId={session.user.id} /></SafeWrapper>
                </>
            )}

            <SafeWrapper>
                <HotStreak>
                    <ConfermeBoard currentUser={session.user} />
                </HotStreak>
            </SafeWrapper>

            {session.user.role === 'CONFERME' && (
                <SafeWrapper><QuestPanel userId={session.user.id} /></SafeWrapper>
            )}
        </div>
    )
}
