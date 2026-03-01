import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ShopAdminClient } from "@/components/ShopAdminClient"

export default async function StoreAdminPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Solo Admin e Manager vedono questa sezione
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">
                        Gestione Fenice Store
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Crea e modifica personalizzazioni estetiche, badge o sfondi acquistabili dai GDO con i Fenice Coins.
                    </p>
                </div>
            </div>

            <ShopAdminClient />
        </div>
    )
}
