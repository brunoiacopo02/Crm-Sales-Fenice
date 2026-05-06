import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { PortafoglioClientiClient } from "@/components/PortafoglioClientiClient"

export default async function PortafoglioClientiPage() {
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const session = supabaseUser
        ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role as string, email: supabaseUser.email, name: supabaseUser.user_metadata?.name as string } }
        : null

    if (!session) redirect("/login")

    const role = session.user.role
    if (role !== 'VENDITORE' && role !== 'MANAGER' && role !== 'ADMIN') {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        redirect("/marketing-analytics")
    }

    const isManagerView = role === 'MANAGER' || role === 'ADMIN'

    return (
        <div className="space-y-6">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    Portafoglio Clienti
                </h1>
                <p className="text-sm text-ash-500 mt-1">
                    {isManagerView
                        ? "Gestione clienti post-vendita per venditore. Inserisci nuovi clienti SMM e segui i follow-up."
                        : "I tuoi clienti SMM. Spunta i messaggi di follow-up e traccia gli upsell."}
                </p>
            </div>

            <PortafoglioClientiClient
                currentUserId={session.user.id}
                isManagerView={isManagerView}
            />
        </div>
    )
}
