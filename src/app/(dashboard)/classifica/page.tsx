import { createClient } from "@/utils/supabase/server"
import { Trophy, Medal, MapPin, Calendar, Clock, Star } from "lucide-react"
import { LeaderboardClient } from "./LeaderboardClient"
import { getLeaderboard, LeaderboardPeriod } from "@/app/actions/leaderboardActions"
import { TeamGoalBanner } from "@/components/TeamGoalBanner"
export default async function ClassificaPage({
    searchParams
}: {
    searchParams: { period?: string }
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    const loggedUserId = session?.user?.id

    const period = (searchParams.period as LeaderboardPeriod) || 'today'
    const leaderboardData = await getLeaderboard(period)

    return (
        <div className="flex-1 bg-gray-50 flex flex-col min-h-screen">
            {/* Header / Hero Section */}
            <div className="bg-brand-charcoal text-white pt-8 pb-20 px-8 relative overflow-hidden">
                {/* Decorative background element */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-brand-orange/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>

                <div className="flex items-center gap-3 relative z-10">
                    <div className="p-3 bg-gradient-to-br from-brand-orange/20 to-brand-orange/5 rounded-xl border border-brand-orange/20 shadow-lg">
                        <Trophy className="h-6 w-6 text-brand-orange drop-shadow-sm" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Classifica GDO</h1>
                        <p className="text-gray-400 mt-1 flex items-center gap-2">
                            <span>Sfida i tuoi colleghi e raggiungi la vetta</span>
                            <Star className="h-3 w-3 text-yellow-500" />
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 px-8 -mt-10 pb-12 max-w-5xl mx-auto w-full z-10 relative space-y-6">
                <TeamGoalBanner />
                <LeaderboardClient initialData={leaderboardData} initialPeriod={period} loggedUserId={loggedUserId} />
            </div>
        </div>
    )
}
