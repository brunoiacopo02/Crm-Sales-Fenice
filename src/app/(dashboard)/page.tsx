import { createClient } from "@/utils/supabase/server"
import { getPipelineLeads } from "@/app/actions/pipelineActions"
import { PipelineBoard } from "@/components/PipelineBoard"
import { GdoLeadMetrics } from "@/components/GdoLeadMetrics"
import { GdoDailyObjectives } from "@/components/GdoDailyObjectives"
import { StreakCounter } from "@/components/StreakCounter"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const QuestPanel = dynamic(() => import("@/components/QuestPanel").then(m => ({ default: m.QuestPanel })))
const LootDropModal = dynamic(() => import("@/components/LootDropModal").then(m => ({ default: m.LootDropModal })))
const BossBattleBanner = dynamic(() => import("@/components/BossBattleBanner").then(m => ({ default: m.BossBattleBanner })))
const SeasonalEventBanner = dynamic(() => import("@/components/SeasonalEventBanner").then(m => ({ default: m.SeasonalEventBanner })))

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
            <LootDropModal userId={session!.user.id} />

            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Pipeline Chiamate
                </h1>
                <div className="text-sm text-gray-500">
                    Benvenuto, <span className="font-semibold text-brand-orange">{session?.user?.name}</span>
                </div>
            </div>

            <SeasonalEventBanner />
            <BossBattleBanner userId={session!.user.id} />

            <GdoDailyObjectives gdoUserId={session!.user.id} />

            <StreakCounter userId={session!.user.id} />

            <GdoLeadMetrics gdoUserId={session!.user.id} />

            <PipelineBoard
                firstCall={firstCall}
                secondCall={secondCall}
                thirdCall={thirdCall}
                fourthCall={fourthCall}
                isFourthCallActive={isFourthCallActive}
                recalls={recalls}
            />

            <QuestPanel userId={session!.user.id} />
        </div>
    )
}
