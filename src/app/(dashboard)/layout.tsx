import { createClient } from "@/utils/supabase/server"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import dynamic from "next/dynamic"
import { redirect } from "next/navigation"

const SprintBanner = dynamic(() => import("@/components/SprintBanner").then(mod => mod.SprintBanner))
const FomoToast = dynamic(() => import("@/components/FomoToast").then(mod => ({ default: mod.FomoToast })))
const UniverseToast = dynamic(() => import("@/components/UniverseToast").then(mod => ({ default: mod.UniverseToast })))
const CreatureRevealOverlay = dynamic(() => import("@/components/CreatureRevealOverlay").then(mod => ({ default: mod.CreatureRevealOverlay })))
const DuelStartOverlay = dynamic(() => import("@/components/DuelStartOverlay").then(mod => ({ default: mod.DuelStartOverlay })))
const GlobalAlertListener = dynamic(() => import("@/components/GlobalAlertListener").then(mod => ({ default: mod.GlobalAlertListener })))
const CrossCompanyRecallBanner = dynamic(() => import("@/components/CrossCompanyRecallBanner").then(mod => ({ default: mod.CrossCompanyRecallBanner })))
const ConfermeRecallBanner = dynamic(() => import("@/components/ConfermeRecallBanner").then(mod => ({ default: mod.ConfermeRecallBanner })))

import { getEquippedSkinCss } from "@/app/actions/shopActions"
import { getUserTheme } from "@/lib/userTheme"
import { RealtimeProvider } from "@/components/providers/RealtimeProvider"
import { SidebarProvider } from "@/components/providers/SidebarProvider"
import { SalesCompanyProvider } from "@/components/providers/SalesCompanyProvider"
import { AllCompaniesGate } from "@/components/sales/AllCompaniesGate"
import { SafeWrapper } from "@/components/SafeWrapper"
// Social overlay providers DISABLED — caused WSOD. Will fix in dedicated session.

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session) {
        redirect("/login")
    }

    // Multi-azienda: se l'utente ha più aziende consentite e non ha ancora
    // una selezione valida nel cookie, mandalo a sceglierla.
    const { currentTenant } = await import('@/lib/tenancy')
    const { cookies } = await import('next/headers')
    const tctx = await currentTenant()
    const cookieStore = await cookies()
    const hasSelection = !!cookieStore.get('sales_active_company')?.value
    if (tctx.allowedCompanies.length > 1 && !hasSelection) {
        redirect('/seleziona-azienda')
    }

    let skinCss: string | null = null;
    try {
        skinCss = await getEquippedSkinCss(session.user.id);
    } catch { /* ignore skin errors */ }
    const isTheme = skinCss?.includes('skin-theme')

    // Modalità "Tutte le aziende": tema neutro (no Serenamente) sulla vista di
    // gruppo e gate che blocca le pagine operative.
    const isAllCompanies = tctx.isAllCompanies
    const dataCompany = isAllCompanies ? 'fenice' : tctx.companyId

    // Tema estetico per-utente (es. rosa per Andrea): scoped via attributo data-theme.
    const userTheme = getUserTheme(session.user.email)

    // Gamification attiva solo per GDO, CONFERME e supervisori — disabilitata per VENDITORE
    const showSprintBanner = ['GDO', 'MANAGER', 'ADMIN'].includes(session.user.role)
    const showGamificationOverlays = session.user.role !== 'VENDITORE'

    return (
        <RealtimeProvider>
            <SidebarProvider>
                <SalesCompanyProvider company={dataCompany}>
                    <div data-company={dataCompany} data-theme={userTheme} className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
                        <Sidebar companyId={dataCompany} />
                        <div className={`flex-1 flex flex-col h-full overflow-hidden ${isTheme ? 'bg-transparent' : ''}`}>
                            {showSprintBanner && <SprintBanner />}
                            <Topbar />
                            <main className={`flex-1 overflow-y-auto p-3 sm:p-6 ${isTheme ? 'bg-transparent' : 'bg-gray-50'}`}>
                                <AllCompaniesGate active={isAllCompanies}>
                                    {children}
                                </AllCompaniesGate>
                            </main>
                        </div>
                    </div>
                    {showGamificationOverlays && (
                        <>
                            <SafeWrapper><FomoToast /></SafeWrapper>
                            <SafeWrapper><UniverseToast /></SafeWrapper>
                            <SafeWrapper><CreatureRevealOverlay /></SafeWrapper>
                            <SafeWrapper><DuelStartOverlay /></SafeWrapper>
                        </>
                    )}
                    {/* Alert P2P listener: globale a tutta la dashboard, non solo alla pagina Conferme */}
                    <SafeWrapper><GlobalAlertListener currentUser={session.user} /></SafeWrapper>
                    {/* Richiami sull'altra azienda (multi-company): banner cross-company */}
                    {tctx.allowedCompanies.length > 1 && (
                        <SafeWrapper><CrossCompanyRecallBanner /></SafeWrapper>
                    )}
                    {/* Richiami "risentire dopo" Conferme: banner blu globale, tutte le aziende */}
                    {session.user.role === 'CONFERME' && (
                        <SafeWrapper><ConfermeRecallBanner /></SafeWrapper>
                    )}
                </SalesCompanyProvider>
            </SidebarProvider>
        </RealtimeProvider>
    )
}
