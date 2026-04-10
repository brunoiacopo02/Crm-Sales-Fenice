import { createClient } from "@/utils/supabase/server"
import { getPipelineLeads } from "@/app/actions/pipelineActions"
import { PipelineBoard } from "@/components/PipelineBoard"
import { GdoLeadMetrics } from "@/components/GdoLeadMetrics"
import { GdoDailyObjectives } from "@/components/GdoDailyObjectives"
import { SafeWrapper } from "@/components/SafeWrapper"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

const LootDropModal = dynamic(() => import("@/components/LootDropModal").then(m => ({ default: m.LootDropModal })))
const TimedChest = dynamic(() => import("@/components/TimedChest").then(m => ({ default: m.TimedChest })))
const CelebrationOverlay = dynamic(() => import("@/components/CelebrationOverlay").then(m => ({ default: m.CelebrationOverlay })))
const DailyLoginReward = dynamic(() => import("@/components/DailyLoginReward").then(m => ({ default: m.DailyLoginReward })))
const HotStreak = dynamic(() => import("@/components/HotStreak").then(m => ({ default: m.HotStreak })))

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
    let firstCall: any[] = [], secondCall: any[] = [], thirdCall: any[] = [], fourthCall: any[] = [], recalls: any[] = [];
    let isFourthCallActive = false;
    let pipelineError = "";
    try {
        const data = await getPipelineLeads();
        firstCall = data.firstCall;
        secondCall = data.secondCall;
        thirdCall = data.thirdCall;
        fourthCall = data.fourthCall;
        isFourthCallActive = data.isFourthCallActive;
        recalls = data.recalls;
    } catch (e: any) {
        pipelineError = e?.message || String(e);
        console.error("Pipeline fetch error:", e);
    }

    return (
        <div className="space-y-4">
            {/* Overlays — wrapped in SafeWrapper so crashes don't take down the page */}
            <SafeWrapper><CelebrationOverlay /></SafeWrapper>
            <SafeWrapper><LootDropModal userId={session!.user.id} /></SafeWrapper>
            <SafeWrapper><TimedChest userId={session!.user.id} /></SafeWrapper>
            <SafeWrapper><DailyLoginReward userId={session!.user.id} /></SafeWrapper>

            {pipelineError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    Errore caricamento pipeline: {pipelineError}. Prova a ricaricare la pagina (Ctrl+Shift+R).
                </div>
            )}

            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Pipeline Chiamate
                </h1>
                <div className="text-sm text-gray-500">
                    Benvenuto, <span className="font-semibold text-brand-orange">{session?.user?.name}</span>
                </div>
            </div>

            <div className="sticky top-0 z-30 bg-gray-50 -mx-3 sm:-mx-6 px-3 sm:px-6 pt-1 pb-2 shadow-md">
                <GdoDailyObjectives gdoUserId={session!.user.id} />
            </div>

            <GdoLeadMetrics gdoUserId={session!.user.id} />

            <SafeWrapper>
                <HotStreak>
                    <PipelineBoard
                        firstCall={firstCall}
                        secondCall={secondCall}
                        thirdCall={thirdCall}
                        fourthCall={fourthCall}
                        isFourthCallActive={isFourthCallActive}
                        recalls={recalls}
                    />
                </HotStreak>
            </SafeWrapper>

        </div>
    )
}
