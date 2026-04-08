import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { VenditoreDashboardClient } from "@/components/VenditoreDashboardClient"
import { StreakCounter } from "@/components/StreakCounter"
import dynamic from "next/dynamic"

const QuestPanel = dynamic(() => import("@/components/QuestPanel").then(m => ({ default: m.QuestPanel })))
const StreakAnxietyBanner = dynamic(() => import("@/components/StreakAnxietyBanner").then(m => ({ default: m.StreakAnxietyBanner })))
const SocialComparisonBadge = dynamic(() => import("@/components/SocialComparisonBadge").then(m => ({ default: m.SocialComparisonBadge })))

export default async function VenditorePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== 'VENDITORE' && session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        redirect("/")
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                        Dashboard Vendite
                    </h1>
                    <div className="text-sm text-ash-500 mt-1">
                        Gestisci i tuoi appuntamenti, registra gli esiti e tieni traccia delle performance.
                    </div>
                </div>
            </div>

            {session.user.role === 'VENDITORE' && (
                <>
                    <SocialComparisonBadge userId={session.user.id} role="VENDITORE" />
                    <StreakCounter userId={session.user.id} />
                    <StreakAnxietyBanner userId={session.user.id} />
                    <QuestPanel userId={session.user.id} />
                </>
            )}

            <VenditoreDashboardClient sellerId={session.user.id} />
        </div>
    )
}
