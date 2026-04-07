import { createClient } from "@/utils/supabase/server"
import { Trophy, Medal, MapPin, Calendar, Clock, Star } from "lucide-react"
import { LeaderboardClient } from "./LeaderboardClient"
import { getLeaderboard, getPlayerOfTheWeek, LeaderboardPeriod } from "@/app/actions/leaderboardActions"
import { TeamGoalBanner } from "@/components/TeamGoalBanner"

export default async function ClassificaPage({
    searchParams
}: {
    searchParams: { period?: string }
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (session?.user?.email === 'marketing@fenice.local' || session?.user?.name === 'Marketing') {
        const { redirect } = await import("next/navigation");
        redirect("/marketing-analytics");
    }

    const loggedUserId = session?.user?.id

    const period = (searchParams.period as LeaderboardPeriod) || 'today'
    const [leaderboardData, playerOfWeek] = await Promise.all([
        getLeaderboard(period),
        getPlayerOfTheWeek(),
    ])

    return (
        <div className="flex-1 bg-gradient-to-b from-ash-50/50 to-white flex flex-col min-h-screen">
            {/* Header / Hero Section */}
            <div className="bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900/50 text-white pt-6 sm:pt-8 pb-16 sm:pb-20 px-4 sm:px-8 relative overflow-hidden">
                {/* Decorative fire elements */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-ember-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-brand-orange/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
                <div className="absolute top-0 left-1/2 w-80 h-40 bg-gold-500/5 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>

                <div className="flex items-center gap-3 relative z-10">
                    <div className="p-3 bg-gradient-to-br from-gold-400/20 to-brand-orange/10 rounded-xl border border-gold-400/20 shadow-glow-gold">
                        <Trophy className="h-6 w-6 text-gold-400 drop-shadow-sm" />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Classifica GDO</h1>
                        <div className="text-ash-400 mt-1 flex items-center gap-2">
                            <div>Sfida i tuoi colleghi e raggiungi la vetta</div>
                            <Star className="h-3 w-3 text-gold-400" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 px-4 sm:px-8 -mt-10 pb-12 max-w-5xl mx-auto w-full z-10 relative space-y-6">
                <TeamGoalBanner />
                <LeaderboardClient
                    initialData={leaderboardData}
                    initialPeriod={period}
                    loggedUserId={loggedUserId}
                    playerOfWeek={playerOfWeek}
                />
            </div>
        </div>
    )
}
