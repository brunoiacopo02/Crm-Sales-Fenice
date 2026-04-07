import { createClient } from "@/utils/supabase/server"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import dynamic from "next/dynamic"
import { redirect } from "next/navigation"

const SprintBanner = dynamic(() => import("@/components/SprintBanner").then(mod => mod.SprintBanner))

import { getEquippedSkinCss } from "@/app/actions/shopActions"
import { RealtimeProvider } from "@/components/providers/RealtimeProvider"
import { SidebarProvider } from "@/components/providers/SidebarProvider"

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

    const skinCss = await getEquippedSkinCss(session.user.id)
    const isTheme = skinCss?.includes('skin-theme')

    // Mostriamo lo sprint banner solo ai ruoli per cui la gamification è attiva o ai supervisori
    const showSprintBanner = ['GDO', 'MANAGER', 'ADMIN'].includes(session.user.role)

    return (
        <RealtimeProvider>
            <SidebarProvider>
                <div className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
                    <Sidebar />
                    <div className={`flex-1 flex flex-col h-full overflow-hidden ${isTheme ? 'bg-transparent' : ''}`}>
                        {showSprintBanner && <SprintBanner />}
                        <Topbar />
                        <main className={`flex-1 overflow-y-auto p-3 sm:p-6 ${isTheme ? 'bg-transparent' : 'bg-gray-50'}`}>
                            {children}
                        </main>
                    </div>
                </div>
            </SidebarProvider>
        </RealtimeProvider>
    )
}
