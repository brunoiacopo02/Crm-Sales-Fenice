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
const ConfermeRecallBlockingAlert = dynamic(() => import("@/components/ConfermeRecallBlockingAlert").then(mod => ({ default: mod.ConfermeRecallBlockingAlert })))
const ConsigliInArrivo = dynamic(() => import("@/components/diretta/ConsigliInArrivo").then(mod => ({ default: mod.ConsigliInArrivo })))
const ConsigliFissi = dynamic(() => import("@/components/diretta/ConsigliFissi").then(mod => ({ default: mod.ConsigliFissi })))
const ConsigliAdmin = dynamic(() => import("@/components/diretta/ConsigliAdmin").then(mod => ({ default: mod.ConsigliAdmin })))

import { getEquippedSkinCss } from "@/app/actions/shopActions"
import { readSalesPipelineConfig } from "@/app/actions/salesPipelineConfigActions"
import { getUserTheme } from "@/lib/userTheme"
import { direttaAccesa, leggiIo, type DirettaIo } from "@/lib/diretta/io"
import { leggiObiettivi } from "@/lib/diretta/live"
import type { GamificationTargets } from "@/lib/diretta/config"
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

    // Restyle "Diretta" (PO 25/10/2026): acceso per ruolo da appSettings, si
    // spegne senza deploy. Con la Diretta le vecchie skin e gli overlay della
    // gamification non si applicano.
    const diretta = await direttaAccesa(session.user.role)
    // Admin: cornice scura (barra e menu) attorno alle pagine. Le pagine vecchie,
    // dense di numeri, restano su superficie chiara e col loro carattere; quelle
    // nuove della Diretta si disegnano scure da sole (PaginaAdmin, PaginaDiretta).
    const direttaAdmin = diretta && session.user.role === 'ADMIN'

    // Barra in alto della Diretta: nome vero, avatar, saldo e orari del turno.
    let direttaIo: DirettaIo | null = null
    let direttaObiettivi: GamificationTargets | null = null
    if (diretta) {
        try {
            [direttaIo, direttaObiettivi] = await Promise.all([
                leggiIo(session.user.id, session.user.name ?? null),
                leggiObiettivi(),
            ])
        } catch { /* la barra mostra il nome di sessione */ }
    }

    let skinCss: string | null = null;
    if (!diretta) {
        try {
            skinCss = await getEquippedSkinCss(session.user.id);
        } catch { /* ignore skin errors */ }
    }
    const isTheme = skinCss?.includes('skin-theme')

    // Modalità "Tutte le aziende": tema neutro (no Serenamente) sulla vista di
    // gruppo e gate che blocca le pagine operative.
    const isAllCompanies = tctx.isAllCompanies
    const dataCompany = isAllCompanies ? 'fenice' : tctx.companyId

    // Tema estetico per-utente (es. rosa per Andrea): scoped via attributo data-theme.
    const userTheme = getUserTheme(session.user.email)

    // Gamification attiva solo per GDO, CONFERME e supervisori — disabilitata per VENDITORE
    const showSprintBanner = !diretta && ['GDO', 'MANAGER', 'ADMIN'].includes(session.user.role)
    const showGamificationOverlays = !diretta && session.user.role !== 'VENDITORE'

    // Voce di menu "La mia pipeline": solo per il venditore su cui e' accesa
    // oggi. Una voce che rimanda alla home per chiunque altro sarebbe un
    // difetto visibile, non una guardia in più (decisione brief 2026-09-21).
    let salesPipelineEnabled = false
    if (session.user.role === 'VENDITORE') {
        const salesPipelineConfig = await readSalesPipelineConfig()
        salesPipelineEnabled = salesPipelineConfig.enabled && salesPipelineConfig.salesUserId === session.user.id
    }

    return (
        <RealtimeProvider userId={session.user.id} companies={tctx.allowedCompanies}>
            <SidebarProvider>
                <SalesCompanyProvider company={dataCompany}>
                    {/* data-ui è la veste della cornice: le pagine che leggono l'interruttore la
                        confrontano con la loro (VesteAllineata) e, se diverse, ridisegnano tutto. */}
                    <div data-radice-dashboard="" data-company={dataCompany} data-theme={userTheme} data-ui={diretta ? 'diretta' : undefined} className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
                        <Sidebar companyId={dataCompany} salesPipelineEnabled={salesPipelineEnabled} diretta={diretta} ruolo={session.user.role} />
                        <div className={`flex-1 flex flex-col h-full overflow-hidden ${isTheme ? 'bg-transparent' : ''} ${direttaAdmin ? 'bg-[#171717]' : ''}`}>
                            {showSprintBanner && <SprintBanner />}
                            <Topbar diretta={diretta} ruolo={session.user.role} io={direttaIo} obiettivi={direttaObiettivi} />
                            {/* Consigli fissi dall'admin: una riga sotto la barra finché non li toglie (PO 26/10/2026). */}
                            {(session.user.role === 'GDO' || session.user.role === 'CONFERME') && (
                                <SafeWrapper><ConsigliFissi /></SafeWrapper>
                            )}
                            <main className={`flex-1 overflow-y-auto p-3 sm:p-6 ${isTheme ? 'bg-transparent' : 'bg-gray-50'} ${direttaAdmin ? 'd-foglio-admin lg:rounded-tl-[16px]' : ''}`}>
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
                    {/* Richiami "risentire dopo" Conferme: banner blu globale, tutte le aziende.
                        Il banner avvisa dei richiami IN ARRIVO; quelli già scaduti passano
                        all'avviso bloccante qui sotto, così non ci sono due avvisi per la
                        stessa cosa. */}
                    {/* Consigli in chiamata (PO 26/10/2026): l'admin scrive, GDO e Conferme li
                        vedono solo quando ne arriva uno, in un riquadro che non blocca niente. */}
                    {(session.user.role === 'GDO' || session.user.role === 'CONFERME') && (
                        <SafeWrapper><ConsigliInArrivo /></SafeWrapper>
                    )}
                    {session.user.role === 'ADMIN' && (
                        <SafeWrapper><ConsigliAdmin /></SafeWrapper>
                    )}
                    {session.user.role === 'CONFERME' && (
                        <>
                            <SafeWrapper><ConfermeRecallBanner variant={diretta ? 'diretta' : 'classic'} /></SafeWrapper>
                            <SafeWrapper><ConfermeRecallBlockingAlert variant={diretta ? 'diretta' : 'classic'} /></SafeWrapper>
                        </>
                    )}
                </SalesCompanyProvider>
            </SidebarProvider>
        </RealtimeProvider>
    )
}
