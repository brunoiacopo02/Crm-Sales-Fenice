import { createClient } from "@/utils/supabase/server"
import { getPipelineLeads } from "@/app/actions/pipelineActions"
import { PipelineBoard } from "@/components/PipelineBoard"
import { GdoLeadMetrics } from "@/components/GdoLeadMetrics"
import { GdoDailyObjectives } from "@/components/GdoDailyObjectives"
import { StreakCounter } from "@/components/StreakCounter"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const QuestPanel = dynamic(() => import("@/components/QuestPanel").then(m => ({ default: m.QuestPanel })))
const StreakAnxietyBanner = dynamic(() => import("@/components/StreakAnxietyBanner").then(m => ({ default: m.StreakAnxietyBanner })))
const LootDropModal = dynamic(() => import("@/components/LootDropModal").then(m => ({ default: m.LootDropModal })))
const BossBattleBanner = dynamic(() => import("@/components/BossBattleBanner").then(m => ({ default: m.BossBattleBanner })))
const SeasonalEventBanner = dynamic(() => import("@/components/SeasonalEventBanner").then(m => ({ default: m.SeasonalEventBanner })))
const CelebrationOverlay = dynamic(() => import("@/components/CelebrationOverlay").then(m => ({ default: m.CelebrationOverlay })))
const ActivityFeed = dynamic(() => import("@/components/ActivityFeed").then(m => ({ default: m.ActivityFeed })))
const DailyLoginReward = dynamic(() => import("@/components/DailyLoginReward").then(m => ({ default: m.DailyLoginReward })))

export default async function DashboardPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (session?.user?.role === 'ADMIN' || session?.user?.role === 'MANAGER') {
        if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
            redirect("/marketing-analytics")
        }
        redirect("/team")
    }

    if (session?.user?.role === 'CONFERME') {
        redirect("/conferme")
    }

    if (session?.user?.role === 'VENDITORE') {
        redirect("/venditore")
    }

    // Fetch leads for the current pipeline state
    const { firstCall, secondCall, thirdCall, fourthCall, isFourthCallActive, recalls } = await getPipelineLeads()

    return (
        <div className="space-y-4">
            {/* Overlays */}
            <CelebrationOverlay />
            <LootDropModal userId={session!.user.id} />
            <DailyLoginReward userId={session!.user.id} />

            {/* Full-width header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Pipeline Chiamate
                </h1>
                <div className="text-sm text-gray-500">
                    Benvenuto, <span className="font-semibold text-brand-orange">{session?.user?.name}</span>
                </div>
            </div>

            {/* Full-width event banners */}
            <SeasonalEventBanner />
            <BossBattleBanner userId={session!.user.id} />

            {/* Social-first 3-column layout: Feed | Pipeline | Quest/Streak */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[280px_1fr_300px] gap-5">

                {/* Left: Activity Feed (social feed sidebar) */}
                <div className="order-3 xl:order-1 lg:col-span-2 xl:col-span-1">
                    <div className="xl:sticky xl:top-4">
                        <ActivityFeed />
                    </div>
                </div>

                {/* Center: Main pipeline workspace */}
                <div className="order-1 xl:order-2 min-w-0 space-y-4">
                    <GdoDailyObjectives gdoUserId={session!.user.id} />
                    <GdoLeadMetrics gdoUserId={session!.user.id} />
                    <PipelineBoard
                        firstCall={firstCall}
                        secondCall={secondCall}
                        thirdCall={thirdCall}
                        fourthCall={fourthCall}
                        isFourthCallActive={isFourthCallActive}
                        recalls={recalls}
                    />
                </div>

                {/* Right: Gamification sidebar (streak + quests) */}
                <div className="order-2 xl:order-3">
                    <div className="lg:sticky lg:top-4 space-y-4">
                        <StreakCounter userId={session!.user.id} />
                        <StreakAnxietyBanner userId={session!.user.id} />
                        <QuestPanel userId={session!.user.id} />
                    </div>
                </div>
            </div>
        </div>
    )
}
