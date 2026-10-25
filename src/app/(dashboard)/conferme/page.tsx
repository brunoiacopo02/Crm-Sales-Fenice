import { createClient } from "@/utils/supabase/server"
import { TeamRadarWidget } from "@/components/TeamRadarWidget"
import { ConfermeDailyObjectives } from "@/components/ConfermeDailyObjectives"
import { StreakCounter } from "@/components/StreakCounter"
import { SafeWrapper } from "@/components/SafeWrapper"
import { VenditoriAgendaButton } from "@/components/VenditoriAgendaButton"
import { ConfermeDirettaColumn } from "@/components/conferme/diretta/ConfermeDirettaColumn"
import { isDirettaOn } from "@/lib/diretta/settings"
import { redirect } from "next/navigation"
import dynamic from "next/dynamic"
import "./conferme-diretta.css"

const ConfermeBoard = dynamic(() => import("@/components/ConfermeBoard").then(m => ({ default: m.ConfermeBoard })), { loading: () => <div className="animate-pulse space-y-3"><div className="h-10 bg-ash-200 rounded-lg w-1/3" /><div className="h-64 bg-ash-100 rounded-xl" /><div className="h-64 bg-ash-100 rounded-xl" /></div> })
// Stesso modulo, scheletro scuro: in Diretta niente lampo chiaro mentre la board arriva.
const ConfermeBoardDiretta = dynamic(() => import("@/components/ConfermeBoard").then(m => ({ default: m.ConfermeBoard })), { loading: () => <div className="space-y-3 pt-3"><div className="h-10 w-1/3 rounded-lg bg-[var(--d-surface)]" /><div className="h-64 rounded-2xl bg-[var(--d-surface)]" /></div> })

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

    // Restyle "Diretta" (PO 25/10/2026): solo per il ruolo CONFERME con
    // l'interruttore conferme_ui_diretta acceso. Stessa board, stessi dati e
    // stesse action; spariscono streak, livelli, quest e hot streak. Manager e
    // admin vedono sempre la grafica classica.
    const diretta = session.user.role === 'CONFERME' && await isDirettaOn('CONFERME')

    if (diretta) {
        return (
            <div className="d-conferme flex min-h-full flex-col bg-[var(--d-bg)] text-[var(--d-text)]">
                <h1 className="sr-only">Conferme</h1>
                <TeamRadarWidget currentUser={session.user} variant="diretta" />
                <div className="flex flex-1 flex-wrap">
                    <div className="flex-[1_1_320px] bg-[var(--d-orange)] lg:max-w-[360px]">
                        <SafeWrapper><ConfermeDirettaColumn /></SafeWrapper>
                    </div>
                    <div className="min-w-0 flex-[999_1_560px] px-4 pt-2 sm:px-8">
                        <SafeWrapper><ConfermeBoardDiretta currentUser={session.user} variant="diretta" /></SafeWrapper>
                    </div>
                </div>
            </div>
        )
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
